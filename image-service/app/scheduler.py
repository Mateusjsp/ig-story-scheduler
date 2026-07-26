"""Scheduler autônomo (APScheduler).

Dois jobs:
  • publish_due   — a cada minuto: publica os posts vencidos (status=queued,
                    scheduled_at <= agora).
  • refresh_tokens — diário: renova tokens que expiram em <7 dias.

Roda dentro do processo do FastAPI (serviço sempre-no-ar). Só inicia se o
Supabase estiver configurado.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, UTC

import requests
from apscheduler.schedulers.background import BackgroundScheduler

from app.crypto import decrypt_token, encrypt_token
from app.db import get_supabase
from app.publishing.graph_api import GraphApiPublisher
from app.settings import get_settings

log = logging.getLogger("scheduler")
MAX_ATTEMPTS = 3
# post em "publishing" além disso = órfão, volta pra fila. Folga sobre o pior
# caso de UM item (poll ~60s + timeouts + retries) — o heartbeat renova o
# updated_at a cada item, então um lote longo não cruza o limiar.
STUCK_MINUTES = 15

# Serializa APScheduler × /run-due (pg_cron) dentro do processo: uma passada de
# publish_due por vez, pra requeue_stuck não mexer no lote em andamento.
_publish_lock = threading.Lock()


class PublishedButNotRecorded(Exception):
    """Publicou na Meta mas não gravou o ig_media_id (não reenfileirar!)."""

    def __init__(self, ig_media_id: str):
        self.ig_media_id = ig_media_id
        super().__init__(f"publicado ({ig_media_id}) mas não gravado")


def _now() -> datetime:
    return datetime.now(UTC)


def _mark_published(sb, pid: str, ig_media_id: str) -> None:
    """Grava o sucesso com retry curto — falha transitória do banco não pode
    devolver pra fila um post JÁ publicado (isso duplicaria na Meta)."""
    last: Exception | None = None
    for _ in range(3):
        try:
            sb.table("posts").update(
                {
                    "status": "published",
                    "ig_media_id": ig_media_id,
                    "published_at": _now().isoformat(),
                    "error": None,
                }
            ).eq("id", pid).execute()
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2)
    raise PublishedButNotRecorded(ig_media_id) from last


def _safe_err(exc: Exception) -> str:
    """Mensagem sem URL/token — exceções do requests embutem a URL chamada."""
    if isinstance(exc, requests.RequestException):
        return f"{type(exc).__name__} ao chamar a API da Meta"
    return str(exc)


def requeue_stuck() -> None:
    """Devolve pra 'queued' posts presos em 'publishing' (processo morreu no meio)."""
    sb = get_supabase()
    cutoff = (_now() - timedelta(minutes=STUCK_MINUTES)).isoformat()
    stuck = (
        sb.table("posts")
        .update({"status": "queued", "error": "reenfileirado após travar em publishing"})
        .eq("status", "publishing")
        .lt("updated_at", cutoff)
        .execute()
    )
    if stuck.data:
        log.warning("%d post(s) reenfileirado(s) (travados em publishing)", len(stuck.data))


def publish_due() -> None:
    if not _publish_lock.acquire(blocking=False):
        log.info("publish_due já em execução — pulando esta passada.")
        return
    try:
        requeue_stuck()
        sb = get_supabase()
        # Claim atômico (FOR UPDATE SKIP LOCKED): cada post é reivindicado por uma só
        # instância, evitando publicação dupla com múltiplas réplicas. Ver migration
        # 0003_claim_posts.sql. O claim já marca 'publishing' e incrementa attempts.
        claimed = sb.rpc("claim_due_posts", {"lim": 20}).execute()
        for post in claimed.data or []:
            _publish_one(sb, post)
    finally:
        _publish_lock.release()


def _publish_one(sb, post: dict) -> None:
    pid = post["id"]
    try:
        # Curto-circuito: se o post já tem ig_media_id, ele JÁ saiu na Meta
        # (requeue de um post publicado). Só conserta o status, não republica.
        fresh = (
            sb.table("posts").select("ig_media_id").eq("id", pid).single().execute().data
        )
        if fresh and fresh.get("ig_media_id"):
            sb.table("posts").update({"status": "published", "error": None}).eq(
                "id", pid
            ).execute()
            log.info("post %s já publicado (%s) — corrigindo status", pid, fresh["ig_media_id"])
            return
        media = (
            sb.table("media")
            .select("processed_url, feed_caption, user_tags")
            .eq("id", post["media_id"])
            .single()
            .execute()
            .data
        )
        account = (
            sb.table("ig_accounts")
            .select("ig_user_id, access_token_enc, graph_host")
            .eq("id", post["account_id"])
            .single()
            .execute()
            .data
        )
        image_url = (media or {}).get("processed_url")
        if not image_url:
            raise RuntimeError("media sem processed_url (rode o /process antes).")
        token = decrypt_token(account["access_token_enc"])
        # graph_version fica no default do publisher (v21.0). Tentar v23.0 aqui
        # quebrou a publicação com "Invalid user id" (code 110) — o Instagram
        # Login (graph.instagram.com) não aceita a versão nova nesse caminho, e a
        # menção via API não é suportada nesse login (precisaria Facebook Login).
        publisher = GraphApiPublisher(
            ig_user_id=account["ig_user_id"],
            access_token=token,
            graph_host=account.get("graph_host") or "https://graph.instagram.com",
        )
        # Heartbeat: renova updated_at antes de publicar, pra requeue_stuck não
        # "resgatar" este post enquanto os anteriores do lote ainda publicam.
        sb.table("posts").update({"updated_at": _now().isoformat()}).eq("id", pid).execute()
        # Marcações de pessoas (@) — enviadas à Meta como user_tags. Vale pra feed
        # e story; lista vazia/ausente = sem marcação.
        user_tags = (media or {}).get("user_tags") or None
        # Destino define o container da Meta: feed = foto no perfil (com legenda de
        # texto real), story = tela cheia 24h. Default 'story' (posts antigos).
        if post.get("target") == "feed":
            ig_media_id = publisher.publish_feed(
                image_url,
                caption=(media or {}).get("feed_caption"),
                user_tags=user_tags,
            )
        else:
            ig_media_id = publisher.publish_story(image_url, user_tags=user_tags)
        _mark_published(sb, pid, ig_media_id)
        log.info("post %s publicado (%s)", pid, ig_media_id)
    except PublishedButNotRecorded as exc:
        # Publicou de verdade mas não gravou. NUNCA reenfileirar (duplicaria).
        try:
            sb.table("posts").update(
                {
                    "status": "failed",
                    "ig_media_id": exc.ig_media_id,
                    "error": f"publicado na Meta ({exc.ig_media_id}) mas não gravado — verificar",
                }
            ).eq("id", pid).execute()
        except Exception:  # noqa: BLE001
            log.error("post %s publicado (%s) e sem gravar status", pid, exc.ig_media_id)
    except Exception as exc:  # noqa: BLE001
        attempts = post.get("attempts", 0)  # claim já incrementou
        status = "queued" if attempts < MAX_ATTEMPTS else "failed"
        sb.table("posts").update({"status": status, "error": _safe_err(exc)}).eq(
            "id", pid
        ).execute()
        log.warning("post %s falhou (%s/%s): %s", pid, attempts, MAX_ATTEMPTS, _safe_err(exc))


def refresh_tokens() -> None:
    sb = get_supabase()
    s = get_settings()
    soon = (_now() + timedelta(days=7)).isoformat()
    rows = (
        sb.table("ig_accounts")
        .select("id, access_token_enc, graph_host")
        .eq("status", "active")
        .lte("token_expires_at", soon)
        .execute()
    )
    for acc in rows.data or []:
        try:
            token = decrypt_token(acc["access_token_enc"])
            host = acc.get("graph_host") or s.graph_host
            resp = requests.get(
                f"{host}/refresh_access_token",
                params={"grant_type": "ig_refresh_token"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            expires_at = _now() + timedelta(seconds=int(data.get("expires_in", 0)))
            sb.table("ig_accounts").update(
                {
                    "access_token_enc": encrypt_token(data["access_token"]),
                    "token_expires_at": expires_at.isoformat(),
                }
            ).eq("id", acc["id"]).execute()
            log.info("token da conta %s renovado", acc["id"])
        except Exception as exc:  # noqa: BLE001
            resp_status = getattr(getattr(exc, "response", None), "status_code", None)
            if resp_status is not None and 400 <= resp_status < 500:
                # A Meta rejeitou o token: expirado/revogado de verdade.
                sb.table("ig_accounts").update({"status": "token_expired"}).eq(
                    "id", acc["id"]
                ).execute()
                log.warning(
                    "refresh da conta %s: token rejeitado (HTTP %s)", acc["id"], resp_status
                )
            else:
                # Transitório (rede/5xx/parse/decrypt): mantém active; tenta no
                # próximo ciclo (12h) — há dias de folga antes do token expirar.
                log.warning(
                    "refresh da conta %s falhou (transitório): %s", acc["id"], _safe_err(exc)
                )


def start_scheduler() -> BackgroundScheduler | None:
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_key):
        log.info("Supabase não configurado — scheduler desligado.")
        return None
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(publish_due, "interval", minutes=1, id="publish_due")
    sched.add_job(refresh_tokens, "interval", hours=12, id="refresh_tokens")
    sched.start()
    log.info("scheduler iniciado (publish 1min, refresh 12h).")
    return sched

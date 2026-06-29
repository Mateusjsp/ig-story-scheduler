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
from datetime import datetime, timedelta, timezone

import requests
from apscheduler.schedulers.background import BackgroundScheduler

from app.crypto import decrypt_token, encrypt_token
from app.db import get_supabase
from app.publishing.graph_api import GraphApiPublisher
from app.settings import get_settings

log = logging.getLogger("scheduler")
MAX_ATTEMPTS = 3
STUCK_MINUTES = 10  # post em "publishing" além disso = órfão, volta pra fila


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
    requeue_stuck()
    sb = get_supabase()
    # Claim atômico (FOR UPDATE SKIP LOCKED): cada post é reivindicado por uma só
    # instância, evitando publicação dupla com múltiplas réplicas. Ver migration
    # 0003_claim_posts.sql. O claim já marca 'publishing' e incrementa attempts.
    claimed = sb.rpc("claim_due_posts", {"lim": 20}).execute()
    for post in claimed.data or []:
        _publish_one(sb, post)


def _publish_one(sb, post: dict) -> None:
    pid = post["id"]
    try:
        media = (
            sb.table("media")
            .select("processed_url")
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
        publisher = GraphApiPublisher(
            ig_user_id=account["ig_user_id"],
            access_token=token,
            graph_host=account.get("graph_host") or "https://graph.instagram.com",
        )
        ig_media_id = publisher.publish_story(image_url)
        sb.table("posts").update(
            {
                "status": "published",
                "ig_media_id": ig_media_id,
                "published_at": _now().isoformat(),
                "error": None,
            }
        ).eq("id", pid).execute()
        log.info("post %s publicado (%s)", pid, ig_media_id)
    except Exception as exc:  # noqa: BLE001
        attempts = post.get("attempts", 0)  # claim já incrementou
        status = "queued" if attempts < MAX_ATTEMPTS else "failed"
        sb.table("posts").update({"status": status, "error": str(exc)}).eq(
            "id", pid
        ).execute()
        log.warning("post %s falhou (%s/%s): %s", pid, attempts, MAX_ATTEMPTS, exc)


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
                params={"grant_type": "ig_refresh_token", "access_token": token},
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
            sb.table("ig_accounts").update({"status": "token_expired"}).eq(
                "id", acc["id"]
            ).execute()
            log.warning("refresh da conta %s falhou: %s", acc["id"], exc)


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

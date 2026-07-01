"""Upload do JPEG tratado pro Supabase Storage (bucket público).

A URL pública resultante é o que vira `image_url` na publicação da Meta. Usa a
service role key (bypassa RLS) — só no backend. Import do client é lazy pra não
exigir Supabase quando só se usa /preview.
"""
from __future__ import annotations

import uuid

from app.db import get_supabase
from app.settings import get_settings


def upload_processed(owner: str, data: bytes) -> tuple[str, str]:
    """Sobe o JPEG tratado e devolve (path, public_url)."""
    s = get_settings()
    path = f"{owner}/processed/{uuid.uuid4().hex}.jpg"
    client = get_supabase()
    client.storage.from_(s.storage_bucket).upload(
        path, data, {"content-type": "image/jpeg", "upsert": "false"}
    )
    public_url = client.storage.from_(s.storage_bucket).get_public_url(path)
    return path, public_url


def upload_original(owner: str, data: bytes, content_type: str) -> tuple[str, str]:
    """Sobe o arquivo original (pra permitir reprocessar na edição) -> (path, url)."""
    s = get_settings()
    path = f"{owner}/original/{uuid.uuid4().hex}"
    client = get_supabase()
    client.storage.from_(s.storage_bucket).upload(
        path, data, {"content-type": content_type or "application/octet-stream", "upsert": "false"}
    )
    public_url = client.storage.from_(s.storage_bucket).get_public_url(path)
    return path, public_url


def download(path: str) -> bytes:
    """Baixa os bytes de um arquivo do bucket (service role)."""
    s = get_settings()
    client = get_supabase()
    return client.storage.from_(s.storage_bucket).download(path)


def remove(path: str) -> None:
    """Apaga um arquivo do bucket (best-effort; ignora erro)."""
    s = get_settings()
    try:
        get_supabase().storage.from_(s.storage_bucket).remove([path])
    except Exception:  # noqa: BLE001 — limpeza best-effort
        pass

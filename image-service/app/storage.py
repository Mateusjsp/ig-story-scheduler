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
    """Sobe o JPEG e devolve (path, public_url)."""
    s = get_settings()
    path = f"{owner}/processed/{uuid.uuid4().hex}.jpg"
    client = get_supabase()
    client.storage.from_(s.storage_bucket).upload(
        path, data, {"content-type": "image/jpeg", "upsert": "false"}
    )
    public_url = client.storage.from_(s.storage_bucket).get_public_url(path)
    return path, public_url

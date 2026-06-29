"""Client Supabase com service role (bypassa RLS). Só no backend."""
from __future__ import annotations

from app.settings import get_settings

_client = None


def get_supabase():
    global _client
    if _client is None:
        from supabase import create_client  # import lazy

        s = get_settings()
        if not s.supabase_url or not s.supabase_service_key:
            raise RuntimeError("SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes.")
        _client = create_client(s.supabase_url, s.supabase_service_key)
    return _client

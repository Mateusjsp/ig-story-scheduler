"""Configuração do serviço via variáveis de ambiente.

Tudo opcional nesta fase: o serviço de imagem (/preview, /process) sobe sem
Supabase. As credenciais de Supabase/Instagram passam a ser usadas na Fase B+
(persistir no Storage, publicar, refresh de token).
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase (service role — só no backend, nunca no client)
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    storage_bucket: str = "media"

    # Instagram OAuth / API (Fase C+)
    instagram_app_id: str | None = None
    instagram_app_secret: str | None = None
    graph_host: str = "https://graph.instagram.com"
    graph_version: str = "v21.0"

    # Cifragem dos tokens guardados (Fase C+)
    token_enc_key: str | None = None

    # Segredo compartilhado com o painel (Next). Requisições sem ele -> 401.
    service_shared_secret: str | None = None

    # CORS — origem do painel Next.js
    web_origin: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()

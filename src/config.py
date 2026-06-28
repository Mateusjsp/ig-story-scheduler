"""Carrega e valida as configurações do .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Config:
    ig_user_id: str
    access_token: str
    public_base_url: str          # ex.: https://raw.githubusercontent.com/user/repo/main/photos
    graph_version: str = "v21.0"
    graph_host: str = "https://graph.facebook.com"
    photos_dir: Path = ROOT / "photos"
    state_file: Path = ROOT / "state.json"

    @property
    def media_endpoint(self) -> str:
        return f"{self.graph_host}/{self.graph_version}/{self.ig_user_id}/media"

    @property
    def publish_endpoint(self) -> str:
        return f"{self.graph_host}/{self.graph_version}/{self.ig_user_id}/media_publish"


def load_config() -> Config:
    ig_user_id = os.getenv("IG_USER_ID", "").strip()
    access_token = os.getenv("IG_ACCESS_TOKEN", "").strip()
    public_base_url = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")

    missing = [
        name
        for name, val in {
            "IG_USER_ID": ig_user_id,
            "IG_ACCESS_TOKEN": access_token,
            "PUBLIC_BASE_URL": public_base_url,
        }.items()
        if not val
    ]
    if missing:
        raise SystemExit(f"Variáveis ausentes no .env: {', '.join(missing)}")

    return Config(
        ig_user_id=ig_user_id,
        access_token=access_token,
        public_base_url=public_base_url,
        graph_version=os.getenv("GRAPH_VERSION", "v21.0"),
        graph_host=os.getenv("GRAPH_HOST", "https://graph.facebook.com"),
    )

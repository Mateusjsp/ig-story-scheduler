"""Publicação de Story via Content Publishing API oficial da Meta.

Fluxo de 2 passos:
  1. POST /{ig-user-id}/media        -> cria o container (media_type=STORIES)
  2. POST /{ig-user-id}/media_publish -> publica o container
Imagem não precisa de polling (processa rápido).
"""
from __future__ import annotations

import requests

from src.config import Config
from src.publishers.base import Publisher

TIMEOUT = 60


class GraphApiPublisher(Publisher):
    def __init__(self, config: Config):
        self.cfg = config

    def publish_story(self, image_url: str) -> str:
        container_id = self._create_container(image_url)
        return self._publish_container(container_id)

    def _create_container(self, image_url: str) -> str:
        resp = requests.post(
            self.cfg.media_endpoint,
            data={
                "media_type": "STORIES",
                "image_url": image_url,
                "access_token": self.cfg.access_token,
            },
            timeout=TIMEOUT,
        )
        self._raise_for_meta_error(resp, "criar container")
        return resp.json()["id"]

    def _publish_container(self, container_id: str) -> str:
        resp = requests.post(
            self.cfg.publish_endpoint,
            data={
                "creation_id": container_id,
                "access_token": self.cfg.access_token,
            },
            timeout=TIMEOUT,
        )
        self._raise_for_meta_error(resp, "publicar")
        return resp.json()["id"]

    @staticmethod
    def _raise_for_meta_error(resp: requests.Response, step: str) -> None:
        if resp.ok:
            return
        try:
            err = resp.json().get("error", {})
            msg = err.get("message", resp.text)
            code = err.get("code", resp.status_code)
        except ValueError:
            msg, code = resp.text, resp.status_code
        raise RuntimeError(f"Falha ao {step} (code {code}): {msg}")

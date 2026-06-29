"""Publicação de Story via Content Publishing API (Instagram Login).

Fluxo de 3 passos:
  1. POST /{ig-user-id}/media         -> cria container (media_type=STORIES)
  2. GET  /{container-id}?fields=status_code -> espera virar FINISHED
  3. POST /{ig-user-id}/media_publish -> publica
O passo 2 evita o erro 9007 (Media ID is not available) quando se publica antes
da Meta terminar de baixar a imagem da URL.

Diferente do CLI original, o publisher é por-conta: recebe credenciais no
construtor (cada ig_account tem as suas), sem depender de um .env global.
"""
from __future__ import annotations

import time

import requests

from app.publishing.base import Publisher

TIMEOUT = 60
POLL_INTERVAL = 3
POLL_MAX_TRIES = 20  # ~60s


class GraphApiPublisher(Publisher):
    def __init__(
        self,
        ig_user_id: str,
        access_token: str,
        graph_host: str = "https://graph.instagram.com",
        graph_version: str = "v21.0",
    ):
        self.ig_user_id = ig_user_id
        self.access_token = access_token
        self.graph_host = graph_host.rstrip("/")
        self.graph_version = graph_version

    @property
    def _base(self) -> str:
        return f"{self.graph_host}/{self.graph_version}"

    def publish_story(self, image_url: str) -> str:
        container_id = self._create_container(image_url)
        self._wait_until_ready(container_id)
        return self._publish_container(container_id)

    def _create_container(self, image_url: str) -> str:
        resp = requests.post(
            f"{self._base}/{self.ig_user_id}/media",
            data={
                "media_type": "STORIES",
                "image_url": image_url,
                "access_token": self.access_token,
            },
            timeout=TIMEOUT,
        )
        self._raise_for_meta_error(resp, "criar container")
        return resp.json()["id"]

    def _wait_until_ready(self, container_id: str) -> None:
        url = f"{self._base}/{container_id}"
        for _ in range(POLL_MAX_TRIES):
            resp = requests.get(
                url,
                params={"fields": "status_code", "access_token": self.access_token},
                timeout=TIMEOUT,
            )
            self._raise_for_meta_error(resp, "checar status do container")
            status = resp.json().get("status_code")
            if status == "FINISHED":
                return
            if status in ("ERROR", "EXPIRED"):
                raise RuntimeError(f"Container falhou (status={status}).")
            time.sleep(POLL_INTERVAL)
        raise RuntimeError("Container não ficou pronto a tempo (timeout no polling).")

    def _publish_container(self, container_id: str) -> str:
        resp = requests.post(
            f"{self._base}/{self.ig_user_id}/media_publish",
            data={"creation_id": container_id, "access_token": self.access_token},
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

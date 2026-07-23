"""Interface comum para qualquer backend de publicação."""
from __future__ import annotations

from abc import ABC, abstractmethod


class Publisher(ABC):
    """Contrato que qualquer publicador (Story ou Feed) deve implementar.

    Trocar de backend (oficial -> outro) = criar outra subclasse, sem
    mexer em main.py.
    """

    @abstractmethod
    def publish(
        self,
        media_url: str,
        *,
        media_type: str = "IMAGE",
        caption: str | None = None,
        user_tags: list[dict] | None = None,
    ) -> str:
        """Publica a mídia e retorna o media_id.

        `media_type`: "STORIES" (story), "IMAGE" (foto no feed), "REELS" (vídeo).
        `caption`: legenda de texto real — só no feed; ignorada no story.
        `user_tags`: marcações de pessoas [{username, x, y}] (x/y em 0.0–1.0).
            Feed exige x/y; story aceita a menção com ou sem coordenada.
        """
        raise NotImplementedError

    def publish_story(self, image_url: str, user_tags: list[dict] | None = None) -> str:
        """Atalho de compatibilidade: publica como Story (com menções opcionais)."""
        return self.publish(image_url, media_type="STORIES", user_tags=user_tags)

    def publish_feed(
        self,
        image_url: str,
        caption: str | None = None,
        user_tags: list[dict] | None = None,
    ) -> str:
        """Atalho: publica foto no feed com legenda e marcações opcionais."""
        return self.publish(
            image_url, media_type="IMAGE", caption=caption, user_tags=user_tags
        )

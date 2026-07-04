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
    ) -> str:
        """Publica a mídia e retorna o media_id.

        `media_type`: "STORIES" (story), "IMAGE" (foto no feed), "REELS" (vídeo).
        `caption`: legenda de texto real — só no feed; ignorada no story.
        """
        raise NotImplementedError

    def publish_story(self, image_url: str) -> str:
        """Atalho de compatibilidade: publica como Story."""
        return self.publish(image_url, media_type="STORIES")

    def publish_feed(self, image_url: str, caption: str | None = None) -> str:
        """Atalho: publica foto no feed com legenda opcional."""
        return self.publish(image_url, media_type="IMAGE", caption=caption)

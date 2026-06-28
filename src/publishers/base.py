"""Interface comum para qualquer backend de publicação."""
from __future__ import annotations

from abc import ABC, abstractmethod


class Publisher(ABC):
    """Contrato que qualquer publicador de Story deve implementar.

    Trocar de backend (oficial -> outro) = criar outra subclasse, sem
    mexer em main.py.
    """

    @abstractmethod
    def publish_story(self, image_url: str) -> str:
        """Publica a foto como Story e retorna o media_id."""
        raise NotImplementedError

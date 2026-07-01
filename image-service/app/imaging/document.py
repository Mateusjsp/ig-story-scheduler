"""Documento de Story em camadas (múltiplos elementos de texto/sticker).

O editor do painel produz este `doc` e manda pro image-service, que re-renderiza
autoritativo. Posições/tamanhos são normalizados (0..1 / fração da largura), então
o mesmo doc rende igual em qualquer resolução (preview 720px, saída 1080px).

Compatibilidade: posts antigos não têm `doc` (só caption+style) e continuam pelo
caminho legado (overlay_text com placement automático).
"""
from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, Field, field_validator

from app.imaging.style import FONT_CANDIDATES, FontKey, Outline, Scrim, _valid_hex

Align = Literal["left", "center", "right"]


class TextElement(BaseModel):
    id: str = ""
    type: Literal["text"] = "text"
    text: str = ""
    x: float = Field(default=0.5, ge=0.0, le=1.0)  # centro X normalizado
    y: float = Field(default=0.5, ge=0.0, le=1.0)  # centro Y normalizado
    w: float = Field(default=0.8, gt=0.0, le=1.0)  # largura máx (wrap), fração W
    rotation: float = Field(default=0.0, ge=-180.0, le=180.0)
    align: Align = "center"
    font: FontKey = "sans-bold"
    color: str = "#FFFFFF"
    size_factor: float = Field(default=0.07, gt=0.0, le=0.3)
    scrim: Scrim = Field(default_factory=Scrim)
    outline: Outline = Field(default_factory=Outline)

    _v = field_validator("color")(_valid_hex)

    def font_candidates(self) -> list[str]:
        return FONT_CANDIDATES[self.font]


class StickerElement(BaseModel):
    id: str = ""
    type: Literal["sticker"] = "sticker"
    emoji: str = ""  # o(s) caractere(s) do emoji; o server busca o PNG (Noto)
    x: float = Field(default=0.5, ge=0.0, le=1.0)
    y: float = Field(default=0.5, ge=0.0, le=1.0)
    w: float = Field(default=0.2, gt=0.0, le=1.0)  # largura do sticker, fração W
    rotation: float = Field(default=0.0, ge=-180.0, le=180.0)


# União simples (smart mode): payload de texto sem "type" cai em TextElement
# (default "text"); com "type":"sticker" casa StickerElement. Evita exigir o
# discriminador explícito e mantém compat com docs antigos.
Element = Union[TextElement, StickerElement]


class Photo(BaseModel):
    """Enquadramento da foto no primeiro plano (crop/zoom/pan).

    scale=1 => 'ajustar' (foto inteira, blur nas bordas). scale>1 dá zoom e corta.
    offset_x/y deslocam a foto (fração da largura/altura do frame). Default = como
    era antes (contain centralizado), então docs antigos não mudam.
    """

    scale: float = Field(default=1.0, ge=1.0, le=5.0)
    offset_x: float = Field(default=0.0, ge=-1.0, le=1.0)
    offset_y: float = Field(default=0.0, ge=-1.0, le=1.0)


class StoryDoc(BaseModel):
    version: int = 1
    photo: Photo = Field(default_factory=Photo)
    elements: list[Element] = Field(default_factory=list)

    @classmethod
    def parse(cls, raw: str | None) -> "StoryDoc | None":
        """String JSON -> StoryDoc. None/vazio -> None (usa caminho legado)."""
        if not raw or not raw.strip():
            return None
        return cls.model_validate_json(raw)

    def texts(self) -> str:
        """Concatena os textos (pra guardar em media.caption / listagens)."""
        return "\n".join(
            e.text for e in self.elements if isinstance(e, TextElement) and e.text.strip()
        )

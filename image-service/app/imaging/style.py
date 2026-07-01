"""Configuração de estilo do caption (presets).

O painel resolve o preset escolhido pelo usuário e manda este objeto (JSON) pro
`/preview` e `/process`. O image-service continua stateless: não conhece presets,
só aplica o `StyleConfig` recebido. Ausência de style = "classic" (o visual
histórico), garantindo zero regressão pra posts sem preset.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Chave de fonte -> candidatos por SO. Linux (container) primeiro: o Dockerfile
# instala `fonts-dejavu`, que traz as quatro variantes num só pacote (sem binário
# no repo, licença livre). Windows/macOS são fallback pro dev local.
FONT_CANDIDATES: dict[str, list[str]] = {
    "sans-bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ],
    "serif": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "C:/Windows/Fonts/timesbd.ttf",
        "/Library/Fonts/Times New Roman Bold.ttf",
    ],
    "condensed": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ],
    "mono": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "C:/Windows/Fonts/consolab.ttf",
        "/Library/Fonts/Menlo.ttc",
    ],
}

FontKey = Literal["sans-bold", "serif", "condensed", "mono"]
Position = Literal["auto", "top", "center", "bottom"]

_HEX = "#0123456789abcdefABCDEF"


def _valid_hex(v: str) -> str:
    s = v.strip()
    if not (s.startswith("#") and len(s) == 7 and all(c in _HEX for c in s[1:])):
        raise ValueError(f"cor inválida (esperado #RRGGBB): {v!r}")
    return s.upper()


def hex_to_rgb(v: str) -> tuple[int, int, int]:
    s = v.lstrip("#")
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


class Scrim(BaseModel):
    """Caixa sombreada atrás do texto (legibilidade)."""

    enabled: bool = True
    color: str = "#000000"
    opacity: int = Field(default=110, ge=0, le=255)
    # adaptive: mede a luminância local e escolhe a opacidade (110/160), como no
    # comportamento histórico. Se False, usa `opacity` fixa.
    adaptive: bool = True

    _v = field_validator("color")(_valid_hex)


class Outline(BaseModel):
    """Contorno no texto — alternativa ao scrim (fica limpo, sem caixa)."""

    enabled: bool = False
    color: str = "#000000"
    width: int = Field(default=3, ge=0, le=20)

    _v = field_validator("color")(_valid_hex)


class StyleConfig(BaseModel):
    """Estilo completo do caption. Defaults = visual 'classic' histórico."""

    font: FontKey = "sans-bold"
    text_color: str = "#FFFFFF"
    scrim: Scrim = Field(default_factory=Scrim)
    outline: Outline = Field(default_factory=Outline)
    position: Position = "auto"
    size_factor: float = Field(default=0.066, gt=0.0, le=0.2)

    _v = field_validator("text_color")(_valid_hex)

    def font_candidates(self) -> list[str]:
        return FONT_CANDIDATES[self.font]

    @classmethod
    def parse(cls, raw: str | None) -> "StyleConfig":
        """De uma string JSON (ou None) pro modelo. None/vazio = classic."""
        if not raw or not raw.strip():
            return cls()
        return cls.model_validate_json(raw)

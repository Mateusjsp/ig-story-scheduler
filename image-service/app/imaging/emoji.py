"""Emoji como imagem (sticker), estilo teclado — Noto Emoji (open, colorido).

O painel e o server usam o MESMO PNG (Noto 512), então o emoji no editor bate
com o publicado. Busca sob demanda no CDN e cacheia em memória. Falha = elemento
pulado (não quebra o render).
"""
from __future__ import annotations

import io
import urllib.request
from functools import lru_cache

from PIL import Image

# {} = codepoints em hex minúsculo juntados por '_', sem o seletor de variação FE0F.
NOTO_URL = "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/png/512/emoji_u{}.png"


def codepoints(ch: str) -> str:
    """'❤️' -> '2764' ; '😀' -> '1f600'. Ignora FE0F (variation selector)."""
    return "_".join(f"{ord(c):x}" for c in ch if ord(c) != 0xFE0F)


@lru_cache(maxsize=512)
def emoji_image(ch: str) -> Image.Image | None:
    """PNG do emoji como RGBA (ou None se indisponível). Cacheado por caractere."""
    cp = codepoints(ch)
    if not cp:
        return None
    try:
        with urllib.request.urlopen(NOTO_URL.format(cp), timeout=10) as resp:
            data = resp.read()
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:  # noqa: BLE001 — sem rede / emoji inexistente: pula
        return None

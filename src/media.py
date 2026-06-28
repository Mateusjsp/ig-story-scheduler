"""Validação e ajuste de imagem para o formato de Story (9:16, 1080x1920)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

STORY_SIZE = (1080, 1920)  # largura x altura, 9:16
MAX_BYTES = 8 * 1024 * 1024  # 8 MB (limite da API para imagem)
BLUR_RADIUS = 40  # intensidade do fundo borrado


def check_photo(path: Path) -> list[str]:
    """Retorna lista de avisos (vazia = ok)."""
    warnings: list[str] = []
    if path.stat().st_size > MAX_BYTES:
        warnings.append(f"{path.name}: maior que 8 MB, a API pode recusar.")
    with Image.open(path) as img:
        w, h = img.size
        ratio = w / h
        if abs(ratio - 9 / 16) > 0.02:
            warnings.append(
                f"{path.name}: proporção {w}x{h} não é 9:16; pode haver corte."
            )
    return warnings


def is_story_ready(path: Path) -> bool:
    """True se a foto já está em 1080x1920 (padrão Story)."""
    with Image.open(path) as img:
        return img.size == STORY_SIZE


def _cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Redimensiona+corta pra PREENCHER size (cobre tudo, corta o excesso)."""
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    nw, nh = round(img.width * scale), round(img.height * scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    x = (nw - tw) // 2
    y = (nh - th) // 2
    return resized.crop((x, y, x + tw, y + th))


def make_story_ready(src: Path, dest: Path | None = None) -> Path:
    """Normaliza a foto pro padrão Story 1080x1920 com fundo blur.

    Fundo = a própria foto ampliada+borrada (preenche a tela). Foto original
    nítida e inteira no centro (sem corte, sem distorção). Salva em `dest`
    (default: sobrescreve `src` in-place).
    """
    dest = dest or src
    with Image.open(src) as raw:
        img = raw.convert("RGB")  # carrega os dados; raw pode fechar

    background = _cover(img, STORY_SIZE).filter(ImageFilter.GaussianBlur(BLUR_RADIUS))

    foreground = img.copy()
    foreground.thumbnail(STORY_SIZE, Image.LANCZOS)  # cabe inteira (sem corte)
    x = (STORY_SIZE[0] - foreground.width) // 2
    y = (STORY_SIZE[1] - foreground.height) // 2
    background.paste(foreground, (x, y))

    background.save(dest, "JPEG", quality=90)
    return dest

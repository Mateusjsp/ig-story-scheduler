"""Validação e ajuste de imagem para o formato de Story (9:16, 1080x1920)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

STORY_SIZE = (1080, 1920)  # largura x altura, 9:16
MAX_BYTES = 8 * 1024 * 1024  # 8 MB (limite da API para imagem)


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


def make_story_ready(src: Path, dest: Path) -> Path:
    """Reenquadra a foto em 1080x1920 (fundo preto, sem distorcer). Opcional.

    Útil se você quiser normalizar tudo antes de subir pro repo.
    """
    with Image.open(src) as img:
        img = img.convert("RGB")
        img.thumbnail(STORY_SIZE, Image.LANCZOS)
        canvas = Image.new("RGB", STORY_SIZE, (0, 0, 0))
        x = (STORY_SIZE[0] - img.width) // 2
        y = (STORY_SIZE[1] - img.height) // 2
        canvas.paste(img, (x, y))
        canvas.save(dest, "JPEG", quality=90)
    return dest

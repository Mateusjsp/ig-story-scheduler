"""Tratamento de imagem pro padrão Story (9:16, 1080x1920).

Versão do serviço: trabalha em memória (bytes/PIL), não em arquivos. A lógica de
enquadramento (blur fill) e overlay de texto é a mesma do CLI original, só que
exposta como funções puras pros endpoints do FastAPI consumirem.
"""
from __future__ import annotations

import io

from PIL import Image, ImageFilter, ImageOps

from app.imaging.document import Photo, StoryDoc
from app.imaging.style import StyleConfig
from app.imaging.text_overlay import overlay_text, render_document

STORY_SIZE = (1080, 1920)  # largura x altura, 9:16
MAX_BYTES = 8 * 1024 * 1024  # 8 MB (limite da API para imagem)
BLUR_RADIUS = 40  # intensidade do fundo borrado
JPEG_QUALITY = 90


def _cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Redimensiona+corta pra PREENCHER size (cobre tudo, corta o excesso)."""
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    nw, nh = round(img.width * scale), round(img.height * scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    x = (nw - tw) // 2
    y = (nh - th) // 2
    return resized.crop((x, y, x + tw, y + th))


def build_story_image(
    img: Image.Image,
    caption: str | None = None,
    style: StyleConfig | None = None,
    doc: StoryDoc | None = None,
) -> Image.Image:
    """Normaliza pro padrão Story 1080x1920 com fundo blur e (opcional) texto.

    Fundo = a própria foto ampliada+borrada (preenche a tela). Foto original
    nítida e inteira no centro (sem corte). Precedência do texto: `doc` (editor de
    camadas) > `caption`+`style` (legado, placement automático).
    """
    img = img.convert("RGB")
    background = _cover(img, STORY_SIZE).filter(ImageFilter.GaussianBlur(BLUR_RADIUS))

    # Enquadramento do primeiro plano: base = contain (scale 1), com zoom/pan.
    photo = (doc.photo if doc is not None else None) or Photo()
    fw, fh = STORY_SIZE
    iw, ih = img.size
    fit = min(fw / iw, fh / ih)
    aw = max(1, round(iw * fit * photo.scale))
    ah = max(1, round(ih * fit * photo.scale))
    foreground = img.resize((aw, ah), Image.LANCZOS)
    x = round((fw - aw) / 2 + photo.offset_x * fw)
    y = round((fh - ah) / 2 + photo.offset_y * fh)
    background.paste(foreground, (x, y))  # PIL recorta o que sai do frame

    if doc is not None and doc.elements:
        background = render_document(background, doc)
    elif caption:
        background = overlay_text(background, caption, style)
    return background


def process_image_bytes(
    data: bytes,
    caption: str | None = None,
    style: StyleConfig | None = None,
    doc: StoryDoc | None = None,
) -> bytes:
    """Recebe bytes de uma imagem, devolve JPEG 1080x1920 pronto pro Story."""
    with Image.open(io.BytesIO(data)) as raw:
        # Câmeras de celular gravam a foto no sensor + tag EXIF Orientation.
        # exif_transpose aplica a rotação nos pixels (senão sai deitada).
        img = ImageOps.exif_transpose(raw).convert("RGB")
    story = build_story_image(img, caption, style, doc)
    out = io.BytesIO()
    story.save(out, "JPEG", quality=JPEG_QUALITY)
    return out.getvalue()

"""Tratamento de imagem pro padrão Story (9:16, 1080x1920).

Versão do serviço: trabalha em memória (bytes/PIL), não em arquivos. A lógica de
enquadramento (blur fill) e overlay de texto é a mesma do CLI original, só que
exposta como funções puras pros endpoints do FastAPI consumirem.
"""
from __future__ import annotations

import io

from PIL import Image, ImageFilter, ImageOps

try:  # habilita abrir HEIC/HEIF (iPhone). Ausente no dev local? degrada sem quebrar.
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # noqa: BLE001
    pass

from app.imaging.document import Photo, StoryDoc
from app.imaging.style import StyleConfig
from app.imaging.text_overlay import overlay_text, render_document

STORY_SIZE = (1080, 1920)  # largura x altura, 9:16

# Tamanhos de saída por destino. Story = 9:16 (tela cheia); feed aceita 4:5
# (retrato, o mais alto permitido) e 1:1 (quadrado). Todos partem da mesma
# lógica de blur-fill — só muda a proporção do frame.
TARGET_SIZES: dict[str, tuple[int, int]] = {
    "story": STORY_SIZE,
    "feed_45": (1080, 1350),
    "feed_11": (1080, 1080),
}
DEFAULT_TARGET = "story"


def resolve_size(target: str | None) -> tuple[int, int]:
    """Nome do destino -> (largura, altura). Ausente/desconhecido -> Story (9:16)."""
    return TARGET_SIZES.get(target or DEFAULT_TARGET, STORY_SIZE)


def validate_target(target: str | None) -> str:
    """Nome do destino validado. Desconhecido -> ValueError (endpoint devolve 400)."""
    t = target or DEFAULT_TARGET
    if t not in TARGET_SIZES:
        raise ValueError(f"target inválido: {t!r} (use {sorted(TARGET_SIZES)})")
    return t


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
    size: tuple[int, int] = STORY_SIZE,
) -> Image.Image:
    """Normaliza pro frame `size` (default Story 1080x1920) com fundo blur e texto.

    Fundo = a própria foto ampliada+borrada (preenche o frame). Foto original
    nítida e inteira no centro (sem corte). Precedência do texto: `doc` (editor de
    camadas) > `caption`+`style` (legado, placement automático). `size` decide a
    proporção (story 9:16, feed 4:5 ou 1:1) — a lógica é a mesma pra qualquer uma.
    """
    img = img.convert("RGB")
    background = _cover(img, size).filter(ImageFilter.GaussianBlur(BLUR_RADIUS))

    # Enquadramento do primeiro plano: base = contain (scale 1), com zoom/pan.
    photo = (doc.photo if doc is not None else None) or Photo()
    fw, fh = size
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


PREVIEW_MAX = 1440  # lado maior do preview web (leve pro browser)


def normalize_for_web(data: bytes) -> bytes:
    """Converte qualquer imagem (inclusive HEIC) num JPEG reduzido, já com a
    orientação EXIF aplicada — pro editor exibir a foto no browser."""
    with Image.open(io.BytesIO(data)) as raw:
        img = ImageOps.exif_transpose(raw).convert("RGB")
    img.thumbnail((PREVIEW_MAX, PREVIEW_MAX), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


def process_image_bytes(
    data: bytes,
    caption: str | None = None,
    style: StyleConfig | None = None,
    doc: StoryDoc | None = None,
    target: str | None = None,
) -> bytes:
    """Recebe bytes de uma imagem, devolve JPEG pronto pro destino (`target`).

    `target`: "story" (9:16, default), "feed_45" (4:5) ou "feed_11" (1:1).
    """
    with Image.open(io.BytesIO(data)) as raw:
        # Câmeras de celular gravam a foto no sensor + tag EXIF Orientation.
        # exif_transpose aplica a rotação nos pixels (senão sai deitada).
        img = ImageOps.exif_transpose(raw).convert("RGB")
    out_img = build_story_image(img, caption, style, doc, size=resolve_size(target))
    out = io.BytesIO()
    out_img.save(out, "JPEG", quality=JPEG_QUALITY)
    return out.getvalue()

"""Overlay de texto com placement consciente de conteúdo (Fase 1).

Coloca o texto DENTRO da zona segura do Story (evita a UI do Instagram no topo
e rodapé) e no ponto menos "agitado" da imagem — a faixa com menor densidade de
bordas (céu, parede, fundo liso) — com um scrim (fundo sombreado) adaptativo que
garante legibilidade sem tampar conteúdo importante.

Estratégia (leve, sem ML):
  1. zona segura: ignora topo ~14% e rodapé ~18% (cobertos pela UI do IG)
  2. busyness: mapa de gradiente (proxy de bordas); escolhe a faixa mais calma
  3. scrim adaptativo: opacidade do fundo ajustada pela luminância local

Evolução futura: detecção de rosto (Fase 2), saliency/segmentação (Fase 3).
"""
from __future__ import annotations

import logging
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.imaging.style import StyleConfig, hex_to_rgb

# Zona segura do Story (frações da altura): topo/rodapé são cobertos pela UI.
SAFE_TOP = 0.14
SAFE_BOTTOM = 0.82
SIDE_MARGIN = 0.08        # margem lateral (fração da largura)
MIN_FONT_SIZE = 28

# Fase 2: penalidade por cobrir rosto. Grande o bastante pra dominar a busyness
# (busyness média ~0-50), então qualquer sobreposição com cara é fortemente evitada.
FACE_PENALTY_WEIGHT = 1000.0
# Rosto mínimo ~ fração da largura. Story costuma ter rosto grande; exigir >=10%
# corta a maioria dos falsos positivos do Haar (números, texturas) sem perder
# o sujeito. Faces muito pequenas/distantes não são protegidas (trade-off aceito).
FACE_MIN_SIZE_FACTOR = 0.10
FACE_MIN_NEIGHBORS = 6  # mais alto = menos falso positivo

def _load_font(
    candidates: list[str], size: int
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Primeira TTF que carregar, da lista de candidatos da fonte escolhida.

    STORY_FONT_PATH (se setado) tem prioridade — útil pra forçar uma fonte
    específica no dev/CI sem tocar no código.
    """
    paths: list[str] = []
    if os.getenv("STORY_FONT_PATH"):
        paths.append(os.environ["STORY_FONT_PATH"])
    paths += candidates
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    # Nenhuma TTF encontrada (ex.: container sem fonts-dejavu). O default é um
    # bitmap minúsculo -> caption fica ilegível no Story. Avisa alto e tenta
    # escalar (Pillow >=10 aceita size no load_default).
    logging.getLogger("text_overlay").warning(
        "Nenhuma fonte TTF encontrada (%s). Instale fonts-dejavu ou defina "
        "STORY_FONT_PATH; o texto sairá minúsculo.",
        paths,
    )
    try:
        return ImageFont.load_default(size)
    except TypeError:  # Pillow <10 não aceita size
        return ImageFont.load_default()


def _gradient_magnitude(img: Image.Image) -> np.ndarray:
    """Mapa de 'agitação': soma das diferenças de luminância (proxy de bordas)."""
    g = np.asarray(img.convert("L"), dtype=np.float32)
    gx = np.zeros_like(g)
    gy = np.zeros_like(g)
    gx[:, :-1] = np.abs(g[:, 1:] - g[:, :-1])
    gy[:-1, :] = np.abs(g[1:, :] - g[:-1, :])
    return gx + gy


def _wrap_lines(draw: ImageDraw.ImageDraw, text, font, max_w: float) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines() or [text]:
        cur = ""
        for word in paragraph.split():
            trial = f"{cur} {word}".strip()
            if not cur or draw.textlength(trial, font=font) <= max_w:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return [ln for ln in lines if ln != ""] or [text]


def _detect_faces(img: Image.Image) -> list[tuple[int, int, int, int]]:
    """Caixas de rosto (x, y, w, h). Vazio se OpenCV ausente ou sem rosto.

    OpenCV é opcional: sem ele, a Fase 2 degrada pra Fase 1 (só busyness).
    """
    try:
        import cv2
    except ImportError:
        return []
    gray = np.asarray(img.convert("L"))
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    min_side = int(img.width * FACE_MIN_SIZE_FACTOR)
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=FACE_MIN_NEIGHBORS,
        minSize=(min_side, min_side),
    )
    return [(int(x), int(y), int(w), int(h)) for (x, y, w, h) in faces]


def _face_overlap_fraction(faces, y, block_h, x0, x1) -> float:
    """Fração da faixa de texto coberta por algum rosto (0..1)."""
    band_area = block_h * (x1 - x0)
    if band_area <= 0:
        return 0.0
    overlap = 0
    for fx, fy, fw, fh in faces:
        ix0, iy0 = max(x0, fx), max(y, fy)
        ix1, iy1 = min(x1, fx + fw), min(y + block_h, fy + fh)
        if ix1 > ix0 and iy1 > iy0:
            overlap += (ix1 - ix0) * (iy1 - iy0)
    return overlap / band_area


def _pick_y(grad, faces, top, bottom, block_h, x0, x1, step) -> int:
    """Faixa vertical de menor custo: busyness + penalidade por cobrir rosto."""
    best_y, best = top, None
    y = top
    limit = bottom - block_h
    while y <= limit:
        busyness = float(grad[y : y + block_h, x0:x1].mean())
        penalty = FACE_PENALTY_WEIGHT * _face_overlap_fraction(faces, y, block_h, x0, x1)
        score = busyness + penalty
        if best is None or score < best:
            best, best_y = score, y
        y += step
    return best_y


def _fixed_y(position: str, top: int, bottom: int, block_h: int) -> int:
    """Topo da faixa pra posições fixas, dentro da zona segura."""
    if position == "top":
        return top
    if position == "bottom":
        return max(top, bottom - block_h)
    # center
    return max(top, top + (bottom - top - block_h) // 2)


def overlay_text(
    img: Image.Image, text: str, style: StyleConfig | None = None
) -> Image.Image:
    """Desenha `text` na imagem (in-memory) com o estilo do preset.

    `style=None` usa o visual 'classic' (StyleConfig padrão). Retorna nova imagem
    RGB. Texto vazio = imagem inalterada.
    """
    text = (text or "").strip()
    if not text:
        return img.convert("RGB")

    style = style or StyleConfig()
    img = img.convert("RGB")
    W, H = img.size
    draw = ImageDraw.Draw(img, "RGBA")
    margin = int(W * SIDE_MARGIN)
    max_w = W - 2 * margin
    top = int(H * SAFE_TOP)
    bottom = int(H * SAFE_BOTTOM)
    avail_h = bottom - top

    text_rgb = hex_to_rgb(style.text_color)
    stroke_w = style.outline.width if style.outline.enabled else 0
    stroke_rgb = hex_to_rgb(style.outline.color)

    # Encolhe a fonte até o bloco caber na zona segura.
    size = max(MIN_FONT_SIZE, int(W * style.size_factor))
    while size >= MIN_FONT_SIZE:
        font = _load_font(style.font_candidates(), size)
        lines = _wrap_lines(draw, text, font, max_w)
        asc, desc = font.getmetrics()
        line_h = asc + desc
        gap = int(line_h * 0.2)
        block_h = len(lines) * line_h + (len(lines) - 1) * gap
        if block_h <= avail_h or size == MIN_FONT_SIZE:
            break
        size -= 4

    # Posição: 'auto' escolhe a faixa mais calma desviando de rostos; fixas
    # (top/center/bottom) pulam a análise e usam a banda pedida.
    if style.position == "auto":
        grad = _gradient_magnitude(img)
        faces = _detect_faces(img)
        step = max(8, line_h // 3)
        y0 = _pick_y(grad, faces, top, min(bottom, H), block_h, margin, W - margin, step)
    else:
        y0 = _fixed_y(style.position, top, min(bottom, H), block_h)

    block_w = max(draw.textlength(ln, font=font) for ln in lines)
    bx0 = (W - block_w) / 2.0

    # Scrim (caixa): opcional. Adaptativo mede a luminância local (fundo claro ->
    # mais forte); senão usa a opacidade fixa do preset. Se `outline`, o scrim
    # normalmente fica desligado e a legibilidade vem do contorno.
    if style.scrim.enabled:
        pad = int(size * 0.4)
        box = [bx0 - pad, y0 - pad / 2, bx0 + block_w + pad, y0 + block_h + pad / 2]
        scrim_rgb = hex_to_rgb(style.scrim.color)
        if style.scrim.adaptive:
            crop_box = (
                int(max(0, box[0])),
                int(max(0, box[1])),
                int(min(W, box[2])),
                int(min(H, box[3])),
            )
            luma = float(np.asarray(img.crop(crop_box).convert("L")).mean())
            alpha = 160 if luma > 130 else 110
        else:
            alpha = style.scrim.opacity
        draw.rounded_rectangle(
            box, radius=int(size * 0.35), fill=(*scrim_rgb, alpha)
        )

    # Texto, linhas centralizadas (com contorno se pedido).
    ty = y0
    for line in lines:
        lw = draw.textlength(line, font=font)
        draw.text(
            ((W - lw) / 2.0, ty),
            line,
            font=font,
            fill=(*text_rgb, 255),
            stroke_width=stroke_w,
            stroke_fill=(*stroke_rgb, 255),
        )
        ty += line_h + gap

    return img

"""Testes do overlay de texto e do placement consciente de conteúdo (Fases 1-2)."""
import numpy as np
from PIL import Image

import app.imaging.text_overlay as to
from app.imaging.text_overlay import (
    SAFE_BOTTOM,
    SAFE_TOP,
    _face_overlap_fraction,
    overlay_text,
)


def _half_busy_image() -> Image.Image:
    """1080x1920: metade de cima lisa (calma), metade de baixo com ruído (agitada)."""
    arr = np.zeros((1920, 1080, 3), dtype=np.uint8)
    arr[:960] = 200  # topo liso
    rng = np.random.default_rng(0)
    arr[960:] = rng.integers(0, 255, size=(960, 1080, 3), dtype=np.uint8)  # base ruidosa
    return Image.fromarray(arr, "RGB")


def test_overlay_keeps_size_and_mode():
    out = overlay_text(_half_busy_image(), "Oi")
    assert out.size == (1080, 1920)
    assert out.mode == "RGB"


def test_empty_caption_is_noop():
    base = _half_busy_image()
    out = overlay_text(base, "   ")
    assert np.array_equal(np.asarray(base), np.asarray(out))


def test_text_lands_in_calm_zone():
    """Texto deve cair na metade de cima (lisa), não na de baixo (ruidosa)."""
    base = _half_busy_image()
    out = overlay_text(base, "Texto de teste")
    diff = np.abs(np.asarray(base, int) - np.asarray(out, int)).sum(axis=2)
    rows = np.where(diff.sum(axis=1) > 0)[0]  # linhas que mudaram (onde foi desenhado)
    assert rows.size > 0
    center = rows.mean()
    assert center < 960  # centro do texto na metade de cima (calma)
    # e dentro da zona segura
    assert center > 1920 * SAFE_TOP
    assert center < 1920 * SAFE_BOTTOM


def test_face_overlap_fraction_geometry():
    # rosto cobre metade da faixa horizontalmente
    faces = [(0, 100, 100, 100)]  # x,y,w,h
    frac = _face_overlap_fraction(faces, y=100, block_h=100, x0=0, x1=200)
    assert abs(frac - 0.5) < 1e-6
    # rosto fora da faixa -> 0
    assert _face_overlap_fraction(faces, y=500, block_h=100, x0=0, x1=200) == 0.0


def test_text_avoids_face(monkeypatch):
    """Mesmo no topo calmo, o texto desvia de um rosto detectado ali."""
    base = _half_busy_image()  # topo (0..960) calmo
    face = (0, 280, 1080, 400)  # rosto cobrindo y=280..680 (dentro do topo calmo)
    monkeypatch.setattr(to, "_detect_faces", lambda img: [face])
    out = overlay_text(base, "Texto de teste")
    diff = np.abs(np.asarray(base, int) - np.asarray(out, int)).sum(axis=2)
    rows = np.where(diff.sum(axis=1) > 0)[0]
    # texto não pode invadir a faixa do rosto (280..680)
    assert ((rows >= 280) & (rows < 680)).sum() == 0

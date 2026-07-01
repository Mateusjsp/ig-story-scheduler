"""Testes do StyleConfig e do overlay parametrizado por preset."""
import numpy as np
import pytest
from PIL import Image

from app.imaging.style import StyleConfig, hex_to_rgb
from app.imaging.text_overlay import SAFE_TOP, overlay_text


def _flat_image() -> Image.Image:
    return Image.fromarray(np.full((1920, 1080, 3), 200, dtype=np.uint8), "RGB")


def test_parse_none_is_classic():
    s = StyleConfig.parse(None)
    assert s.font == "sans-bold"
    assert s.text_color == "#FFFFFF"
    assert s.position == "auto"


def test_parse_json_overrides():
    s = StyleConfig.parse('{"font":"serif","position":"top","text_color":"#ffd400"}')
    assert s.font == "serif"
    assert s.position == "top"
    assert s.text_color == "#FFD400"  # normalizado pra maiúsculo


def test_invalid_font_rejected():
    with pytest.raises(Exception):
        StyleConfig(font="comic")


def test_invalid_hex_rejected():
    with pytest.raises(Exception):
        StyleConfig(text_color="red")


def test_hex_to_rgb():
    assert hex_to_rgb("#FFD400") == (255, 212, 0)


def test_position_top_lands_high():
    """position=top põe o texto no começo da zona segura (não no meio)."""
    base = _flat_image()
    style = StyleConfig(position="top")
    out = overlay_text(base, "Texto no topo", style)
    diff = np.abs(np.asarray(base, int) - np.asarray(out, int)).sum(axis=2)
    rows = np.where(diff.sum(axis=1) > 0)[0]
    assert rows.size > 0
    # começa perto de SAFE_TOP (com folga do padding do scrim)
    assert rows.min() < 1920 * SAFE_TOP + 40


def test_outline_no_scrim_draws_text():
    """Contorno sem scrim ainda desenha (legibilidade sem caixa)."""
    base = _flat_image()
    style = StyleConfig(
        scrim={"enabled": False},
        outline={"enabled": True, "color": "#000000", "width": 4},
        text_color="#FFD400",
    )
    out = overlay_text(base, "Contorno", style)
    assert not np.array_equal(np.asarray(base), np.asarray(out))

"""Testes do documento de camadas (StoryDoc) e render multi-elemento."""
import numpy as np
import pytest
from PIL import Image

import app.imaging.text_overlay as to
from app.imaging.document import StickerElement, StoryDoc
from app.imaging.emoji import codepoints
from app.imaging.text_overlay import render_document


def _img() -> Image.Image:
    return Image.fromarray(np.full((1920, 1080, 3), 90, dtype=np.uint8), "RGB")


def test_parse_none_is_none():
    assert StoryDoc.parse(None) is None
    assert StoryDoc.parse("  ") is None


def test_parse_elements():
    doc = StoryDoc.parse('{"version":1,"elements":[{"type":"text","text":"Oi","x":0.5,"y":0.3}]}')
    assert doc is not None
    assert len(doc.elements) == 1
    assert doc.elements[0].text == "Oi"


def test_texts_concat():
    doc = StoryDoc.model_validate(
        {"elements": [{"text": "linha 1"}, {"text": " "}, {"text": "linha 2"}]}
    )
    assert doc.texts() == "linha 1\nlinha 2"


def test_invalid_coord_rejected():
    with pytest.raises(Exception):
        StoryDoc.model_validate({"elements": [{"text": "x", "x": 2.0}]})


def test_render_keeps_size_and_draws():
    base = _img()
    doc = StoryDoc.model_validate(
        {"elements": [{"text": "A", "x": 0.5, "y": 0.5, "size_factor": 0.1}]}
    )
    out = render_document(base, doc)
    assert out.size == (1080, 1920)
    assert not np.array_equal(np.asarray(base), np.asarray(out))


def test_empty_doc_is_noop():
    base = _img()
    out = render_document(base, StoryDoc())
    assert np.array_equal(np.asarray(base), np.asarray(out))


def test_photo_default_and_zoom_changes_output():
    from app.imaging.media import process_image_bytes
    import io as _io
    from PIL import Image as _Image, ImageDraw as _Draw

    src = _Image.new("RGB", (1600, 900), (30, 80, 130))
    _Draw.Draw(src).ellipse([700, 350, 900, 550], fill=(240, 140, 60))
    buf = _io.BytesIO()
    src.save(buf, "JPEG")
    data = buf.getvalue()

    fit = process_image_bytes(data, None, None, StoryDoc())
    zoom = process_image_bytes(
        data, None, None, StoryDoc.model_validate({"photo": {"scale": 2.0}})
    )
    assert fit != zoom  # zoom recorta -> bytes diferentes


def test_photo_rejects_bad_scale():
    with pytest.raises(Exception):
        StoryDoc.model_validate({"photo": {"scale": 0.5}})


def test_codepoints_drops_variation_selector():
    assert codepoints("😀") == "1f600"
    assert codepoints("❤️") == "2764"  # sem o FE0F


def test_parse_sticker_element():
    doc = StoryDoc.parse('{"elements":[{"type":"sticker","emoji":"😍","x":0.4,"y":0.6,"w":0.2}]}')
    assert doc is not None
    assert isinstance(doc.elements[0], StickerElement)
    assert doc.elements[0].emoji == "😍"


def test_render_sticker(monkeypatch):
    # não depende de rede: injeta um PNG fake pro emoji
    fake = Image.new("RGBA", (100, 100), (255, 0, 0, 255))
    monkeypatch.setattr(to, "emoji_image", lambda ch: fake)
    base = _img()
    doc = StoryDoc.model_validate(
        {"elements": [{"type": "sticker", "emoji": "😍", "x": 0.5, "y": 0.5, "w": 0.3}]}
    )
    out = render_document(base, doc)
    assert out.size == (1080, 1920)
    assert not np.array_equal(np.asarray(base), np.asarray(out))


def test_sticker_missing_is_skipped(monkeypatch):
    monkeypatch.setattr(to, "emoji_image", lambda ch: None)
    base = _img()
    doc = StoryDoc.model_validate({"elements": [{"type": "sticker", "emoji": "x"}]})
    out = render_document(base, doc)
    assert np.array_equal(np.asarray(base), np.asarray(out))  # nada desenhado


def test_two_elements_draw_in_different_places():
    base = _img()
    doc = StoryDoc.model_validate(
        {
            "elements": [
                {"text": "topo", "x": 0.5, "y": 0.2, "size_factor": 0.08},
                {"text": "base", "x": 0.5, "y": 0.8, "size_factor": 0.08},
            ]
        }
    )
    out = render_document(base, doc)
    diff = np.abs(np.asarray(base, int) - np.asarray(out, int)).sum(axis=2)
    rows = np.where(diff.sum(axis=1) > 0)[0]
    assert rows.min() < 1920 * 0.35  # elemento de cima
    assert rows.max() > 1920 * 0.65  # elemento de baixo

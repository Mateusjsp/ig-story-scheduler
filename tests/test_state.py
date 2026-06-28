"""Testes da lógica de fila (não tocam na API)."""
from pathlib import Path

from src.state import State, list_photos, next_photo


def test_state_roundtrip(tmp_path: Path):
    sf = tmp_path / "state.json"
    state = State(state_file=sf)
    state.record("001.jpg", "media_1")
    reloaded = State.load(sf)
    assert reloaded.next_index == 1
    assert reloaded.published[0]["filename"] == "001.jpg"


def test_next_photo_advances(tmp_path: Path):
    photos = tmp_path / "photos"
    photos.mkdir()
    for name in ["002.jpg", "001.jpg", "003.png"]:
        (photos / name).write_bytes(b"x")
    state = State(state_file=tmp_path / "state.json")

    # Ordenado por nome
    assert next_photo(photos, state).name == "001.jpg"
    state.next_index = 3
    assert next_photo(photos, state) is None
    assert len(list_photos(photos)) == 3

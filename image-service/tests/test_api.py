"""Testes dos endpoints do image-service."""
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.settings import get_settings

get_settings().service_shared_secret = "test-secret"

from app.main import app  # noqa: E402

client = TestClient(app)
HEADERS = {"X-Service-Token": "test-secret"}


def _png_bytes(size=(800, 1200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (120, 120, 120)).save(buf, "PNG")
    return buf.getvalue()


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_preview_returns_story_jpeg():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files, data={"caption": "Olá mundo"}, headers=HEADERS)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    out = Image.open(io.BytesIO(r.content))
    assert out.size == (1080, 1920)  # padrão Story


def test_preview_rejects_empty_file():
    files = {"file": ("vazio.png", b"", "image/png")}
    r = client.post("/preview", files=files, headers=HEADERS)
    assert r.status_code == 400


def test_preview_rejects_garbage():
    files = {"file": ("x.png", b"isso nao e imagem", "image/png")}
    r = client.post("/preview", files=files, headers=HEADERS)
    assert r.status_code == 400


def test_preview_requires_token():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files)  # sem header
    assert r.status_code == 401


def test_preview_rejects_wrong_token():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files, headers={"X-Service-Token": "errado"})
    assert r.status_code == 401

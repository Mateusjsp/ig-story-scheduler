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


def test_preview_feed_45_returns_portrait():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files, data={"target": "feed_45"}, headers=HEADERS)
    assert r.status_code == 200
    out = Image.open(io.BytesIO(r.content))
    assert out.size == (1080, 1350)  # feed retrato 4:5


def test_preview_feed_11_returns_square():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files, data={"target": "feed_11"}, headers=HEADERS)
    assert r.status_code == 200
    out = Image.open(io.BytesIO(r.content))
    assert out.size == (1080, 1080)  # feed quadrado 1:1


def test_preview_rejects_empty_file():
    files = {"file": ("vazio.png", b"", "image/png")}
    r = client.post("/preview", files=files, headers=HEADERS)
    assert r.status_code == 400


def test_preview_rejects_garbage():
    files = {"file": ("x.png", b"isso nao e imagem", "image/png")}
    r = client.post("/preview", files=files, headers=HEADERS)
    assert r.status_code == 400


def test_process_rejects_unknown_target():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    # 'feed' é o enum do banco, não um destino de render válido (feed_45/feed_11).
    r = client.post(
        "/process",
        files=files,
        data={"owner": "11111111-1111-1111-1111-111111111111", "target": "feed"},
        headers=HEADERS,
    )
    assert r.status_code == 400


def test_process_rejects_non_uuid_owner():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/process", files=files, data={"owner": "nao-e-uuid"}, headers=HEADERS)
    assert r.status_code == 400


def test_reprocess_rejects_path_outside_owner():
    r = client.post(
        "/reprocess",
        data={
            "owner": "11111111-1111-1111-1111-111111111111",
            "original_path": "22222222-2222-2222-2222-222222222222/original/x",
        },
        headers=HEADERS,
    )
    assert r.status_code == 403


def test_preview_requires_token():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files)  # sem header
    assert r.status_code == 401


def test_preview_rejects_wrong_token():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files, headers={"X-Service-Token": "errado"})
    assert r.status_code == 401

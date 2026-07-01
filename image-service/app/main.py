"""Image service (FastAPI).

Endpoints:
  GET  /health   -> liveness
  POST /preview  -> recebe imagem + caption, devolve o JPEG tratado (1080x1920,
                    blur fill + texto com placement inteligente). NÃO persiste.
  POST /process  -> igual ao /preview por enquanto; na Fase B grava no Supabase
                    Storage e retorna a URL pública usada pra publicar.

A lógica pesada (OpenCV/Pillow/numpy) vive aqui, num serviço sempre-no-ar, fora
do serverless do painel.
"""
from __future__ import annotations

import hmac
from contextlib import asynccontextmanager

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware

from app.imaging.media import STORY_SIZE, process_image_bytes
from app.imaging.style import StyleConfig
from app.scheduler import publish_due, start_scheduler
from app.settings import get_settings
from app.storage import upload_processed

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched = start_scheduler()  # None se Supabase não configurado
    try:
        yield
    finally:
        if sched:
            sched.shutdown(wait=False)


app = FastAPI(title="IG Story Image Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # original pode ser grande; saída é reduzida


def require_service_token(x_service_token: str | None = Header(default=None)) -> None:
    """Exige o segredo compartilhado com o painel. Sem ele -> 401."""
    expected = settings.service_shared_secret
    if not expected:
        raise HTTPException(
            status_code=503, detail="SERVICE_SHARED_SECRET não configurado."
        )
    if not x_service_token or not hmac.compare_digest(x_service_token, expected):
        raise HTTPException(status_code=401, detail="Token de serviço inválido.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "image-service", "version": app.version}


@app.post("/run-due")
def run_due(
    background_tasks: BackgroundTasks,
    _: None = Depends(require_service_token),
) -> dict:
    """Dispara uma passada do publicador (posts vencidos).

    Pensado pra ser chamado por um relógio externo (Supabase pg_cron) que também
    'acorda' o serviço em hosts que hibernam. Roda em background pra responder na
    hora — o trabalho de publicar não segura a request (importante no cold start).
    O claim atômico (claim_due_posts) evita publicação dupla com o scheduler.
    """
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_key):
        raise HTTPException(status_code=503, detail="Supabase não configurado.")
    background_tasks.add_task(publish_due)
    return {"status": "accepted"}


def _parse_style(style: str | None) -> StyleConfig:
    """JSON do preset -> StyleConfig. Ausente = 'classic'. Inválido -> 400."""
    try:
        return StyleConfig.parse(style)
    except Exception as exc:  # JSON malformado ou campo fora do schema
        raise HTTPException(status_code=400, detail=f"Style inválido: {exc}")


async def _read_and_process(
    file: UploadFile, caption: str | None, style: StyleConfig
) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Imagem maior que 25 MB.")
    try:
        return process_image_bytes(data, (caption or "").strip() or None, style)
    except Exception as exc:  # imagem inválida, formato não suportado, etc.
        raise HTTPException(status_code=400, detail=f"Falha ao processar: {exc}")


@app.post("/preview")
async def preview(
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    style: str | None = Form(default=None),
    _: None = Depends(require_service_token),
) -> Response:
    out = await _read_and_process(file, caption, _parse_style(style))
    return Response(content=out, media_type="image/jpeg")


@app.post("/process")
async def process(
    owner: str = Form(...),
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    style: str | None = Form(default=None),
    _: None = Depends(require_service_token),
) -> dict:
    """Trata a imagem, grava no Storage e retorna a URL pública (image_url)."""
    out = await _read_and_process(file, caption, _parse_style(style))
    try:
        path, url = upload_processed(owner, out)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha no Storage: {exc}")
    return {
        "processed_path": path,
        "processed_url": url,
        "width": STORY_SIZE[0],
        "height": STORY_SIZE[1],
    }

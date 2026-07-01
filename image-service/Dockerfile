FROM python:3.12-slim

# libglib2.0-0: exigido pelo opencv-python-headless em runtime.
# fonts-dejavu (full): fornece as variantes usadas pelos presets — Sans-Bold,
# Serif-Bold, SansCondensed-Bold e SansMono-Bold. Sem fonte, o overlay cai no
# ImageFont.load_default() (bitmap ~11px) e o caption fica invisível no Story de
# 1080px. A imagem slim não traz nenhuma fonte.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
# Shell form pra expandir $PORT (Render/Railway injetam a porta). Fallback 8000 local.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}

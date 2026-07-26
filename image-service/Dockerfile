# Pin em bookworm (Debian 12): a tag móvel python:3.12-slim avançou pra trixie
# (13), onde a transição time_t renomeou libglib2.0-0 -> libglib2.0-0t64,
# quebrando o apt-get abaixo (exit 100). bookworm mantém os nomes antigos e é o
# ambiente que já funcionava. Sem pin, o build volta a quebrar sozinho.
FROM python:3.12-slim-bookworm

# libglib2.0-0: exigido pelo opencv-python-headless em runtime.
# fonts-dejavu (full): fornece as variantes usadas pelos presets — Sans-Bold,
# Serif-Bold, SansCondensed-Bold e SansMono-Bold. Sem fonte, o overlay cai no
# ImageFont.load_default() (bitmap ~11px) e o caption fica invisível no Story de
# 1080px. A imagem slim não traz nenhuma fonte.
# fonts-pacifico (OFL): fonte "script"/manuscrita com personalidade (estilo IG),
# em /usr/share/fonts/truetype/pacifico/Pacifico.ttf. Pacote apt = sem binário no repo.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 fonts-dejavu fonts-pacifico \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

COPY . .

EXPOSE 8000
# Shell form pra expandir $PORT (Render/Railway injetam a porta). Fallback 8000 local.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}

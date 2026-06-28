# ig-story-scheduler

Automação para publicar **1 Story por dia** no Instagram, a partir de uma fila de fotos.
Usa a **Content Publishing API** oficial da Meta (caminho estável, não viola os Termos).

## Ideia base

- As fotos ficam em `photos/`, nomeadas pra ordenar (`001.jpg`, `002.jpg`, ...).
- `state.json` guarda o índice da próxima foto e o log do que já foi publicado.
- A cada execução, o script pega a próxima foto da fila, valida, publica como Story e avança o índice.
- O agendamento "1/dia" é externo: roda local (cron/Agendador), num VPS, ou via GitHub Actions.

A foto precisa estar acessível por **URL pública** no momento da publicação (a Meta faz
download dela). A forma mais simples: manter as fotos no próprio repositório e usar a URL
`raw.githubusercontent.com`. O `PUBLIC_BASE_URL` no `.env` aponta pra essa base.

## Arquitetura

```
src/
  config.py            # carrega .env
  state.py             # fila + índice + log (state.json)
  media.py             # valida/ajusta a imagem (9:16, 1080x1920)
  publishers/
    base.py            # interface Publisher (abstrata)
    graph_api.py       # implementação oficial (Meta Graph API)
  main.py              # orquestra: pega próxima foto -> publica -> avança
scripts/
  refresh_token.py     # renova o long-lived token (~60 dias)
```

Quer trocar pra outro backend (ex.: instagrapi) no futuro? Basta criar
`publishers/outra_coisa.py` implementando a mesma interface de `base.py`.

## Pré-requisitos (setup único, feito por você)

1. Converter o Instagram para conta **Business** e vincular a uma Página do Facebook.
2. Criar um app no [Meta for Developers](https://developers.facebook.com), adicionar o produto
   Instagram e **se adicionar como tester/role** (assim pula o App Review, pois é sua conta).
3. Gerar um **long-lived access token** e o **IG User ID**.
4. Copiar `.env.example` para `.env` e preencher.

## Rodando

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # preencha o .env

# Teste sem publicar (valida tudo, monta a URL, NÃO posta):
python -m src.main --dry-run

# Publica a próxima foto de verdade:
python -m src.main
```

## Agendamento 1/dia

- **Local (Linux/macOS):** `crontab -e` → `0 9 * * * cd /caminho && .venv/bin/python -m src.main`
- **GitHub Actions:** veja `.github/workflows/post-story.yml` (cron diário, token via Secret).

## Notas

- Stories são **9:16**. Prepare as fotos em **1080×1920** pra evitar corte.
- **Stickers (link, enquete, localização) não funcionam** via API — só foto + menção.
- O token expira em ~60 dias. Rode `scripts/refresh_token.py` antes disso (ou agende).

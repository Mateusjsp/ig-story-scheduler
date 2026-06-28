"""Entrypoint: pega a próxima foto da fila e publica como Story.

Uso:
    python -m src.main            # publica de verdade
    python -m src.main --dry-run  # valida e monta a URL, mas NÃO publica
"""
from __future__ import annotations

import argparse
import sys

from src.config import load_config
from src.media import check_photo
from src.publishers.graph_api import GraphApiPublisher
from src.state import State, next_photo


def main() -> int:
    parser = argparse.ArgumentParser(description="Publica 1 Story por execução.")
    parser.add_argument(
        "--dry-run", action="store_true", help="Não publica; só valida e mostra a URL."
    )
    args = parser.parse_args()

    cfg = load_config()
    state = State.load(cfg.state_file)

    photo = next_photo(cfg.photos_dir, state)
    if photo is None:
        print("Fila vazia — todas as fotos já foram publicadas. Nada a fazer.")
        return 0

    image_url = f"{cfg.public_base_url}/{photo.name}"
    print(f"Próxima foto: {photo.name}")
    print(f"URL pública:  {image_url}")

    for warning in check_photo(photo):
        print(f"  aviso: {warning}")

    if args.dry_run:
        print("[dry-run] Nada publicado.")
        return 0

    publisher = GraphApiPublisher(cfg)
    try:
        media_id = publisher.publish_story(image_url)
    except RuntimeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 1

    state.record(photo.name, media_id)
    restantes = len(_remaining(cfg, state))
    print(f"Publicado! media_id={media_id}. Restam {restantes} foto(s) na fila.")
    return 0


def _remaining(cfg, state):
    from src.state import list_photos

    return list_photos(cfg.photos_dir)[state.next_index:]


if __name__ == "__main__":
    raise SystemExit(main())

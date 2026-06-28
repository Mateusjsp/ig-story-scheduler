"""Normaliza as fotos de photos/ pro padrão Story (1080x1920, fundo blur), in-place.

Rode depois de jogar fotos novas em photos/ e antes de publicar:
    python -m src.prepare

Fotos já em 1080x1920 são puladas (idempotente).
"""
from __future__ import annotations

from src.config import ROOT
from src.media import is_story_ready, make_story_ready
from src.state import list_photos

PHOTOS_DIR = ROOT / "photos"


def main() -> int:
    photos = list_photos(PHOTOS_DIR)
    if not photos:
        print("Nenhuma foto em photos/. Nada a fazer.")
        return 0

    treated = skipped = 0
    for p in photos:
        if is_story_ready(p):
            print(f"  {p.name}: já 1080x1920 — pulando.")
            skipped += 1
            continue
        make_story_ready(p)  # in-place
        print(f"  {p.name}: normalizado -> 1080x1920 (fundo blur).")
        treated += 1

    print(f"Pronto. {treated} tratada(s), {skipped} já ok.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

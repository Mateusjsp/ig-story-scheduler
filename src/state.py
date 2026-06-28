"""Gerencia a fila de fotos: qual é a próxima, o que já foi publicado."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

VALID_EXT = {".jpg", ".jpeg", ".png"}


@dataclass
class State:
    state_file: Path
    next_index: int = 0
    published: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, state_file: Path) -> "State":
        if state_file.exists():
            data = json.loads(state_file.read_text(encoding="utf-8"))
            return cls(
                state_file=state_file,
                next_index=data.get("next_index", 0),
                published=data.get("published", []),
            )
        return cls(state_file=state_file)

    def save(self) -> None:
        payload = {"next_index": self.next_index, "published": self.published}
        self.state_file.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def record(self, filename: str, media_id: str) -> None:
        self.published.append(
            {
                "filename": filename,
                "media_id": media_id,
                "published_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        self.next_index += 1
        self.save()


def list_photos(photos_dir: Path) -> list[Path]:
    """Retorna as fotos ordenadas pelo nome (use 001.jpg, 002.jpg, ...)."""
    return sorted(
        p for p in photos_dir.iterdir() if p.suffix.lower() in VALID_EXT
    )


def next_photo(photos_dir: Path, state: State) -> Path | None:
    """Próxima foto da fila, ou None se acabou."""
    photos = list_photos(photos_dir)
    if state.next_index >= len(photos):
        return None
    return photos[state.next_index]

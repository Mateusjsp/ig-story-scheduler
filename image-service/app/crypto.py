"""Decifra tokens cifrados pelo painel (AES-256-GCM).

Espelha web/lib/crypto.ts:
  chave  = SHA-256(TOKEN_ENC_KEY)
  blob   = base64( iv[12] | tag[16] | ciphertext )
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.settings import get_settings


def _key() -> bytes:
    s = get_settings()
    if not s.token_enc_key:
        raise RuntimeError("TOKEN_ENC_KEY ausente.")
    return hashlib.sha256(s.token_enc_key.encode()).digest()


def decrypt_token(blob: str) -> str:
    raw = base64.b64decode(blob)
    iv, tag, ct = raw[:12], raw[12:28], raw[28:]
    plain = AESGCM(_key()).decrypt(iv, ct + tag, None)  # cryptography quer ct||tag
    return plain.decode("utf-8")


def encrypt_token(plain: str) -> str:
    """Cifra no mesmo formato do painel: base64( iv | tag | ct )."""
    iv = os.urandom(12)
    ct_tag = AESGCM(_key()).encrypt(iv, plain.encode("utf-8"), None)  # ct||tag
    ct, tag = ct_tag[:-16], ct_tag[-16:]
    return base64.b64encode(iv + tag + ct).decode("ascii")

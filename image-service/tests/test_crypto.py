"""Testes de cifragem e compatibilidade cruzada com o painel (web/lib/crypto.ts)."""
from app.settings import get_settings

get_settings().token_enc_key = "test-enc-key-123"

from app.crypto import decrypt_token, encrypt_token  # noqa: E402


def test_roundtrip():
    token = "IGAA_exemplo_de_token_123"
    assert decrypt_token(encrypt_token(token)) == token


def test_decrypts_blob_from_typescript():
    # Blob gerado pela implementação TS (web/lib/crypto.ts) com
    # TOKEN_ENC_KEY="test-enc-key-123" e plaintext "cross-lang-ok".
    # Regenere com o comando node do plano 003 se a cifragem mudar.
    blob = "7ai9MoRyRKLpC8yXe5p/+hEEZBKBgqhEwlfSHIuzqftO3VF+pnX292Q="
    assert decrypt_token(blob) == "cross-lang-ok"

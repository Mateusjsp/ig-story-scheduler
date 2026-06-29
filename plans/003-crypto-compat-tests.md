# Plan 003: Travar a compatibilidade de cifragem web↔Python com testes

> **Executor instructions**: Siga passo a passo. Rode cada verificação. STOP nas
> condições listadas. Ao fim, atualize `plans/README.md`.
>
> **Drift check**: monorepo **não-commitado** (working tree `main`, HEAD `bc4230d`).
> Compare os excerpts com o código vivo; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: working tree em `main` (HEAD `bc4230d`, não-commitado), 2026-06-29

## Why this matters

Os tokens do Instagram são cifrados no painel (TypeScript, `web/lib/crypto.ts`) e
decifrados no serviço Python (`image-service/app/crypto.py`) na hora de publicar. As
duas implementações precisam concordar **byte a byte** no formato (AES-256-GCM, layout
`base64(iv|tag|ct)`, chave = `SHA-256(TOKEN_ENC_KEY)`). Hoje **nenhum teste** garante
isso. Se alguém mexer num lado — ordem de iv/tag, tamanho do tag, encoding da chave — a
decifragem falha **silenciosamente** e TODA publicação para, sem erro óbvio. Este plano
adiciona (a) um teste de round-trip no Python, (b) um harness de teste no web (vitest)
com round-trip TS, e (c) um teste de **compatibilidade cruzada**: um blob gerado pela
implementação TS é decifrado pela Python com a plaintext esperada.

## Current state

- `web/lib/crypto.ts` — AES-256-GCM. Excerpt:

```ts
function key(): Buffer {
  const secret = process.env.TOKEN_ENC_KEY;
  if (!secret) throw new Error("TOKEN_ENC_KEY ausente.");
  return crypto.createHash("sha256").update(secret).digest();
}
export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}
export function decryptToken(blob: string): string { /* iv=0..12, tag=12..28, ct=28.. */ }
```

- `image-service/app/crypto.py` — espelho. Excerpt:

```python
def _key() -> bytes:
    return hashlib.sha256(s.token_enc_key.encode()).digest()

def decrypt_token(blob: str) -> str:
    raw = base64.b64decode(blob)
    iv, tag, ct = raw[:12], raw[12:28], raw[28:]
    plain = AESGCM(_key()).decrypt(iv, ct + tag, None)  # cryptography quer ct||tag
    return plain.decode("utf-8")
```

- Testes Python existentes ficam em `image-service/tests/` e rodam com `pytest`
  (config em `image-service/pyproject.toml`, `pythonpath = ["."]`). Exemplar:
  `image-service/tests/test_api.py`.
- O `web` **não tem** test runner instalado ainda. `web/package.json` tem scripts
  `dev`, `build`, `start`, `lint`. Stack: Next 16, TypeScript, ESM.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Testes Python | `cd image-service && pytest -q` | todos passam |
| Instalar vitest | `cd web && npm install -D vitest` | exit 0 |
| Testes web | `cd web && npm run test` | todos passam (após Step 2) |
| Gerar fixture TS | (comando node no Step 3) | imprime um base64 |

## Scope

**In scope:**
- `image-service/tests/test_crypto.py` (criar)
- `web/package.json` (adicionar script `test` + devDep vitest)
- `web/lib/crypto.test.ts` (criar)
- `image-service/.env.example` (garantir que `TOKEN_ENC_KEY` está documentado — já está)

**Out of scope (NÃO tocar):**
- `web/lib/crypto.ts` e `image-service/app/crypto.py` — são o **sujeito** do teste; NÃO
  os altere. Se um teste falhar, é sinal de bug real — vá pra STOP conditions.
- Qualquer outro teste existente.

## Git workflow

- Branch: `advisor/003-crypto-compat-tests`
- Commits conventional (ex.: `test: ...`).
- Sem push/PR salvo instrução.

## Steps

### Step 1: Teste de round-trip no Python

Crie `image-service/tests/test_crypto.py`. Como `decrypt_token`/`encrypt_token` leem a
chave de `get_settings().token_enc_key`, configure-a no teste:

```python
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
    # Gere/atualize com o comando node do Step 3.
    blob = "<<COLE_O_FIXTURE_DO_STEP_3>>"
    assert decrypt_token(blob) == "cross-lang-ok"
```

**Verify** (após colar o fixture no Step 3): `cd image-service && pytest -q tests/test_crypto.py` → passa.

### Step 2: Harness vitest no web + round-trip TS

Instale vitest e adicione o script:

```
cd web && npm install -D vitest
```

Em `web/package.json`, no bloco `"scripts"`, adicione:

```json
    "test": "vitest run"
```

Crie `web/lib/crypto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = "test-enc-key-123";
});

describe("crypto", () => {
  it("round-trips", () => {
    const t = "IGAA_exemplo_123";
    expect(decryptToken(encryptToken(t))).toBe(t);
  });
});
```

**Verify**: `cd web && npm run test` → 1 teste passa.

### Step 3: Gerar o fixture cross-lang e completar o teste Python

Rode este comando (na pasta `web`, que tem o `node_modules` com tipos, mas o script é
JS puro usando `node:crypto`):

```
cd web && TOKEN_ENC_KEY=test-enc-key-123 node -e "const c=require('node:crypto');const k=c.createHash('sha256').update(process.env.TOKEN_ENC_KEY).digest();const iv=c.randomBytes(12);const ci=c.createCipheriv('aes-256-gcm',k,iv);const ct=Buffer.concat([ci.update('cross-lang-ok','utf8'),ci.final()]);const tag=ci.getAuthTag();console.log(Buffer.concat([iv,tag,ct]).toString('base64'))"
```

Isso imprime um base64. Cole-o no lugar de `<<COLE_O_FIXTURE_DO_STEP_3>>` em
`image-service/tests/test_crypto.py`.

> Nota: o comando acima **replica** a lógica de `web/lib/crypto.ts` (mesma chave, mesmo
> layout iv|tag|ct). Ele existe só pra gerar um vetor fixo; o blob é determinístico o
> bastante pra ser decifrado, mesmo com iv aleatório, porque o iv vai embutido no blob.

**Verify**: `cd image-service && pytest -q tests/test_crypto.py` → `test_decrypts_blob_from_typescript` passa.

### Step 4: Rodar as suítes completas

**Verify**:
- `cd image-service && pytest -q` → todos passam (antigos + novos de crypto).
- `cd web && npm run test` → passa.

## Test plan

- Python: round-trip (`encrypt`→`decrypt`) e **compat cruzada** (decifra blob da TS).
- Web: round-trip TS.
- Padrão estrutural: `image-service/tests/test_api.py` (Python) e a forma vitest acima.
- A compat cruzada é o teste de maior valor: pega qualquer divergência de formato
  entre os dois lados.

## Done criteria

- [ ] `cd image-service && pytest -q` exits 0; `tests/test_crypto.py` existe e passa (2 testes)
- [ ] `cd web && npm run test` exits 0; `lib/crypto.test.ts` existe e passa
- [ ] `web/package.json` tem script `"test"` e devDep `vitest`
- [ ] `image-service/app/crypto.py` e `web/lib/crypto.ts` **inalterados** (`git status`)
- [ ] Linha de status atualizada em `plans/README.md`

## STOP conditions

Pare e reporte se:
- `test_decrypts_blob_from_typescript` FALHAR — isso significa que os dois lados **não
  são compatíveis** (bug real). NÃO altere `crypto.ts`/`crypto.py` pra "passar"; reporte
  a incompatibilidade com o erro exato.
- Os excerpts de "Current state" não baterem com o código vivo.
- `vitest` não rodar por incompatibilidade de ESM/TS após uma tentativa razoável
  (ex.: precisar de config extra) — reporte; não invente uma config grande.

## Maintenance notes

- Se algum dia mudar o algoritmo de cifragem (tag size, KDF, layout), os DOIS lados e
  o fixture do Step 3 precisam mudar juntos — este teste vai pegar se esquecerem um.
- O fixture é gerado com uma chave de teste fixa; nunca use `TOKEN_ENC_KEY` real em teste.
- Reviewer deve confirmar que o teste cruzado usa um blob **realmente** produzido pela
  lógica TS (não copiado da saída Python), senão não testa compatibilidade.

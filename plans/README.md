# Implementation Plans

Gerado pelo skill `improve`. Rodada 1 em 2026-06-29 (planos 001-007, DONE).
Rodada 2 em **2026-07-03** (planos 010-023, auditoria `standard` completa).
Executor: leia o plano inteiro antes de começar, honre as STOP conditions e
atualize sua linha ao terminar.

> **Contexto de versionamento (rodada 2)**: planos escritos contra o commit
> `2db4580` + **working tree com a feature de feed (plano 009) não commitada**.
> O drift check por SHA não enxerga essas mudanças — o executor deve comparar
> os excerpts "Current state" de cada plano com o código vivo. Recomenda-se
> **commitar o trabalho de feed antes** de executar os planos novos.

## Ordem de execução & status

| Plano | Título | Prioridade | Esforço | Depende de | Status |
|-------|--------|-----------|---------|------------|--------|
| 001 | Auth do image-service (segredo compartilhado) | P1 | S | — | DONE |
| 002 | OAuth do Instagram com `state` (anti-CSRF) | P1 | S | — | DONE |
| 003 | Testes de compat de cifragem web↔Python | P1 | S | — | DONE |
| 004 | Recuperar posts presos em "publishing" | P2 | S | — | DONE |
| 005 | Claim atômico de posts (anti-duplicação) | P2 | M | 004 | DONE |
| 006 | Validar data futura no agendamento | P3 | S | — | DONE |
| 007 | Pipeline de CI (pytest + build/lint) | P2 | S | — | DONE |
| 008 | Webhooks de menção/DM + app híbrido | — | L | App Review Meta | BLOCKED (externo) |
| 009 | Publicar no feed (foto 4:5/1:1) | — | M | — | DONE (F0-F3 no working tree; falta migration 0009 + teste real) |
| 010 | Validar dono do `account_id` (anti-IDOR) | P1 | S | — | DONE |
| 011 | Token fora de logs e `posts.error` | P1 | S | — | DONE |
| 012 | Allowlist do redirect `next` no auth callback | P1 | S | — | DONE |
| 013 | Publish idempotente (anti-duplicação no IG) | P1 | M | — | DONE |
| 014 | Corrida lote lento × requeue 10min | P2 | M | 013 | DONE |
| 015 | Refresh não demove conta em erro transitório | P2 | S | — | DONE |
| 016 | Validar JSON do doc antes do /process | P2 | S | — | DONE |
| 017 | Contrato TS↔Python do StoryDoc (fixtures) | P2 | M | — | DONE |
| 018 | Defesa em profundidade image-service + SQL | P2 | M | — | DONE |
| 019 | Testes de caracterização das rotas web | P2 | L | melhor após 010/012/016/018 | TODO |
| 020 | Lockfile Python (pip-tools) | P2 | S | — | DONE |
| 021 | Decompor story-editor.tsx | P3 | L | 019 (e 017 ajuda) | TODO |
| 022 | Baseline DX (ruff, typecheck, env.example, README) | P3 | S | — | TODO |
| 023 | Perf do render (preview reduzido, emoji vendorizado) | P3 | M | — | TODO |

Status: TODO | IN PROGRESS | DONE | BLOCKED (motivo) | REJECTED (motivo)

### Ordem recomendada (rodada 2)
1. **Segurança primeiro**: 010 → 011 → 012 (todos S, independentes).
2. **Confiabilidade do publisher**: 013 → 014 (014 exige 013); 015 junto (mesmo arquivo).
3. **Hardening/contrato**: 016, 017, 018 (independentes entre si).
4. **Fundação**: 020 e 022 encaixam a qualquer momento; 019 depois das guardas
   (010/012/016/018) pra caracterizar o comportamento novo; 021 SÓ depois do 019;
   023 por último (ganho de UX, risco de divergência de preview).

### Aplicação manual no Supabase (não há projeto live no repo)
- `0009_post_target.sql` (plano 009) — pendente.
- `0010_publish_marker.sql` (plano 013) — quando executado.
- `0011_harden_policies.sql` (plano 018) — quando executado.

## Notas de dependência
- **014 requer 013**: o heartbeat/lock do 014 REDUZ a chance de republicação;
  a guarda por `ig_media_id` do 013 é o que a IMPEDE. Sem 013, o 014 deixa a
  janela de duplicação aberta.
- **021 requer 019**: refactor de 747 linhas de canvas interativo sem rede de
  testes = regressão de gesto garantida.
- **011 e 015 tocam o mesmo `except` de `refresh_tokens`** — executar em
  sequência (qualquer ordem), não em paralelo.
- **017 e 019 criam ambos `web/lib/story-doc.test.ts`** — o segundo a executar
  amplia o arquivo em vez de criar.
- **020 e 022 tocam ambos o CI e o requirements.txt** — executar em sequência.

## Direction (opções de produto, não bugs — decisão do mantenedor)
- **Reels + carrossel** (fase F4 do plano 009): `publish()` genérico já aceita
  `REELS`; falta pipeline de vídeo + multi-container. Esforço L.
- **Cota da Meta (25 posts/24h, story+feed somam)**: com feed no ar o risco de
  falha em massa por 429 ficou real; hoje `_publish_one` não trata. Esforço M.
- **Histórico/analytics de publicação**: `ig_media_id` + `published_at` já são
  gravados; nada é mostrado pós-publish. Esforço M.
- **Webhook de menções/DM** (plano 008): bloqueado em App Review da Meta.

## Findings considered and rejected
- **Bucket público world-readable**: by-design — a Meta exige URL pública;
  caminhos com UUID. (rodada 1, mantido)
- **Token IGAA no `.env` raiz (legado)**: operação, não código — rotacionar no
  painel da Meta. (rodada 1, mantido)
- **`hasSecret` derivado de `app_id`** (connect/page.tsx:40): UX menor; o
  servidor já garante o invariante. Não vale plano.
- **Remover OpenCV** (só o caminho legado `position:"auto"` usa): exige
  confirmar que o caminho legado morreu — investigação futura, não fix.
- **Rate limit Meta**: reclassificado como Direction (acima), não bug.
- **Duplicação de publish por corrida**: NÃO rejeitado — virou 013/014.

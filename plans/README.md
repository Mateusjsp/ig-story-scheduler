# Implementation Plans

Gerado pelo skill `improve` em 2026-06-29 (efeito `standard`, todas as categorias).

> **Contexto de versionamento**: quando estes planos foram escritos, todo o monorepo
> (`web/`, `image-service/`, `supabase/`) estava **não-commitado** no working tree da
> branch `main` (HEAD `bc4230d` aponta pro CLI antigo). Por isso o "Drift check" por
> SHA não é confiável — o executor deve comparar os excerpts "Current state" de cada
> plano com o código vivo. Recomenda-se **commitar o monorepo antes** de executar, pra
> o drift check passar a funcionar.

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

> Aplicados direto no working tree em 2026-06-29 e verificados: `pytest -q` 15/15,
> `npm run lint`/`test`/`build` verdes, YAML do CI válido. A migration
> `0003_claim_posts.sql` precisa ser **aplicada manualmente** no Supabase (não há
> projeto live pra rodar). E `SERVICE_SHARED_SECRET` deve ser preenchido (igual) nos
> dois `.env` antes de subir.

Status: TODO | IN PROGRESS | DONE | BLOCKED (motivo) | REJECTED (motivo)

### Ordem recomendada
Segurança primeiro: **001 → 002 → 003**. Depois reliability do scheduler: **004 → 005**
(005 exige 004). **006** e **007** são independentes — encaixe quando quiser; o **007**
fica melhor por último porque o `npm test --if-present` já pega o vitest do 003.

## Notas de dependência
- **005 requer 004**: o claim atômico assume que `publish_due` já chama `requeue_stuck`
  (do 004) e que a transição pra `publishing` migrou pro SQL. Fazer 005 sem 004 deixa
  uma lacuna de recuperação.
- **003 antes de 006/007 (preferível, não obrigatório)**: 003 instala o vitest; com ele,
  006 ganha teste unitário e 007 roda os testes do web automaticamente.

## Categorias / leverage
- **Segurança (alta)**: 001 (serviço aberto que confia no `owner` do client), 002 (CSRF
  no OAuth).
- **Fragilidade silenciosa (alta)**: 003 (mismatch de cifragem para toda publicação sem
  erro óbvio).
- **Reliability (média)**: 004 (órfãos), 005 (duplicação multi-instância).
- **Robustez/DX**: 006 (agendamento no passado), 007 (gate de CI).

## Direction (não viraram plano — opções pro mantenedor)
Levantados na auditoria, ficam como decisões de produto, não bugs:
- **Rate limit da Meta** no scheduler (429 / limite de posts-dia por conta) — hoje
  `_publish_one` não trata; em volume, falha em massa.
- **Webhook de deauthorize/revogação** da Meta — conta revogada só vira `token_expired`
  no próximo refresh (tarde).
- **Editar/cancelar/reordenar** post agendado — o fluxo só **cria** hoje
  (`web/app/api/media/create`); sem update/delete na UI.
- **Histórico/analytics** de publicações por conta.

## Findings considered and rejected
- **Bucket público world-readable**: by-design — a Meta exige baixar a imagem por URL
  pública; os caminhos usam UUID (não-enumeráveis). Não é vulnerabilidade.
- **Token IGAA no `.env` raiz (legado)**: não vira plano de código — é operação. **Ação:
  rotacionar o token no painel da Meta** (foi exposto em chat). Os planos não referenciam
  o valor, só o tipo/local.

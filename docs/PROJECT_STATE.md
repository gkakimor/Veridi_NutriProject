# Veridi Nutrition — Project State

## Version
Baseline v0.4 — post-benchmark.

## Phase
FAST MVP.

---

# Current implemented state

**Delivery 01 — bootstrap do monorepo: concluído (código).**

Nenhum dos 21 módulos do MVP foi implementado. A fundação existe e está validada.

## Stack instalada

| Camada | Versão |
| --- | --- |
| Node.js | 22 LTS |
| pnpm | 10.28 |
| PostgreSQL | 16 |
| React | 19 |
| Vite | 6 |
| Fastify | 5 |
| Prisma | 6 |
| TypeScript | 5.9 (strict) |

## Estrutura criada

```text
apps/web        React + Vite + TS strict, shell operacional Veridi
apps/api        Fastify + TS strict, Prisma, rota GET /health
packages/shared contratos compartilhados (hoje: HealthResponse)
```

Raiz: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`,
`.env.example`.

## Decisões técnicas do bootstrap

- Gerenciador oficial: **pnpm workspace**. Sem npm workspaces, Yarn, Bun.
- Sem Turborepo/Nx. `pnpm dev` usa `concurrently` para subir web + api.
- Sem framework de UI. CSS próprio com tokens (`apps/web/src/styles/tokens.css`).
- Roteamento por `react-router-dom` — necessário para deep-link de lote/QR,
  que está no escopo do MVP.
- `@fastify/cors` liberado em desenvolvimento; restrito a `WEB_ORIGIN` em produção.
- Prisma Client com inicialização preguiçosa: falha de conexão vira
  `database: "down"` em `/health`, não derruba o processo.
- Schema Prisma contém **apenas** a tabela técnica `_bootstrap_probe`, para
  provar migration + round-trip. Deve ser removida na primeira migration de
  domínio real. As entidades de negócio serão modeladas por handoff.

## Validação executada

Ambiente de validação: container Linux (Node 22, pnpm 10.28, PostgreSQL 16),
partindo de um clone limpo, com o `bootstrap-local.ps1` real executado sob
PowerShell 7.4.

- `pnpm install` — ok (o `prepare` de `@veridi/shared` gera `dist` no install)
- `pnpm typecheck` (shared, api, web) — ok
- `pnpm build` (tsc shared + api + `vite build` web) — ok
- `pnpm test` — 1 teste, rota `/health`, passou
- `migration.sql` aplicada em PostgreSQL 16 real, conectando como `veridi_dev`
- `pnpm dev` sobe api + web; a API atende em `127.0.0.1:3333`
- role/database criados do zero pelo script, com senha contendo `@ : / #`;
  login verificado depois
- `.env` gravado em UTF-8 **sem BOM**; `git ls-files` confirma que só
  `.env.example` é versionado
- fluxo Git completo (init → origin → commit → push) contra remoto de teste;
  rerun é idempotente e recusa push sobre remoto que já tem branches

## Correções de bootstrap (durables)

Bugs encontrados na primeira execução real do script e corrigidos na origem:

- **`@veridi/shared` precisa de `dist` antes de qualquer typecheck/dev/test.**
  `packages/shared/package.json` ganhou `"prepare": "pnpm run build"`, que o
  pnpm roda no `install`. Sem isso, um clone limpo falha em `pnpm typecheck`.
- **`VITE_API_URL` era silenciosamente ignorado.** O Vite lê `.env` a partir do
  diretório do app, não da raiz do monorepo; `apps/web/vite.config.ts` agora
  define `envDir` para a raiz.
- **Raiz não expunha `db:deploy`.** Adicionado, para o bootstrap não precisar
  chamar `prisma migrate deploy` por baixo dos scripts do workspace
  (`db:migrate` é `migrate dev`, interativo, e não serve para bootstrap).
- **O script ignorava exit codes de comandos externos.** `$ErrorActionPreference`
  não cobre executáveis nativos: `prisma generate`, `typecheck`, `build` e
  `test` falhavam e o script seguia imprimindo "OK" até commitar e publicar um
  bootstrap quebrado. Agora todo comando externo passa por `Invoke-Native`.
- **Senha do banco entrava crua na `DATABASE_URL` e no SQL.** Agora é
  percent-encoded na URL e escapada no literal SQL; `.env` é fonte da verdade
  em reexecuções.
- **Identidade do Git não era garantida** — `git commit` falharia numa
  instalação nova do Git, no fim de tudo. Agora é checada no início.

---

# Pendências de ambiente

Bloqueio de ferramenta, não de código: as sessões que geraram e revisaram este
bootstrap rodam na nuvem, sem shell na máquina Windows. **Na máquina local ainda
falta rodar `.\scripts\bootstrap-local.ps1`**, que cobre: Git (+ identidade),
Node LTS, pnpm, PostgreSQL, role/database `veridi_dev`, `.env`, `pnpm install`,
`prisma generate`, `migrate deploy`, typecheck/build/test, smoke test de
`pnpm dev` + `GET /health`, e `git init` + origin + commit + push.

Único passo ainda não exercitado em nenhum ambiente: **`prisma generate` e
`prisma migrate deploy`**. `binaries.prisma.sh` está fora da allowlist de rede
dos containers de validação, então os engines nativos não podem ser baixados
lá. Schema e migration foram validados direto contra o PostgreSQL; o download
dos engines deve funcionar normalmente na máquina local.

---

# MVP scope locked

## Block A — Base
1. Users
2. Customers
3. Suppliers
4. Items
5. Products

## Block B — Purchasing & Inventory
6. Purchase Order
7. Receiving
8. Lots
9. QR / Labels
10. Inventory
11. Movements
12. FEFO

## Block C — Production
13. Formulations
14. Versioning
15. OP
16. Requirement Calculation
17. Reservation
18. QR Picking
19. Actual Consumption
20. Partial Production / Completion
21. Finished Product

---

# Benchmark-driven capabilities now inside MVP
- partial Purchase Order receiving;
- On Order / Em Compra;
- document attachment/reference per lot;
- internal lot ID + supplier lot;
- simple physical location;
- optional supplier barcode;
- QR label;
- mobile/tablet scan-first flows;
- simple Quality availability status;
- physical inventory/stock count;
- auditable stock adjustment;
- FEFO across multiple lots;
- bidirectional traceability.

---

# Durable business decisions
- Inventory controlled by lot.
- Supplier lot and internal lot are separate.
- Negative stock is not silently allowed.
- On Order is not Available.
- Reservation happens at OP release.
- Reservation does not reduce On Hand.
- Actual consumption reduces On Hand.
- Unused reservation is released.
- Formula ACTIVE versions remain historical/immutable.
- OP keeps exact formula version.
- Insufficient Available stock blocks OP release by default.
- Partial production is allowed.
- Finished product is inside MVP.
- Finished product traces back to actual consumed lots.
- Raw-material lot traces forward to produced finished lots.
- Inventory corrections create auditable adjustment/reversal events.

---

# Durable UI decisions
- Veridi green visual identity.
- Existing token/design-system philosophy stays.
- Old permanent Explorer/Workspace/Properties shell is not used.
- Default shell = top masthead + left sidebar + main workspace.
- Contextual right drawer only when useful.
- No permanent global toolbar.
- No permanent bottom status bar.
- Desktop is dense/data-oriented.
- Receiving/picking are mobile/tablet scan-first.
- No UI framework.

---

# Open non-blocking product decisions
- exact automatic finished-product lot-number algorithm;
- exact expiry-warning threshold;
- detailed permissions;
- exact Quality responsibility/release rules;
- loss/yield reason codes;
- final label dimensions/printer;
- whether every item class requires expiry;
- file-storage provider for production.

---

# Next recommended implementation

**Cadastro de Itens** — primeiro slice vertical do Bloco A: modelo Prisma,
migration, serviço, rotas REST validadas com Zod, e tela de lista/formulário
reutilizando o shell e os tokens existentes.

Esse slice define o padrão CRUD que os demais cadastros vão reutilizar.

Não criar as tabelas futuras antes do primeiro slice funcionar.

---

# State maintenance
Keep this file concise.
Rewrite/condense after meaningful changes.
Do not turn it into a chronological log.

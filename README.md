# Veridi Nutrition

Sistema de gestão industrial da Veridi Nutrition — fase **FAST MVP**.

Monorepo: React/Vite no frontend, Fastify no backend, PostgreSQL via Prisma.

## Estrutura

```text
apps/
  web/        React + Vite + TypeScript (shell operacional Veridi)
  api/        Fastify + TypeScript + Prisma
packages/
  shared/     tipos e contratos compartilhados
docs/         escopo, regras de negócio, UI/brand, baseline técnica
.claude/      skills do projeto
```

## Pré-requisitos

| Ferramenta | Versão |
| --- | --- |
| Node.js | LTS (>= 22) |
| pnpm | 10.x |
| PostgreSQL | 16.x |

## Setup local

```bash
# 1. dependências
pnpm install

# 2. ambiente — copie e ajuste com suas credenciais locais
cp .env.example .env

# 3. banco (uma vez, no psql como superusuário)
#    CREATE ROLE veridi_dev LOGIN PASSWORD '<sua-senha-local>';
#    CREATE DATABASE veridi_dev OWNER veridi_dev;

# 4. Prisma
pnpm db:generate
pnpm db:migrate

# 5. subir web + api
pnpm dev
```

- Frontend: <http://localhost:5173>
- API: <http://127.0.0.1:3333>
- Health: <http://127.0.0.1:3333/health>

## Scripts da raiz

| Comando | Efeito |
| --- | --- |
| `pnpm dev` | sobe API e frontend juntos |
| `pnpm dev:api` / `pnpm dev:web` | sobe um lado só |
| `pnpm build` | build de shared, api e web |
| `pnpm typecheck` | TypeScript strict em todos os pacotes |
| `pnpm test` | Vitest |
| `pnpm db:generate` | gera o Prisma Client |
| `pnpm db:migrate` | aplica migrations em desenvolvimento |

## Convenções

- `.env` **nunca** é versionado. Use `.env.example` como referência.
- A aplicação consome `DATABASE_URL`.
- Sem framework de UI. CSS próprio com tokens — ver `docs/UI_BRAND.md`.
- TypeScript strict em todos os pacotes.
- Regras de negócio ficam no servidor.

## Documentação

| Assunto | Arquivo |
| --- | --- |
| Instruções do projeto | `CLAUDE.md` |
| Estado atual | `docs/PROJECT_STATE.md` |
| Escopo do MVP | `docs/MVP_PLAN.md` |
| Regras de negócio | `docs/PRODUCT_RULES.md` |
| UI e marca | `docs/UI_BRAND.md` |
| Baseline técnica | `docs/TECH_BASELINE.md` |
| Pendências abertas | `docs/BACKLOG.md` |
| Escopo adiado | `docs/ROADMAP_POST_MVP.md` |
| Histórico (não é contexto padrão) | `docs/archive/` |

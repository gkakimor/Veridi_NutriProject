# Publicações em PROD

Registro de cada publicação no Railway (projeto `ideal-passion`, ambiente `production`, serviço
`Veridi_NutriProject`). Desde 2026-09-14 18:04Z o Railway só publica a partir de `release/prod`
([`DEPLOY.md`](DEPLOY.md) §9). Backups, retratos e capturas ficam fora do Git, em `../.local-data/veridi/`:
aqui entram só identificadores, contagens e resultados. Nenhuma credencial, URL de banco, dado pessoal ou
conteúdo de backup.

| Tag | SHA em `release/prod` | Data | Nota |
|---|---|---|---|
| `homologacao-inicial-2026-09-14` | `0d3f273` | 2026-09-14 | primeira release de homologação |
| `homologacao-inicial-2026-09-14-r2` | `b798e85` | 2026-09-14 | base da carga inicial da Veridi |
| `homologacao-inicial-2026-09-14-r3` | `2400def` | 2026-09-14 | NAVIGATION-INFORMATION-ARCHITECTURE-01 |
| `homologacao-veridi-2026-09-16-r1` | `5b7c1a3` | 2026-09-16 | HOMOLOGATION-RELEASE-RAILWAY-01, abaixo |

## 2026-09-16 — HOMOLOGATION-RELEASE-RAILWAY-01

**Autorização:** PO, no handoff. Publicar o estado aprovado da `main` sobre os dados existentes da Veridi,
sem reset, carga, importação nem restore. A Ficha Técnica do Modelo
(FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01) ficou fora por decisão do PO.

**Escopo:** `main` em `3159180`, congelado no início da rodada. Entram a bancada da Formulação, a perda
prevista, o custo estimado corrigido, a Ficha Técnica da Formulação em PDF, os Modelos de Formulação
(fatias 1–3), a situação cadastral do Cliente com o hardening, o Painel Gerencial, o Inventário Físico
(fatia 1, API) e o resto integrado desde `2400def`: 103 commits, 70 sem merge. Nenhum script de deploy,
Railway, Nix ou Docker mudou no delta.

### Sequência

| Passo | `release/prod` | Deploy | Resultado |
|---|---|---|---|
| antes | `2400def` | `4d52e556-ec9c-4062-b76c-3c8b94497e73` | ativo desde 2026-09-14; REMOVED na troca |
| push 10:27:50Z | `2400def` → `3159180` | `50bb6c17-a4a5-4a4f-b76e-a710e651d454` | SUCCESS às 10:30:18Z; as seis migrations foram aplicadas no pré-deploy |
| achado do PO | — | — | seletor de Fornecimento coberto na base fixa (ver "Achado da homologação") |
| push 10:57:04Z | `3159180` → `5b7c1a3` | `f366c3cc-f84d-4cc6-bdfc-f5590c663f7e` | SUCCESS às 10:59:45Z; "No pending migrations to apply." |

Os dois pushes foram fast-forward, sem force. O pipeline não mudou (`/railway.json`, conferido no
`serviceManifest` de cada deploy): NIXPACKS com `pnpm build`; pré-deploy `pnpm deploy:prod`, que é
`prisma migrate deploy` (aplica só o pendente, sem reset e sem seed); início `pnpm start:prod`;
healthcheck `/health`. O gatilho conferido em `deploymentTriggers` é `release/prod`. A subida da API não
grava nada, e depois dela os logs de cada deploy só têm INFO.

### Migrations

Seis migrations, todas aditivas. Nenhuma tem DROP, TRUNCATE, DELETE, UPDATE, INSERT, seed ou backfill.

| Migration | Classificação |
|---|---|
| `20260925093026_inventory_physical_count_sessions` | aditiva: enums, 4 tabelas, sequence `stock_count_code_seq` e CHECKs só nas tabelas novas |
| `20260925093027_customer_status_lifecycle` | alteração segura: `customers.blocked` NOT NULL DEFAULT false, mais a tabela `customer_status_history` |
| `20260925093028_formulation_version_presentation_premises` | aditiva: 7 colunas anuláveis e 2 FKs em `formulation_versions` |
| `20260925093029_formulation_version_expected_loss` | aditiva: `expectedLossPercent` anulável |
| `20260925093030_item_consumed_in_production` | alteração segura: `items.consumedInProduction` NOT NULL DEFAULT false, sem backfill (a marcação da cápsula vazia segue manual) |
| `20260925093031_formulation_template_version_premises` | aditiva: 8 colunas anuláveis e 2 FKs em `formulation_template_versions` |

Depois do primeiro deploy:

- `_prisma_migrations` foi de 75 para 81 linhas, com 0 revertidas e 0 inacabadas. São as 80 pastas mais o
  nome antigo `20260904093000_template_component_quantity_mode`, que já era conhecido;
- `prisma migrate status` respondeu "Database schema is up to date!";
- `prisma migrate diff` (banco × `schema.prisma`) respondeu "No difference detected.".

As duas conferências foram repetidas depois do segundo deploy, com o mesmo resultado.

### Backups

Os dois arquivos ficam fora do Git, em `../.local-data/veridi/backups/`, e foram provados com
`restore-json-backup-check.mjs` num banco local descartável.

| Arquivo | Schema | Linhas | Prova |
|---|---|---|---|
| `pre-homologacao-veridi-2026-09-16-20260916T102614Z-release-2400def.json` | `2400def` (76 models) | 6.471, 25 sequences | `RESTAURÁVEL: YES`, com o checker de `3159180` num worktree temporário em `2400def` |
| `pre-homologacao-veridi-2026-09-16-20260916T105302Z-release-3159180.json` | `3159180` (81 models) | 6.476, 26 sequences | `RESTAURÁVEL: YES` |

SHA-256 dos arquivos: `4db949e4…d38d1` e `30fb918a…fbfc1`. **O backup precisa do Prisma Client do schema
que PROD tem na hora.** Rodado de um checkout à frente, o script lê colunas e tabelas que ainda não existem
e falha. O checker, por sua vez, precisa das migrations desse mesmo schema.

### Dados — antes × depois

O retrato é somente leitura (`REPEATABLE READ READ ONLY`): contagem e md5 por tabela, sobre as colunas que
já existiam antes, no mesmo banco (oid inalterado).

| Tabela | 10:25Z | 10:31Z | 10:52Z | 11:00Z |
|---|---|---|---|---|
| customers | 76 | 76 | 76 | 76 |
| suppliers | 113 | 113 | 113 | 113 |
| items | 817 | 817 | 817 | 817 |
| products | 173 | 173 | 173 | 173 |
| formulation_versions | 164 | 164 | 164 | 164 |
| formulation_components | 1.322 | 1.322 | 1.322 | 1.322 |
| formulation_templates · versions | 2 · 2 | 2 · 2 | 2 · 2 | 2 · 2 |
| projects | 182 | 182 | 182 | 182 |
| quote_versions | 3 | 3 | 3 | 3 |
| supplier_items · supplier_item_offers | 721 · 773 | 721 · 774 | 721 · 774 | 721 · 774 |
| customer_orders, production_orders, purchase_orders, receipts, lots, inventory_movements, shipments, billings | 0 | 0 | 0 | 0 |

- **Primeiro deploy:** 74 das 77 tabelas saíram idênticas em contagem e md5. As outras três:
  - `_prisma_migrations`, +6;
  - `user_sessions`, +1, um login;
  - `supplier_item_offers`, +1: uma oferta MANUAL criada por usuário autenticado às 10:28:07Z. As 773
    ofertas antigas mantiveram o md5.
- **Segundo deploy:** 81 das 82 tabelas saíram idênticas. Em `items`, três itens de embalagem tiveram só
  `active` alterado por usuário às 11:00Z, depois da troca. Os outros 814 itens estão iguais ao backup,
  linha a linha.
- **Tabelas novas:** vazias.
- **Colunas novas:** `customers.blocked`, `items.consumedInProduction`, 8 em `formulation_versions` e 8 em
  `formulation_template_versions`. A única sequence nova é `stock_count_code_seq`, nunca usada.

Nenhuma tabela perdeu linha e nenhuma sequence recuou. Os primeiros registros, o código mínimo e o código
máximo de cada cadastro são os mesmos. **DATA_PRESERVED = YES.**

### Achado da homologação, corrigido na mesma rodada

Na receita por base fixa, a célula "Base · Fornecimento" tem dois seletores, cada um com a largura inteira
da coluna, e `.table td` é `nowrap`. Com isso, o seletor de Fornecimento saía ~90 px da célula e ficava por
baixo do campo da Reserva, na Formulação e no Modelo. O defeito era só visual: todas as 1.322 linhas
seguiam com Fornecimento VERIDI. PROD tem 159 versões em base fixa. Em Por dose a célula tem um seletor só,
e por isso o exemplo de DEV parecia normal.

**Correção:** commit `be02650`, merge `5b7c1a3`, só CSS e testes. O segundo seletor desce para a linha de
baixo, a coluna mantém 100 px na composição e 204 px na embalagem, e nenhuma outra coluna muda.

**Medição:**

| | Onde | Seletores fora da célula ou cobertos |
|---|---|---|
| antes | DEV | 12 de 24 |
| antes | PROD, 1ª linha | fora e coberto |
| depois | DEV | 0 de 24 |
| depois | PROD, `PROD-000001` V2 | 0 de 24 |

A suíte web completa acusou 2 falhas que já existiam em `3159180` (WEB-SUITE-PREEXISTING-FAILURES-01, no
BACKLOG).

### Smoke

O smoke rodou em PROD com a sessão do `prod-demo`, num navegador que abortava toda escrita, e fez logout no
fim. Nas duas versões publicadas foram 45 verificações OK e 0 falhas:

- login, Painel e Painel Gerencial;
- Clientes: lista, situação cadastral, detalhe e Visão do Cliente. O menu de situação aparece para o ADMIN
  e não aparece para um perfil sem permissão, simulado só na leitura da sessão;
- Projetos: lista e detalhe;
- Formulações: lista, versão e bancada, com perda prevista e custo estimado e sem a palavra "template";
- Ficha Técnica em PDF real (`PROD-000001`);
- Modelos: lista, página e bancada compartilhada, sem "template" e sem Ficha Técnica do Modelo (o esperado);
- Pedidos: a lista abre. O detalhe não se aplica, porque o ambiente tem 0 pedidos;
- Estoque e Inventário Físico;
- console limpo, sem resposta 4xx/5xx.

A perna de escrita do `smoke-prod.mjs` não rodou.

### O que não rodou

Não rodou nenhum comando proibido: reset, `migrate dev`, `db push`, fresh, drop, truncate, seed, carga
inicial, estoque de abertura, import ou sincronização DEV → PROD. Não houve restore em PROD nem rollback.

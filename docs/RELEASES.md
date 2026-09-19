# Publicações em PROD

Registro de cada publicação no Railway (projeto `ideal-passion`, ambiente `production`, serviço
`Veridi_NutriProject`). Desde 2026-09-14 18:04Z o Railway só publica a partir de `release/prod`
([`DEPLOY.md`](DEPLOY.md) §9). Backups, retratos e capturas ficam fora do Git, em `../.local-data/veridi/`:
aqui entram só identificadores, contagens e resultados. Nenhuma credencial, URL de banco, dado pessoal ou
conteúdo de backup.

**Toda publicação preserva o dado de PROD.** PROD é a fonte de verdade: release muda schema, comportamento e
funcionalidades, e exceção destrutiva — limpeza, reset, carga, saneamento — só com aprovação explícita do PO, planejada e
auditável. Política permanente em [`DEPLOY.md`](DEPLOY.md) §10.

| Tag | SHA em `release/prod` | Data | Nota |
|---|---|---|---|
| `homologacao-inicial-2026-09-14` | `0d3f273` | 2026-09-14 | primeira release de homologação |
| `homologacao-inicial-2026-09-14-r2` | `b798e85` | 2026-09-14 | base da carga inicial da Veridi |
| `homologacao-inicial-2026-09-14-r3` | `2400def` | 2026-09-14 | NAVIGATION-INFORMATION-ARCHITECTURE-01 |
| `homologacao-veridi-2026-09-16-r1` | `5b7c1a3` | 2026-09-16 | HOMOLOGATION-RELEASE-RAILWAY-01, abaixo |
| `prod-2026-09-17` | `8e824e8f` | 2026-09-17 | PROD-RELEASE-DEPLOY-01, abaixo; R2 ativo em PROD |
| `prod-2026-09-19` | `ff861c90` | 2026-09-19 | PROD-RELEASE-DEPLOY-02, abaixo; sete migrations aditivas |

## Versão do produto

Desde VERIDI-SYSTEM-VERSIONING-01 (2026-09-19, decisão do PO) o Veridi Nutrition tem versão oficial no formato
`vMAJOR.MINOR.PATCH` (SemVer). **v1.0.0 é a primeira versão comercial oficial.**

| Nível | Exemplo | Quando |
|---|---|---|
| PATCH | `1.0.1` | correção compatível |
| MINOR | `1.1.0` | funcionalidade nova compatível |
| MAJOR | `2.0.0` | mudança incompatível ou evolução estrutural relevante |

- **Fonte única:** `VERIDI_VERSION` e `VERIDI_VERSION_DATE` em `packages/shared/src/version.ts`. A API devolve a versão
  em `GET /meta`, junto com o ambiente e o commit que o Railway injeta no deploy; o cabeçalho a mostra ao lado de
  "Nutrition", e "Sobre o sistema" traz versão, data, ambiente e build. Nenhum outro código escreve o número (guarda
  `apps/web/src/app/versao-fonte-unica.test.ts`), e o `version` dos `package.json` não é a versão do produto — são
  pacotes privados do workspace.
- **Subir a versão:** versão publicada não muda de conteúdo (regra do SemVer) — código novo em PROD sai com número novo,
  e o nível é decisão do PO. Número e data mudam juntos, no commit que entra no SHA publicado; a data é a da publicação.
- **Tags:** cada versão publicada ganha a tag anotada `vX.Y.Z` no SHA exato de `release/prod`, além da tag técnica da
  publicação (`prod-AAAA-MM-DD`; com sufixo quando o dia já tem uma — tag existente nunca se move).
- **Conferir no ar:** `GET /meta`, com sessão, responde `version` e `commitHash` igual ao SHA de `release/prod`.

## 2026-09-19 — PROD-RELEASE-DEPLOY-02

**Autorização:** PO, no handoff "PROD RELEASE — AUTORIZADA PELO PO". Publicar o SHA exato
`ff861c90512232bb5a168c304a186747150576d0` sobre `release/prod` = `8e824e8f` — nenhuma outra `main`, nenhum commit
novo. O saneamento dos 21 grupos / 45 Itens duplicados de PROD (Ondas A, 2 e 3) ficou **fora** por decisão do handoff:
deploy de software não se mistura com saneamento de dados. O PO está ciente do M-1 — 34 Formulações ACTIVE usam 9
embalagens inativas e passam a não planejar/liberar OP (§116) —, que não bloqueou a release; nada foi reativado.

**Escopo:** `release/prod` de `8e824e8f` para `ff861c90` — 68 commits (26 first-parent), 271 arquivos, sete migrations
aditivas. Entram o tipo de Item Uso e consumo, o consumo interno com custo congelado (`CI-`), o estorno (`ECI-`) e o
R-21; os dados cadastrais do CNPJ no Cliente, a consulta OpenCNPJ e o histórico do registro, com a marca da criação;
a exclusão física de cadastro mestre (Fatia 1) com o rastro; a guarda de nome único sem caixa com a correção H-1 (o
cadastro que já nasceu duplicado continua editável); a guarda do último ADMIN ativo; os portões de cadastro inativo em
Item × Fornecedor e na Produção; o roteiro arquivável; o resumo da tela no PDF dos relatórios; e o ferramental das
Ondas 2 e 3 — que **não rodou** em PROD. Sem `package.json`, lockfile, `railway.json` ou variável nova.

### Gates antes do push (T-0)

| Gate | Como | Resultado |
|---|---|---|
| SHAs | `git fetch origin --tags` | `origin/main` = `ff861c90` (igual ao aprovado); `origin/release/prod` = `8e824e8f`, ancestral de `ff861c90` (fast-forward) |
| Railway | `deployment` + `meta` + `deploymentTriggers`, só leitura | deploy ativo `4edfd622` SUCCESS, commit `8e824e8f`, branch `release/prod`, `canRollback: true`; gatilho `release/prod`; `/health` 200 com `database: up` |
| Migrations | `_prisma_migrations` em transação READ ONLY + `migrate status` | 83 linhas, **0 falha, 0 revertida**; pendentes exatamente `…093034` a `…093040` |
| Drift | `migrate diff` PROD × `schema.prisma` de `8e824e8f` | **No difference detected** |
| Tipos novos | leitura READ ONLY | 0 Item `INTERNAL_CONSUMABLE`, 0 código `UC-`/`CI-`/`ECI-`; as tabelas de CI e ECI ainda não existiam |
| Baseline | retrato × preflight de 2026-09-18 13:23Z; backup T-0 × backup pós-release de 2026-09-17 | contagens das 83 tabelas, sequences e migrations iguais ao preflight; T-0 = backup de 09-17 linha a linha em 81/82 models, mais 1 `UserSession` (login de 09-17 19:19Z). Negócio sem mudança: o ensaio de PROD-RELEASE-READINESS-01 sobre o backup de 09-17 continuou valendo |
| Backup | `prod-backup-json.mjs` de um worktree em `8e824e8f` (client de 82 models) | 6.769 linhas, 82 models, 0 falha |
| Prova do backup | `restore-json-backup-check.mjs` com as 82 migrations de `8e824e8f` | **RESTAURÁVEL: YES** |
| Retrato pré-release | transação REPEATABLE READ, READ ONLY, às 06:05:04Z | 83 tabelas, 6.852 linhas, md5 por tabela e impressão da estrutura; idêntico ao retrato de confirmação das 06:02Z |

Todas as leituras de PROD usaram sessão com `default_transaction_read_only=on`, conferida antes de ler, e
`pg_current_xact_id_if_assigned()` nulo no fim de cada retrato — prova de que nenhuma transação escreveu. A linha legada
`20260904093000_template_component_quantity_mode` segue tolerada, como nas publicações anteriores.

### Sequência

| Passo | `release/prod` | Deploy | Resultado |
|---|---|---|---|
| antes | `8e824e8f` | `4edfd622-f531-42d4-9e64-effec2500f57` | ativo desde 2026-09-17 18:12:49Z |
| push 06:05:46Z | `8e824e8f` → `ff861c90` | `0d1ad066-0c36-44d8-81b2-cb0c27ea2174` | criado às 06:05:49Z, **SUCCESS às 06:08:16Z** |

Push fast-forward do SHA exato (`git push origin ff861c90…:refs/heads/release/prod`), sem force. O manifesto do
deploy confirma o pipeline de `/railway.json`: NIXPACKS com `pnpm build`, pré-deploy `pnpm deploy:prod`, início
`pnpm start:prod`, healthcheck `/health`. Enquanto o deploy estava em BUILDING, o `meta.serviceManifest` ainda
mostrava os campos do service instance (RAILPACK, sem pré-deploy); o log do build usava a imagem do Nixpacks e o
manifesto se corrigiu no SUCCESS. Nenhuma migration rodou à mão. `/health` respondeu 200 durante toda a troca.

### Migrations aplicadas

| Migration | Aplicada em | O que cria |
|---|---|---|
| `20260925093034_item_type_internal_consumable` | 06:08:02.582Z | valor `INTERNAL_CONSUMABLE` em `ItemType` e a sequence do código `UC-` |
| `20260925093035_internal_consumption` | 06:08:02.610Z | enum `CostSource`, valor `INTERNAL_CONSUMPTION` em dois enums de movimento, tabela `internal_consumptions` e a sequence do `CI-` |
| `20260925093036_customer_cnpj_registration_data` | 06:08:02.630Z | enum `CnpjEstablishmentType` e 11 colunas anuláveis em `customers` |
| `20260925093037_customer_cnpj_registration_history` | 06:08:02.657Z | enum `CustomerCnpjRegistrationEventKind` e a tabela `customer_cnpj_registration_history` |
| `20260925093038_master_data_deletion_history` | 06:08:02.677Z | enum `MasterDataEntityType` e a tabela `master_data_deletion_history` |
| `20260925093039_internal_consumption_reversal` | 06:08:02.703Z | valor `INTERNAL_CONSUMPTION_REVERSAL` em dois enums de movimento, tabela `internal_consumption_reversals` e a sequence do `ECI-` |
| `20260925093040_customer_cnpj_history_creation_marker` | 06:08:02.721Z | coluna anulável `createdWithCustomerId` no histórico do CNPJ |

Depois: 90 linhas em `_prisma_migrations`, **0 falha e 0 revertida**; `migrate status` com as 89 pastas da release
responde "Database schema is up to date!" (90 = 89 + a linha legada); `migrate diff` PROD × `schema.prisma` de
`ff861c90`: **No difference detected**.

Conferido em transação READ ONLY: as quatro tabelas novas com 0 linha; as 11 colunas novas de `customers` NULL nos 76
clientes; os quatro enums e os cinco valores novos presentes; as três sequences novas sem uso (`last_value` nulo); 0
Item `INTERNAL_CONSUMABLE`, 0 CI, 0 ECI.

### Dado preservado

Duas provas independentes, as duas sobre o que existia antes da release:

- **Retratos** (md5 por tabela sobre as colunas que já existiam), pré-release 06:05:04Z × depois do smoke 06:16:00Z:
  81 das 83 tabelas idênticas. Mudaram só `_prisma_migrations` (+7, as da release) e `user_sessions` (+2, os logins do
  smoke). Nenhuma sequence antiga se moveu.
- **Backups**, T-0 × pós-release, linha a linha nos campos que já existiam: 81 de 82 models idênticos. `UserSession`
  +2 linhas (06:13:28Z e 06:15:29Z, os logins do smoke), 0 alterada e 0 removida; os 4 models novos vazios; nenhum
  campo novo preenchido.

Clientes 76, fornecedores 113, itens 871 (510 matérias-primas, 188 embalagens — 76 ativas e 112 inativas —, 173
acabados), produtos 173, Item × Fornecedor 778, ofertas 828, versões de Formulação 164, usuários 6 (1 ADMIN ativo).
Pedido, OC, lote, movimento e OP seguem em 0. O M-1 ficou como estava: 34 versões ACTIVE, 9 embalagens inativas, 42
linhas. **DATA_PRESERVED = YES.**

### Backups

| Quando | Arquivo (em `../.local-data/veridi/backups/`) | Bytes | sha256 | Schema | Prova |
|---|---|---|---|---|---|
| T-0, 06:04:10Z | `prod-t0-deploy-20260919T060357Z-schema-8e824e8f.json` | 4.305.116 | `ebef0df8fb91e7d9b437577daa5db9b69f82665f5bd03f66aab9742e4f921c2e` | `8e824e8f` | RESTAURÁVEL: YES — 82 models, 6.769 linhas, 26 sequences |
| pós, 06:17:07Z | `prod-pos-release-20260919T061652Z-schema-ff861c90.json` | 4.336.452 | `aa8c7a9c94b73a868fd370e456dff0412d05c6b27d757de99656629574a373b0` | `ff861c90` | RESTAURÁVEL: YES — 86 models, 6.771 linhas, 29 sequences |

O segundo é o ponto de recuperação compatível com o schema publicado; o T-0 só restaura no schema anterior. As duas
provas rodaram em banco local descartável, removido no fim. Os retratos (só contagens, md5, estrutura e migrations —
nenhum conteúdo de linha) ficam em `../.local-data/veridi/releases/prod-release-ff861c90/`.

### Smoke

Somente leitura, com a sessão do `prod-demo` (ADMIN). Os únicos verbos fora de GET foram `POST /auth/login` e
`POST /auth/logout`, duas vezes cada. No navegador, todo pedido não-GET ao domínio seria abortado — e nenhum foi
tentado. Console limpo e nenhuma resposta 4xx/5xx.

- casca e sessão: `/health` 200 com `database: up`, `/` 200, login, `/auth/me` e `/auth/session`, logout com `/auth/me`
  401 depois;
- menus: os 9 grupos do trilho abrem e trazem 39 telas, entre elas as 13 do roteiro; o clique leva a Uso e consumo;
- Cliente: lista, detalhe (bloco `cnpjRegistration` presente, nulo nos clientes existentes), tela com o registro
  aberto mostrando o CNPJ e o histórico; histórico do CNPJ com 0 evento e histórico de situação;
- OpenCNPJ: `GET /cnpj-lookup/:cnpj` **200**, com um CNPJ público de referência — nenhum CNPJ de cliente saiu;
- deletion-check de Fornecedor e de Cliente: 200, `canDelete: false` (em uso), transação somente leitura no servidor;
- Fornecedor, Item (o filtro aceita o tipo novo e devolve 0), Produto, Item × Fornecedor, Compras, Estoque (posição,
  movimentações, contagens, lotes), Uso e consumo (0 CI, opções de filtro), Formulação (lista e versão ACTIVE), OP e
  Pedido — API e tela;
- R-03 e R-21: API e tela; CSV do R-21 `text/csv` com o cabeçalho e nenhuma linha;
- PDF real, gerado no navegador: Ficha Técnica (`ficha-tecnica-PROD-000001-v1.pdf`, 61.188 bytes) e os relatórios
  R-21 (55.006 bytes) e R-03 (54.897 bytes), todos começando por `%PDF-`;
- Rótulo: a seção "Arquivo do rótulo" abre num Item LABEL e `/items/:id/label-file` responde 200 com 0 versões;
- Usuários: lista com 6.

A primeira passada teve 62 verificações, 61 OK. A que falhou era do roteiro, não do produto: procurou os nomes dos
grupos como texto no Painel, e o menu é um trilho de ícones que abre cada grupo no clique — as palavras encontradas
vinham dos cartões do Painel. A segunda passada abriu os grupos pelo trilho: 8/8 OK.

**R2:** `VERIDI_STORAGE_PROVIDER=R2`, bucket `veridi-homologacao` e região `auto` no serviço, com endpoint, chave e
segredo preenchidos (lidos sem imprimir valor). A API subiu com essa configuração, que é validada na partida. PROD
tem 0 versão de arquivo de rótulo, então não há objeto a ler; `storage:r2:smoke` não rodou (exige nova autorização do
PO).

As capturas do smoke mostravam dado real de cliente e foram apagadas depois da conferência (§9 do
[`DEPLOY.md`](DEPLOY.md)).

### O que não rodou

O saneamento de duplicatas (Ondas A, 2 e 3), `prod-cleanup --apply`, seed, import, carga inicial, reset de sequences,
restore em PROD, `pnpm db:migrate` à mão, SQL à mão e `storage:r2:smoke`. Não houve rollback nem incidente. O deploy
anterior (`4edfd622`, `8e824e8f`) segue com `canRollback: true` na janela do Railway, mas o rollback de código só é
limpo enquanto não existir Item `INTERNAL_CONSUMABLE`, CI ou ECI — o client antigo cai ao ler o enum novo. Com
qualquer um deles, o caminho é forward-fix.

### Tag

Tag anotada **`prod-2026-09-19`** ("PROD-RELEASE-DEPLOY-02"), apontando para `ff861c90`, empurrada sozinha
(`git push origin refs/tags/prod-2026-09-19`). `prod-2026-09-17` não se moveu. A tag não publicou nada: a lista de
deployments seguiu com `0d1ad066` no topo.

## 2026-09-17 — PROD-RELEASE-DEPLOY-01

**Autorização:** PO, no handoff. Publicar em PROD a versão homologada da `main`, com o SHA candidato
declarado (`8e824e8f`) e confirmação do SHA real antes de qualquer escrita. A Onda A de duplicatas de Item
e o `prod-cleanup --apply` ficaram **fora** deste release por decisão explícita do handoff.

**Escopo:** `release/prod` de `5b7c1a3` para `8e824e8f` — 87 commits, 395 arquivos, duas migrations
aditivas. Entram o Inventário Físico (fatias 1 e 2), o `StorageAdapter` com o R2, o arquivo do Item Rótulo
versionado, o pagamento padrão do Cliente, a consulta assistida no seletor (única e múltipla), as
permissões de cadastro mestre, o cadastro inativo (fatias 1 e 2), a base derivada do componente e o
ferramental de `prod-cleanup`. `schema.prisma` mudou só por adição (+107 linhas, 0 remoções).

O delta entre `24bf25ab` (SHA auditado em PROD-RELEASE-READINESS-01) e `8e824e8f` são 6 commits que tocam
apenas `scripts/maintenance/` e `docs/`: nenhum arquivo de runtime, de schema ou de migration.

### Gates antes do push (T-0)

| Gate | Como | Resultado |
|---|---|---|
| SHAs | `git fetch origin` | `origin/main` = `8e824e8f` (igual ao candidato); `origin/release/prod` = `5b7c1a3`; fast-forward possível |
| Base do componente (§106) | `prod-component-basis.ts` em transação READ ONLY | Formulação 1.292 ACTIVE + 30 DRAFT, Modelo sem linha, **FORA DA REGRA = 0** |
| Migrations | `migrate status` + leitura de `_prisma_migrations` em transação READ ONLY | 81 linhas, **0 falha, 0 revertida**, exatamente as duas esperadas pendentes |
| R2 | leitura das Variables do serviço, sem imprimir segredo | `VERIDI_STORAGE_PROVIDER=R2` e as cinco `VERIDI_R2_*` presentes; nada alterado |
| Backup | `prod-backup-json.mjs` de um worktree em `5b7c1a3` | 6.763 linhas, 81 models, 0 falha |
| Prova do backup | `restore-json-backup-check.mjs` em banco local descartável | **RESTAURÁVEL: YES** |

O backup T-0 saiu de um worktree no SHA que estava publicado, não da `main`: o Prisma Client da `main` já
conhece colunas que PROD ainda não tinha e a leitura falharia.

`migrate status` também aponta uma migration que existe no banco e não no repositório,
`20260904093000_template_component_quantity_mode`. É o resto conhecido e tolerado do renome de BACKLOG #13
(commit `665765da`), de 2026-09-04 — não é estado novo. A conta fecha: 82 pastas locais = 80 linhas comuns
+ 2 pendentes; 81 linhas no banco = 80 comuns + 1 nome legado.

### Sequência

| Passo | `release/prod` | Deploy | Resultado |
|---|---|---|---|
| antes | `5b7c1a3` | `9d477a48-316e-4612-89e0-27011ee64023` | ativo desde 2026-09-17 16:43Z (redeploy do mesmo SHA pelas variáveis do R2) |
| push 18:09Z | `5b7c1a3` → `8e824e8f` | `4edfd622-f531-42d4-9e64-effec2500f57` | criado às 18:09:57Z, **SUCCESS às 18:12:49Z** |

Push fast-forward, sem force, sem squash e sem cherry-pick: o SHA publicado é byte a byte o da `main`. O
pipeline não mudou (`/railway.json`): NIXPACKS com `pnpm build`; pré-deploy `pnpm deploy:prod`
(`prisma migrate deploy`); início `pnpm start:prod`; healthcheck `/health`. Nenhuma migration foi rodada à
mão — as duas subiram pelo pré-deploy.

### Migrations aplicadas

| Migration | Aplicada em | O que cria |
|---|---|---|
| `20260925093032_customer_payment_defaults` | 2026-09-17 18:12:30.812Z | enum `PaymentInstrument` e 8 colunas anuláveis |
| `20260925093033_item_label_file_versions` | 2026-09-17 18:12:30.836Z | enum `StorageProvider` e a tabela `item_label_file_versions` |

Depois: 83 linhas em `_prisma_migrations`, **0 falha e 0 revertida**, e `migrate status` responde
"Database schema is up to date!".

Conferido em transação READ ONLY: `PaymentInstrument` com `PIX, BOLETO, BANK_TRANSFER, CARD, OTHER`;
`StorageProvider` com `LOCAL_FS, R2`; `item_label_file_versions` presente, 19 colunas e 0 linha; as 8
colunas novas presentes e todas anuláveis — `customer_orders.agreedPaymentInstrument`,
`quote_versions.paymentInstrument` e seis em `customers`.

### Dado preservado

Os dois backups lógicos, gerados antes e depois do deploy, diferem em **um único model**:

| | T-0 (18:05Z) | pós-release (18:20Z) |
|---|---|---|
| linhas | 6.763 | 6.768 |
| models | 81 | 82 (`ItemLabelFileVersion`, vazia) |
| `UserSession` | 698 | 703 (+5, os logins do smoke) |
| os outros 81 models | — | contagem idêntica |

Clientes 76, produtos 173, itens 871 (510 matérias-primas, 188 embalagens, 173 acabados), fornecedores 113,
projetos 182, usuários 6. Pedido, OP, compra, recebimento, lote e movimento seguem em 0. Nenhuma tabela
perdeu linha. **DATA_PRESERVED = YES.**

### Backups

| Quando | Arquivo (em `../.local-data/veridi/backups/`) | Bytes | sha256 | Schema | Prova |
|---|---|---|---|---|---|
| T-0, 18:05:40Z | `prod-t0-deploy-20260917T180540Z-schema-5b7c1a3.json` | 4.283.124 | `fbee1bf043b008adcc41fce904c47f41282421a5ea75311bf24f5e7f88379791` | `5b7c1a3` | RESTAURÁVEL: YES |
| pós, 18:20:47Z | `prod-pos-release-20260917T182047Z-schema-8e824e8f.json` | 4.304.774 | `5bf2140298c54991bdb8ecb8f6af8fbb4d384dca9ac0782212668910c463ab18` | `8e824e8f` | RESTAURÁVEL: YES |

O segundo é o ponto de recuperação compatível com o schema publicado. As duas provas rodaram em banco
local descartável, com as migrations do checkout correspondente e conferência linha a linha.

### Smoke

`/health` responde 200 com `"database":"up"`. O smoke rodou com a sessão do `prod-demo`, **somente
leitura**: os únicos verbos fora de GET foram `/auth/login` e `/auth/logout`. 67 verificações OK e nenhuma
falha aberta:

- casca e sessão: `/health`, login, cookie, `/auth/me`, logout e a recusa (401) depois do logout;
- API: clientes, produtos, projetos, itens, fornecedores, pedidos, faturamento, OPs, compras, estoque,
  lotes, formulações, contagens físicas e o arquivo do rótulo;
- Itens por tipo: 510 matérias-primas, 188 materiais de embalagem, 112 itens inativos na lista filtrada;
- Rótulo: a seção "Arquivo do rótulo" abre no Item de subtipo LABEL, com 0 versão — o esperado, já que o
  R2 acabou de entrar;
- Formulação: lista, versão, bancada e **Ficha Técnica em PDF real**;
- consulta assistida: o diálogo de seleção múltipla abre na bancada de uma versão DRAFT e fecha no Escape
  sem escolher nada;
- Inventário Físico e Modelos de Formulação abrem;
- produto inativo no Comercial: os 2 produtos inativos não aparecem na lista que a tela do Pedido pede
  (`active=true&lifecycle=APPROVED`, 171 produtos);
- telas do smoke padrão: painel, clientes, produtos, itens, projetos, pedidos, estoque e ordens de
  produção, mais a ajuda contextual;
- console limpo e **nenhuma resposta 4xx/5xx** em toda a navegação.

Uma verificação falhou por erro do próprio roteiro, não do produto: procurou o botão "Consultar" na tela
do Pedido, e a consulta assistida está na bancada da Formulação e do Modelo (`consultaDeItem`), não no
Pedido. Reexecutada no lugar certo, passou.

A perna de escrita do `smoke-prod.mjs` não rodou. **Nenhum dado de negócio foi criado pelo smoke** — a
comparação dos dois backups prova: só `UserSession` mudou.

### O que não rodou

`prod-cleanup --apply`, a Onda A de duplicatas de Item, seed, import, carga inicial, reset de sequences,
restore em PROD e SQL destrutivo à mão. Não houve rollback nem incidente. O deployment anterior
(`9d477a48`, `5b7c1a3`, já com as variáveis do R2) continua disponível como rollback de código pela janela
do Railway; ele não desfaz migration, e as duas são aditivas e toleradas pelo código antigo.

### Fechamento administrativo (PROD-RELEASE-CLOSEOUT-01, 2026-09-17)

A tag ficou para uma rodada própria. Em 18:39Z, com `origin/release/prod` reconferido em `8e824e8f`, saiu a
tag anotada **`prod-2026-09-17`** ("PROD-RELEASE-DEPLOY-01"), apontando para esse mesmo commit, empurrada
sozinha (`git push origin refs/tags/prod-2026-09-17`). Nenhum branch se moveu.

Tag não publica: o gatilho do serviço continua sendo um só, `release/prod` (trigger
`6ef07213-dbfb-4e43-8d5d-20cd230919a3`, lido sem alterar), e a lista de deployments seguiu em 20, com
`4edfd622` no topo, ao longo de um vigia de 3 minutos depois do push. Nada mudou no Railway nem no banco.

As capturas do smoke (19 PNG, 1,8 MB, com dado real de cliente) foram apagadas depois da conferência, como
manda a §9 do [`DEPLOY.md`](DEPLOY.md). Os números do smoke continuam registrados aqui.

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

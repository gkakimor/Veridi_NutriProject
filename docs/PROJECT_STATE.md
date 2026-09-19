# Veridi Nutrition — Project State

**Versão do produto:** v1.0.0, a primeira versão comercial oficial (fonte única em `packages/shared/src/version.ts`,
política em [`RELEASES.md`](RELEASES.md)) · **Baseline da documentação:** v0.4 — post-benchmark · **Fase:** FAST MVP,
homologação e testes em fast development.

**Fotografia atual, não diário.** Este arquivo responde: o que é o produto, onde está o código e a produção, o que já
existe, como estão os ambientes, quais decisões operacionais valem, qual é a próxima prioridade e o que está em risco. O
registro de cada entrega — o que mudou, as decisões da rodada e a validação — está em
[`archive/PROJECT_STATE_HISTORY.md`](archive/PROJECT_STATE_HISTORY.md), com índice; as decisões de lá continuam valendo:
o texto mudou de lugar, não de vigência. Regra de negócio mora no [`PRODUCT_RULES.md`](PRODUCT_RULES.md) e pendência no
[`BACKLOG.md`](BACKLOG.md).

## Identidade

ERP industrial interno da Veridi Nutrition, fabricante de suplementos sob marca de cliente (private label): cadastros,
compras, recebimento com lote e qualidade, estoque por item + lote interno, formulação versionada, produção rastreada,
pedidos, expedição, faturamento, custo industrial, CMV, precificação, projetos, amostras e orçamentos. É ERP
operacional — não CRM, não motor fiscal, não financeiro (contas a pagar e a receber, caixa e margem realizada estão fora
do produto). Escopo do MVP em [`MVP_PLAN.md`](MVP_PLAN.md); o que vem depois em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

## Stack e arquitetura

- Monorepo pnpm, TypeScript strict, monólito modular com API REST: `apps/web` (React + Vite), `apps/api` (Node.js +
  Fastify), `packages/shared` (contratos e motores canônicos que tela e servidor usam juntos — decimal, fuso,
  quantidade da formulação, totais, permissões por perfil). PostgreSQL com Prisma; Zod; Vitest. Detalhe e guardrails
  em [`TECH_BASELINE.md`](TECH_BASELINE.md); UI em [`UI_BRAND.md`](UI_BRAND.md).
- **Dinheiro e quantidade em `Decimal`**, motor em 40 dígitos numa configuração canônica (§59), matriz de precisão
  aplicada ao schema inteiro (§58) e fronteiras de fechamento nomeadas (§60–§64). Nada de domínio passa por `Number`
  (§66).
- **Um fuso operacional**, `America/Sao_Paulo` (§72): dia comercial, validade e períodos são do dia da Veridi.
- **Documentos oficiais em PDF real**, gerados no navegador a partir da mesma API autenticada da tela
  (`@react-pdf/renderer`, `apps/web/src/pdf`; política em §5.5).
- **Arquivos:** `StorageAdapter` com `LOCAL_FS` e Cloudflare R2 para o arquivo do Item Rótulo (§103); anexos genéricos
  seguem no volume (`lib/file-storage.ts`).
- **Migrations** só pelos três comandos do `CLAUDE.md` (criar, aplicar, provar); `schema.prisma` e a cadeia estão em
  sincronia desde o #14 — `pnpm validate:migrations:fresh` prova.
- **Hospedagem:** Railway; PROD publica só a partir da branch `release/prod` ([`DEPLOY.md`](DEPLOY.md)).

## Onde estamos

- **`main`:** `8cf83861` (2026-09-19) mais esta rodada, só de documentação; o último código integrado é `c860e190`
  (API-GLOBAL-ERROR-HANDLER-01). `main` declarada estável em `0d81aae` (MAIN-STABILITY-FAST-GATE-01, 2026-09-15).
- **PROD:** `release/prod` = `884a500d`, **Veridi Nutrition v1.0.0** desde 2026-09-19 — deploy `d55e03aa`, tags
  `v1.0.0` e `prod-2026-09-19-v1.0.0`; `GET /meta` responde versão, ambiente e commit ([`RELEASES.md`](RELEASES.md)).
- **Versão comercial:** `VERIDI_VERSION` = `1.0.0`. O próximo corte é a **v1.1.0, candidata**, planejada no
  [`BACKLOG.md`](BACKLOG.md#veridi-nutrition-v110--candidata); nenhuma publicação está autorizada.
- **Na `main` e fora de PROD**, sem migration: MASTER-DATA-HARD-DELETE-02 (§128),
  INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01 (§127), VERIDI-AUDIT-QUICK-FIXES-01 (D1–D6 da revisão funcional),
  DOCUMENT-TRANSITION-CONCURRENCY-01 Fatia 1 (§129) e API-GLOBAL-ERROR-HANDLER-01.
- **Produto:** MVP operacional entregue e validado internamente — Blocos A a G fechados. O bloco de go-live
  ([`BACKLOG_CLOSURE.md`](BACKLOG_CLOSURE.md)) está inativo até decisão explícita do PO. Zero CRITICAL, zero BLOCKER.
- **Precisão numérica:** fundação completa no armazenamento (§57–§66). A exibição ficou para trás: o resíduo é o W7
  e o PREC-UI do roadmap.

## Capacidades existentes

Por área, com a regra durável de cada uma. O registro de cada entrega está no
[índice do histórico](archive/PROJECT_STATE_HISTORY.md#índice).

- **Cadastros mestres.** Cliente com CNPJ nas duas formas, contato e autoria (§41), situação comercial derivada (§86),
  situação cadastral com motivo e histórico (§95), perfil tributário informado (§83), pagamento padrão como sugestão
  (§99), consulta de CNPJ assistida pelo OpenCNPJ e dados cadastrais editáveis com histórico (§111, §119, §122),
  endereço por CEP (§80) e edição só por Comercial e ADMIN (§98). Fornecedor com endereço (§80). Item em quatro tipos —
  matéria-prima, embalagem, produto acabado e uso e consumo (§4, §113) —, formulário por tipo (§109) e arquivo
  versionado do Rótulo (§103). Produto de um Cliente com o seu item de produto acabado (§5, §43). Quem cria, edita e
  muda a situação (§100). Nome único sem caixa (§114). Inativo visível e fora de compromisso novo (§107, §108, §112,
  §116). Exclusão física só do criado por engano e nunca usado, com rastro (§125, §128); Roteiro arquivável (§121);
  nunca zero ADMIN ativo (§120). Consulta do Cliente como raiz de navegação (§42, §44, §47).
- **Compras e recebimento.** Item × Fornecedor com homologação por item, preferencial e ofertas imutáveis (§5.3, §101,
  §102, §104); OC com total que fecha nas linhas (§6, §61); Sugestão de Compra (§29); recebimento parcial, lote
  interno × lote do fornecedor, documentos e CoA, liberação pela Qualidade (§7–§10); custo efetivo de aquisição só por
  Compras e ADMIN (§105); material do cliente com dono próprio (§14, §40).
- **Estoque e rastreabilidade.** Físico, reservado, disponível e em compra (§14); ledger auditável (§15); FEFO (§17);
  QR e etiqueta (§12, §13); validade inclusiva no dia (§73); Inventário Físico em sessões `INV-` e Contagem rápida
  (§16); rastreabilidade para trás e para frente (§26); correções por ajuste e estorno, nunca por reescrita (§27);
  uso e consumo com custo (`CI-`), estorno (`ECI-`) e o R-21 (§113, §115, §117, §126, §127).
- **Formulação e produção.** Formulação versionada com a bancada — forma, apresentação, dose, pureza, reserva e perda
  prevista (§18, §37, §52, §88) — e base do componente derivada (§106); Modelos de formulação (§35, §96, §97) e fichas
  técnicas em PDF. OP com necessidade, reserva, picking por QR, consumo real, produção parcial e produto acabado
  (§19–§25), reconciliação de material (§49) e componente inativo barrado (§116). Roteiro de Produção copiado na OP
  (§89), Calendário (§90) e Programação com o quadro de capacidade (§91).
- **Comercial.** Projetos e orçamentos versionados (§5.1), amostras Tn (§5.2), novos ciclos no mesmo Projeto e preço
  formado com origem (§69–§71, §74), duplicar versão (§85), Orçamento com página própria e o Hub (§92, §93),
  proveniência orçamento → Pedido (§34). Pedido com Plano de Atendimento, reserva de produto acabado, OP do saldo,
  Expedição e Faturamento (§29, §39), entregas programadas (§75), produto do Pedido do cliente do Pedido (§77),
  subtotal que fecha nas linhas (§55).
- **Custos e preço.** Fundação de custo de material e fonte canônica com oferta vigente (§31, §53, §76); estrutura e
  cálculo de custo industrial com recursos e tarifa por dia (§5.6–§5.8, §36, §79, §87); CMV do produto (§5.12, §78);
  precificação por faixa e Modelo de Precificação (§5.9, §68, §84); preço técnico × comercial (§60).
- **Gestão, relatórios e documentos.** Painel operacional (§30) e Painel Gerencial comercial (§94); relatórios `R-xx`
  com CSV e PDF, no dia comercial e sem corte silencioso (§30, §81); documento congela, ficha projeta (§67, §82); ajuda
  contextual "Como funciona" (§45, [`UX_HELP_GUIDE.md`](UX_HELP_GUIDE.md)).
- **Plataforma e UX.** Login com sessão e perfis (§1, §18.1); navegação com sidebar e menu recolhido; guarda de
  alterações não salvas; filtros com endereço e período; seleção em massa e documentos da seleção; campos numéricos
  pt-BR; consulta assistida nos seletores; integridade do que a tela mostra (§46, §48, §54, §56) — padrões em
  [`UI_BRAND.md`](UI_BRAND.md). Versão oficial com `GET /meta` e "Sobre o sistema"; tratador global de erros sem
  recursão; transições de documento travadas contra concorrência (§129).

## Ambientes

### DEV

Banco local `veridi_dev` = **DEV_REALDATA_BASELINE** desde 2026-09-14 (DEV-REALDATA-BASELINE-RESET-01): as migrations,
o ADMIN local do `seed-infra` e a carga inicial que PROD recebeu — mesmo pacote, mesmos códigos do ERP, mesmas contagens
de negócio. Estoque, OP, pedido e custo real seguem vazios: é o que a Veridi ainda não lançou. **Desde 2026-09-17 com as
Ondas A, 2 e 3 de duplicatas de Item saneadas** (§110, §118, §124): 18 Itens MP/ME a menos que PROD, que não foi
saneado; reconstruir pelo importador chega aos mesmos Itens, porque a carga segue o arquivo de decisão. O DEV tem a mais,
local: 9 Itens "Exemplo" do `veridi:examples`, a V2 do PROD-000001 e os Modelos FT-000003/004.

Reconstruir, nesta ordem, no Git Bash e na raiz. `W` é uma pasta de trabalho com cópia de `csv/`, `overrides/` e
`cmv-product-overrides.csv` de `../.local-data/veridi/` (o importador grava plano, findings e de-para ao lado dos
CSVs); `P` é `../.local-data/veridi/carga-inicial/pacote-carga-final.json`, em caminho absoluto:

1. `pnpm exec dotenv -e .env -- node scripts/local-db-reset.mjs --confirmar` — dump, drop/create, migrations e
   `seed-infra`. No PowerShell 5.1 o `--` é consumido e o script cai em simulação sem alterar nada
2. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:validate`
3. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:plan -- --devolucao=$P`
4. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:apply -- --apply --devolucao=$P`
5. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:verify`

A pasta da rodada de 2026-09-14 é `.local-data/veridi/carga-inicial/dev-baseline/`. Referência de mercado e cargas de
exemplo (`veridi:market-reference`, `veridi:examples`) ficam fora: PROD não as recebeu. Nunca `db push`, nunca edição
manual de `_prisma_migrations`. Runbook do importador em [`VERIDI_MIGRATION.md`](VERIDI_MIGRATION.md).

### Testes e E2E

As suítes da API e de scripts escrevem em `<banco>_test`, nunca no `veridi_dev` ([`TECH_BASELINE.md`](TECH_BASELINE.md),
"Test database"). As E2E rodam pela fundação nova (`pnpm e2e:run`, fixtures, base `veridi_e2e_baseline` com a carga
real) e como ADMIN (decisão G): WAVE 1–2 e WAVE 3 fechadas; a próxima é a WAVE 4 (grupo C), depois o golden path (WAVE
5). Plano e regras em [`E2E_STRATEGY.md`](E2E_STRATEGY.md); onde cada regra é protegida em
[`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md).

### Produção

**No ar: v1.0.0** (acima). **Zerada de negócio em 2026-09-11** (FAST-DEVELOPMENT-RESET-02) e, **em 2026-09-14, carga
inicial da Veridi** (pacote técnico final, 4 clientes `NAO_IMPORTAR`): 76 clientes, 113 fornecedores, 816 itens, 173
produtos, 161 formulações e 182 projetos na carga. PROD está em uso pela Veridi: as contagens mudam por atividade real.
Implantação em [`DEPLOY.md`](DEPLOY.md); cada publicação, com SHA, migrations, backup e smoke, em
[`RELEASES.md`](RELEASES.md). R2 ativo desde 2026-09-17 no bucket de homologação (`veridi-homologacao`). Backup: o
lógico JSON, restaurável e provado; sem PITR nem rotina agendada (OPS-BACKUP-01). As duplicatas de Item de PROD (21
grupos / 45 Itens no preflight de 2026-09-18) não foram saneadas, e o `prod-cleanup --apply` nunca rodou.

## Decisões operacionais vigentes

- **PROD é a fonte de verdade** — política permanente do PO (2026-09-18, [`DEPLOY.md`](DEPLOY.md) §10): uma versão nova
  muda schema, comportamento e funcionalidades, nunca o dado real da Veridi. Nada de copiar ou sincronizar o DEV nem
  reaplicar a carga inicial; migration aditiva e anulável, sem backfill inventado; `prod-cleanup --apply`, reset,
  `TRUNCATE`, seed destrutivo e saneamento genérico só com autorização específica do PO; a exclusão física de cadastro
  mestre (§125) não é ferramenta de migração.
- **Saneamento de duplicatas em PROD** é a única limpeza destrutiva já autorizada, e mesmo ela passa por discovery READ
  ONLY, PLAN e backup restaurável em PROD e aprovação do PO antes do APPLY — sempre separado de publicação; a decisão do
  DEV nunca é forçada sobre PROD.
- **Publicar é mover `release/prod`**; push na `main` não troca PROD. A versão só muda por decisão do PO, no commit que
  entra no SHA publicado ([`RELEASES.md`](RELEASES.md)).
- **`Item.code` sai de uma sequence por banco:** o mesmo código nomeia itens diferentes em DEV e em PROD. A chave
  estável entre ambientes é `externalCode`, que o importador copia e nunca regenera; carga que identifica registro por
  código interno grava no registro errado (lição de 2026-09-07).
- **Nenhum módulo é ocultado** (decisão da Veridi, 2026-09-10): Precificação, Orçamento e Faturamento continuam
  disponíveis.
- **Cápsulas vazias já cadastradas se marcam no cadastro** (`Item.consumedInProduction`, §52): é gesto de quem
  cadastra, e nenhum backfill por nome ou código foi ou será feito (FORMULATION-LOSS-SCOPE-01, 2026-09-15).
- **Desktop web é o alvo desta fase**; o endurecimento mobile/tablet é rodada própria, quando o PO a abrir
  ([`CLAUDE.md`](../CLAUDE.md), [`UI_BRAND.md`](UI_BRAND.md)).
- **Go-live não é inferido:** "PROD" na infraestrutura não é go-live, e o bloco de encerramento só ativa com decisão
  explícita do PO ([`BACKLOG_CLOSURE.md`](BACKLOG_CLOSURE.md)).
- **Decisões de cada entrega** (tela, fluxo, validação da rodada) continuam valendo: as de domínio são § do
  [`PRODUCT_RULES.md`](PRODUCT_RULES.md), as de tela estão no [`UI_BRAND.md`](UI_BRAND.md) ou no registro da entrega em
  [`archive/PROJECT_STATE_HISTORY.md`](archive/PROJECT_STATE_HISTORY.md).

## Discoveries em andamento

Índice e regras em [`discovery/README.md`](discovery/README.md). **`DECIDIDO` e sem implementação** (2026-09-19):
AUTHORIZATION-AUTHORSHIP, CLOSE-WITH-REASON, OPERATIONAL-HANDOFF-NEXT-ACTIONS e INTERNAL-CONSUMPTION-COST-CENTER.
**Parciais:** DOCUMENT-TRANSITION-CONCURRENCY (Fatia 2 aberta), INVENTORY-PHYSICAL-COUNT (Fatia 3),
ITEM-DUPLICATE-SANITIZATION (G6 e G11 com a Veridi; ondas em PROD) e MASTER-DATA-INACTIVE-VISIBILITY (D9).
**`EM_ANALISE`:** WAVE 4 e golden path das E2E, perfil final de quem executa a OP (PRODUCTION-PERMISSION-HARDENING) e
COST-VAR-01 (variação de CMV, sete decisões do PO). **Implementado, com confirmação pendente:** a Fatia 2 da exclusão
física (MASTER-DATA-HARD-DELETE-02, §128) aplicou duas leituras que esperam o PO — a referência de custo gravada na
criação do Item bloqueia a exclusão, e o PA "nascido com o Produto" é provado pela chave 1:1 e por nenhum uso próprio,
sem marca de nascimento; valem pela falha fechada até o PO dizer o contrário.

## Próxima prioridade

**A ordem vive na fila viva do [`BACKLOG.md`](BACKLOG.md)**, reorganizada em 2026-09-19 com a ordem do PO: P0
AUTHZ-VIEWER-READONLY-01; P1 AUTHORSHIP-SESSION-ACTOR-01; P0/P1 PENDING-PRODUCTION-LOT-ATTRIBUTION-01 (F-1); P1
DOCUMENT-TRANSITION-CONCURRENCY-01 Fatia 2, PURCHASE-SUGGESTION-OWNER-SCOPE-01 e as quatro fatias de CLOSE-WITH-REASON
(OC, OP, reserva, Pedido); P1/P2 DASHBOARD-ORDER-NEXT-ACTION-01; P2 as outras atenções do Painel, os outros quatro
laterais de VERIDI-AUDIT-QUICK-FIXES-01, API-500-RAW-ERROR-01, o Centro de Custo e o card de Uso e consumo. Depois:
REVERSALS-02, PURCHASE-NEEDS-CONSOLIDATED, CONTEXT/CONSULTATION, SHOP-FLOOR-RECORDING, MASTER-DATA-NAME-UNIQUENESS-01 e
o saneamento de PROD como operação separada. A WAVE 4, a Fatia 3 do Inventário Físico, o perfil final da Produção, a
WAVE 5, a homologação da bancada (FORMULATION-WORKBENCH-01) e DEMO-DATASET-01 esperam decisão ou handoff, fora dessa
ordem.

**Próximo corte: v1.1.0, candidata.** PROD segue v1.0.0 até decisão do PO. **Gate paralelo:** validação com a Veridi
para as regras que dependem do processo real do cliente (#7, #11 do BACKLOG; roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); regulatório em
[`BLOCK_H_VALIDATION.md`](BLOCK_H_VALIDATION.md), hard gate).

## Riscos e bloqueios atuais

- **Backup de PROD sem rotina** (OPS-BACKUP-01, HIGH): sem PITR nem agendamento; a volta depende do backup lógico JSON
  (`prod-backup-json.mjs`), restaurável e provado.
- **VIEWER ainda não é somente leitura** em toda rota, e parte da autoria nova ainda cai no fallback silencioso
  "Ambiente local" (AUTHZ-VIEWER-READONLY-01, P0; AUTHORSHIP-SESSION-ACTOR-01, P1). Antes de publicar, conferir os
  perfis dos usuários reais de PROD.
- **Produção em dobro no Plano misto** (F-1, PENDING-PRODUCTION-LOT-ATTRIBUTION-01, P0/P1), achado por leitura e ainda
  sem teste.
- **Concorrência documental, Fatia 2** (P1): Pedido, Faturamento, OC confirmar × cancelar e Lote ainda sem trava.
- **Guarda vermelha na `main`:** PERIOD-GUARD-R21-MATRIX-01 desde o R-21.
- **Duplicatas em PROD não saneadas**, o que prende o índice único de nome (MASTER-DATA-NAME-UNIQUENESS-01); G6 e G11
  dependem da Veridi (V4).
- **Bancada da Formulação em homologação** (FORMULATION-WORKBENCH-01): publicada, fecha só com a aprovação visual do PO.
- **Gates com a Veridi:** convenções operacionais (#7), material do cliente (#11), perfil final da Produção (P1 e P6) e
  o Bloco H regulatório — nada disso se implementa por suposição.

## Mapa de documentos

| Assunto | Fonte única |
|---|---|
| Estado atual, próximo gate | este arquivo |
| Pendências abertas e a ordem | [BACKLOG.md](BACKLOG.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
| Onde cada regra é protegida | [TEST_COVERAGE_MAP.md](TEST_COVERAGE_MAP.md) |
| Estratégia de E2E | [E2E_STRATEGY.md](E2E_STRATEGY.md) |
| Regras duráveis de UI e marca · ajuda contextual | [UI_BRAND.md](UI_BRAND.md) · [UX_HELP_GUIDE.md](UX_HELP_GUIDE.md) |
| Escopo do MVP · valor futuro · go-live | [MVP_PLAN.md](MVP_PLAN.md) · [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) · [BACKLOG_CLOSURE.md](BACKLOG_CLOSURE.md) |
| Discoveries do produto: índice e regras | [discovery/README.md](discovery/README.md) |
| Stack e ambiente · implantação · migração do legado | [TECH_BASELINE.md](TECH_BASELINE.md) · [DEPLOY.md](DEPLOY.md) · [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Publicações em PROD (SHA, deploy, migrations, backup, dados, smoke) | [RELEASES.md](RELEASES.md) |
| Validação com o cliente · perguntas regulatórias | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) · [BLOCK_H_VALIDATION.md](BLOCK_H_VALIDATION.md) |
| Histórico: entregas, backlog, precisão numérica, auditorias | [archive/README.md](archive/README.md) — [PROJECT_STATE_HISTORY](archive/PROJECT_STATE_HISTORY.md) · [BACKLOG_HISTORY](archive/BACKLOG_HISTORY.md) · [NUMERIC_PRECISION_AUDIT](archive/NUMERIC_PRECISION_AUDIT.md) · [DELIVERY_HISTORY](archive/DELIVERY_HISTORY.md) |

## Manutenção deste arquivo

Fotografia, não diário: ao entregar, reescrever as linhas que mudaram — capacidades, o que está na `main` e fora de
PROD, ambientes, riscos — em vez de acrescentar seção. O relato da entrega fica no commit; quando precisar ficar em
documento, vai para [`archive/PROJECT_STATE_HISTORY.md`](archive/PROJECT_STATE_HISTORY.md).

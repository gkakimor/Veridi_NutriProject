# INVENTORY-PHYSICAL-COUNT-DISCOVERY-01

Redesenho do Inventário Físico em sessões de inventário em lote.

## Status

`DECIDIDO` — 2026-09-15. O PO fechou D1–D8 e P1–P7 no handoff INVENTORY-PHYSICAL-COUNT-01: ver "Addendum PO —
decisões fechadas". `READY_TO_IMPLEMENT = YES`.

Leitura original, mantida como histórico: `EM_ANALISE` — 2026-09-15. Análise lida sobre `origin/main` = `c63c124`.

- Discovery completo executado. Nada implementado: nenhum schema, migration, tela, API ou teste.
- Concorrência e saldo de referência têm **recomendação fechada** (seção "Concorrência e saldo de referência").
- Oito decisões de PO continuam abertas, e quatro delas mexem em quantidade de estoque. Por isso
  `READY_TO_IMPLEMENT = NO` até o PO responder D1–D4 (ver "Decisões PO").
- Reviewers aplicados: `/erp-functional-reviewer` (regra completa e consistente?) e depois
  `/erp-operations-reviewer` (funciona na operação física?). A leitura de cada um está em "Findings".
- Severidade usada neste documento: **BLOCKER** (saldo incorreto, perda de rastreabilidade ou impossibilidade
  operacional), **HIGH** (operação insegura ou impraticável), **MEDIUM** (fricção relevante com caminho seguro),
  **LOW** (refinamento).
- Marcação: **EXISTE HOJE** (visto no código ou nos docs, com fonte), **PROPOSTO** (este discovery), **FUTURO**
  (roadmap ou adiado explicitamente).

## Objetivo

Transformar o Inventário Físico de hoje — uma posição por vez, confirmada e ajustada na hora — num processo
operacional de contagem em lote que preserve rastreabilidade, produtividade, segurança de estoque, retomada,
concorrência entre operadores e com a fábrica funcionando, histórico e evolução para inventário cíclico, sem
perder a contagem pontual que já funciona.

## PO baseline

Fonte: INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01 ([`BACKLOG.md`](../BACKLOG.md), seção G; commit `04d97ad`, merge
`9b011aa`). Tratada como **intenção aprovada**, não especificação final. Objetivos aprovados e o destino de cada um
neste discovery:

| Objetivo aprovado | Destino |
|---|---|
| Sessões de inventário em lote | Mantido — entidade `StockCount` |
| Função atual preservada como Contagem rápida | Mantido — mesma tela, passa a gravar documento |
| Lista de inventários: em andamento, concluídos, progresso, divergências, retomar | Mantido |
| Ações Novo inventário, Contagem rápida, Folha de contagem | Mantido |
| Montador de escopo com filtros (tipo, saldo, última contagem, movimentação, lote, histórico, propriedade, manual) | Mantido — filtros classificados em "suportável hoje" e "depende de histórico" |
| Mostrar itens e posições antes de iniciar | Mantido, com "Visualizar posições" e retirada |
| Posição: item sem lote = item; item com lote = item + lote | Mantido |
| Grade operacional (Código, Item, Lote, Unidade, Contagem, Situação) | Mantido + coluna Proprietário (material de cliente) |
| Contagem cega sem saldo nem diferença na primeira contagem | Mantido e endurecido: a cegueira é do servidor |
| Busca "Item, código ou lote", lotes do item sugeridos, Enter sequencial, compatível com scanner | Mantido |
| Adicionar item ou lote fora do escopo, auditado, nunca inventar lote | Mantido — só para item/lote existente; o resto vira ocorrência |
| Progresso "51 / 91 · 56%", interromper e retomar | Mantido |
| contar → revelar → recontar → revisar → confirmar ajustes | Mantido |
| Inventário nunca sobrescreve saldo; gera movimentos rastreáveis ligados à sessão | Mantido — FK 1:1 posição → movimento |
| FO-01 vinculada à sessão; cega não imprime saldo | Mantido |
| CSV exportar/importar; importar só preenche contagem; upload → validação → preview → erros → confirmação | Mantido |
| Modelo simples `codigo_item;lote;contagem` avaliado | Avaliado — recomendado para depois (justificado em "CSV") |
| Histórico: quem criou, contou, recontou, aprovou, valores, divergências, movimentos | Mantido |
| Modelagem aberta ao cíclico | Mantido — verificado em "Evoluções posteriores" |

**Nenhum objetivo aprovado foi retirado.** Dois foram faseados com justificativa: o modelo simples de CSV e os
motivos de inclusão por posição no preview. Um foi corrigido em detalhe: "adicionar lote" nunca cria lote — o que
não existe no ERP vira ocorrência registrada (D7).

## Estado atual

### O que o recurso é hoje

**Resposta: C — contagem + ajuste pontual.** Não é inventário: não há sessão, escopo, documento, histórico de
contagem sem diferença nem recontagem. É uma conferência de UMA posição que termina num ajuste.

Fluxo real (EXISTE HOJE, `apps/web/src/pages/inventory/StockCountPage.tsx`, `POST /stock-counts`):

1. Escolhe o item (`SearchableEntitySelect`, busca no servidor por código, nome, `externalBarcode`, `sourceName`,
   `declaredNutrient`).
2. Item com lote: escolhe o lote num `<select>` com **todos** os lotes do item — só o código aparece, sem
   proprietário, situação, validade ou saldo.
3. A tela mostra "Saldo sistema" (sempre — não há modo cego na tela; só no papel).
4. Digita a contagem (`DecimalField`, pt-BR, 12 casas). A diferença exibida é calculada no navegador com
   `Number(...)`.
5. Com diferença, motivo obrigatório (≥ 3 caracteres).
6. Confirmar: o servidor trava a linha do lote (ou do item sem lote) `FOR UPDATE`, lê o On Hand **naquele
   instante**, calcula a diferença e, se ≠ 0, cria um `InventoryMovement` `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` com
   `sourceType = STOCK_COUNT`, `sourceId = null`, `occurredAt = now`, `createdBy = nome do usuário`.
7. Diferença zero: **nada é gravado**.
8. Contagem abaixo do reservado: recusada (`CountBelowReservedError`).

### Limitação principal

**A contagem não é documento.** Sem sessão não há escopo, progresso, retomada, recontagem, revisão nem histórico; a
contagem que confere não deixa rastro (logo "última contagem" é impossível de responder), e o ajuste que sai dela
aponta para `sourceId = null`. Para lote grande, o operador repete 300 vezes buscar → escolher → digitar → confirmar,
e cada confirmação já mexe no estoque antes de qualquer revisão.

## Evidências

### Código e schema (EXISTE HOJE)

| Tema | Onde | O que diz |
|---|---|---|
| Tela | `apps/web/src/pages/inventory/StockCountPage.tsx` | Uma posição; diferença por `Number` (`:153-157`); saldo sempre visível; lote sem proprietário (`:284-291`) |
| Rota da tela | `apps/web/src/App.tsx:240`, `apps/web/src/app/navigation.ts:254` | `/estoque/inventario`, id de menu `stock-count` |
| Endpoint | `apps/api/src/modules/inventory/inventory.routes.ts:182-199` | `POST /stock-counts`, `requireRole(ADMIN, PRODUCTION, QUALITY)` |
| Serviço | `apps/api/src/modules/inventory/inventory.service.ts:404-457` | Trava escopo, compara com On Hand no confirmar, ajuste pela diferença, zero não grava |
| Trava de escopo | `inventory.service.ts:349-358` | `SELECT … FROM lots/items … FOR UPDATE` |
| Contrato | `packages/shared/src/inventory.ts:205-222`, `inventory.schemas.ts:57-62` | `countedQuantity` ≥ 0 (12 casas), `reason` opcional ≥ 3 |
| Ajuste manual | `inventory.service.ts:360-402`, `apps/web/src/components/AdjustStockDialog.tsx` | `ADJUSTMENT_IN/OUT/LOSS`, saída limitada ao Disponível |
| Papéis de escrita de estoque | `inventory.routes.ts:89` | `STOCK_WRITE_ROLES = ADMIN, PRODUCTION, QUALITY` — declarado como "menor gate defensável" |
| Ledger | `apps/api/prisma/schema.prisma:2929-2984` | `InventoryMovement` imutável; `quantity` sempre positiva, sinal pelo `type`; FKs 1:1 por origem (`receiptLineId`, `productionConsumptionId`, `productionOutputId`, `shipmentLineId`) |
| Tipos do ledger | `schema.prisma:59-88`, `packages/shared/src/inventory.ts:10-84` | 9 tipos; 9 origens; `STOCK_COUNT` = "Inventário físico" |
| `createdAt` do ledger | `prisma/migrations/20260819090000_inventory_movements/migration.sql` | `DEFAULT CURRENT_TIMESTAMP` |
| Saldo | `apps/api/src/lib/inventory-ledger.ts` | On Hand = soma algébrica; Reserved = reservas de OP + de Pedido, líquidas de consumo/expedição; Available só de lote elegível |
| Elegibilidade do lote | `inventory-ledger.ts:351-373`, `:464-479` | `isLotExpired` (dia civil inclusivo), `isLotAvailableForUse` (AVAILABLE + não vencido + CoA aprovado se exigido); ordem das causas |
| Lote | `schema.prisma:2832-2922` | `code` único `LT-YYYYMMDD-NNNNNN`; `status` AWAITING_RELEASE/AVAILABLE/BLOCKED/EXPIRED; `location String?`; `ownerType` VERIDI/CUSTOMER + `ownerCustomerId` imutável |
| Item | `schema.prisma:2017-2101`, `items.service.ts:231-246` | `controlsLot`, `controlsExpiry`, `unitCode` travados após uso operacional; `externalBarcode` |
| Unidade | `schema.prisma:1978-2000` | `UnitOfMeasure.dimension` MASS/COUNT/VOLUME; nenhuma regra de quantidade inteira para COUNT |
| Datas dos movimentos | `receiving.service.ts:337,506`; `production.service.ts:78,154`; `picking.service.ts:459,482`; `shipments.service.ts:906,931`; `samples.service.ts:379`; `scripts/veridi-import/opening-stock.ts:268` | `occurredAt` = `receivedAt` digitado (Recebimento), `producedAt` digitado ou agora (Produção), agora (consumo, expedição, amostra, ajuste, contagem), data de corte (abertura) |
| Travas por escritor | grep `FOR UPDATE` em `apps/api/src` | Recebimento trava a OC; picking trava `items` e linhas de reserva; expedição trava `items` e `lots`; produção trava o lote de destino; amostra trava `items`; ajuste/contagem travam lote ou item — **não há uma trava única por posição** |
| Busca de lote | `lots.service.ts:208-217`, `lots.schemas.ts`, `GET /lots/lookup?code=`, `packages/shared/src/lots.ts:10` | Busca por `code`, `supplierLot`, `businessLotNumber`, código e nome do item; QR `LOT:<código>` |
| Scan de lote | `apps/web/src/pages/lots/LotScanPage.tsx`, rota `/estoque/lotes/escanear` | Câmera + digitação manual |
| FO-01 | `apps/web/src/pages/print/OperationalSheets.tsx:42-91`, `apps/web/src/pdf/documents/OperationalSheetsPdf.tsx:116-205` | PDF do R-01 com `all=true`; `?cega=1` omite "Saldo sistema"; colunas Código, Item, Lote, Proprietário, Validade, Localização, Un., [Saldo], Contagem física, Diferença, Observação; sem vínculo a documento |
| Fonte da FO-01 | `apps/api/src/modules/reports/inventory-reports.service.ts:35-157` | R-01 sem filtro de ativo nem de saldo quando chamado pela tela: imprime o catálogo inteiro, lotes zerados incluídos |
| CSV | `apps/api/src/lib/csv.ts`, `apps/api/src/modules/exports/exports.routes.ts` | Só exportação: UTF-8 com BOM, `;`, CRLF, decimal por `Prisma.Decimal` com vírgula, neutralização de fórmula, rotas declaradas com gate de papel |
| Upload | `apps/api/src/app.ts:86` | `@fastify/multipart`, 10 MB, 1 arquivo — usado por anexos; **não existe importação CSV no produto** |
| Código sequencial | `apps/api/src/lib/sequence-code.ts`; prefixos em `packages/shared/src/*.ts` | `nextval` atômico; prefixo `INV` livre |
| Sessão de login | `apps/api/src/modules/auth/auth.service.ts:12` | 12 h, sem refresh |
| Guarda de alteração | `apps/web/src/app/use-unsaved-changes-guard` | Existe; **não há autosave** em nenhuma tela |
| Concorrência otimista | grep `409` / `version` | Nenhum campo de versão; 409 só por estado de domínio |
| Ajuda | `apps/web/src/help/content/suprimentos.ts:507-532, 749-768` | "A contagem física não sobrescreve o saldo" |
| Testes | `modules/inventory/adjustment-audit.test.ts`, `inventory.test.ts`, `pages/inventory/inventario-alteracoes-nao-salvas.test.tsx`, `pages/print/operational-sheets.test.tsx` | Papel e autoria do ajuste/contagem ([`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md) linhas 50 e 507) |

### Regras duráveis que continuam valendo (EXISTE HOJE)

- [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §14 — ledger é a única fonte de quantidade; Available respeita status;
  negativo impedido estruturalmente; propriedade do lote (material de cliente exige lote, dono imutável,
  visibilidade ≠ elegibilidade).
- §15 — histórico auditável; nunca "consertar" editando quantidade passada.
- §16 — contagem cria movimento, nunca edita saldo; diferença zero não cria movimento; contagem abaixo do reservado
  é recusada.
- §10 — `EXPIRED` é calculado, não gravado por job; liberar/bloquear nunca cria movimento.
- §11 — localização física simples; §12/§13 — QR `LOT:` é só identidade.
- §27 — correção por ajuste/estorno, com quem/quando/o quê/por quê.
- §31/§32 — relatório filtra pela data operacional; CSV no servidor, resultado filtrado completo, formato brasileiro.
- §48 — busca de entidade enxerga o conjunto elegível inteiro; entrada inválida nunca vira vazio ou zero.
- §49 — **não há tolerância na reconciliação de material, e isso é decisão**; prefixo de código identifica uma
  entidade só; decimal pt-BR recusa separador de milhar; o portão é do servidor.
- §66 — decimal de domínio não se compara por `Number`.
- §72/§73 — fuso `America/Sao_Paulo`; validade do lote inclusiva.

## Findings

### F1 — Leitura do `/erp-functional-reviewer`

**Resumo.** A regra atual é consistente para uma posição e um instante, e é insuficiente para um processo: a
contagem só existe quando diverge, não tem documento, compara com o saldo do instante do clique e não separa contar
de aprovar. O redesenho é seguro se, e só se, cinco invariantes forem do servidor (abaixo).

**Invariantes do novo domínio (PROPOSTO).**

1. Inventário nunca escreve saldo: o encerramento só cria `InventoryMovement` de ajuste, no máximo um por posição
   (FK 1:1).
2. O ajuste de uma posição é a **diferença congelada no registro da contagem que vale**, nunca "contado − saldo no
   encerramento" e nunca "contado − saldo de referência".
3. Uma posição (item, ou item + lote) está em no máximo **uma** sessão aberta. Duas sessões abertas na mesma posição
   ajustariam a mesma diferença duas vezes.
4. Registro de contagem é imutável (só se acrescenta); sessão encerrada não reabre nem é estornada.
5. Em modo cego, o servidor não devolve saldo esperado, diferença nem contagem anterior a quem conta — esconder só
   na tela vaza pela aba de rede.

**Gaps funcionais** — ver "Gaps".

**Impactos entre módulos.** Recebimento, Picking/Consumo, Apontamento de produção, Expedição, Amostra e Ajuste manual
continuam lançando no ledger sem nenhum bloqueio (D1); a reconciliação absorve o que eles lançam. Qualidade
(liberar, bloquear, CoA) não mexe em quantidade e não afeta a diferença. Reservas (OP e Pedido) limitam o ajuste de
saída no encerramento, como já limitam hoje. Relatórios R-01/R-03 passam a mostrar o documento `INV-` na origem do
ajuste. Painel e custo não mudam (o ajuste já existia como tipo).

### F2 — Leitura do `/erp-operations-reviewer`

**Resumo operacional.** O fluxo de hoje funciona com 1 a 5 posições e quebra a partir de ~50: sem retomada, sem
papel vinculado, sem cegueira na tela, sem proteção contra a fábrica andando durante a contagem. O maior risco
físico do redesenho não é técnico, é **defasagem entre o físico e o lançamento** (material separado antes de o
picking ser confirmado; recebimento lançado depois com data retroativa). Nenhum mecanismo de software elimina essa
defasagem sem parar a fábrica; o desenho recomendado a torna **visível por posição** e empurra para recontagem.

**Pode o objeto mudar enquanto o usuário trabalha?** Sim, em todas as posições, por seis escritores do ledger e por
três decisões de qualidade. Resposta recomendada em "Concorrência e saldo de referência".

### F3 — Achados pontuais do código atual

| # | Achado | Severidade |
|---|---|---|
| F3.1 | Contagem sem diferença não grava nada; ajuste de contagem tem `sourceId = null`. "Última contagem" e "divergência anterior" não são respondíveis com o dado de hoje, exceto pela existência de ajustes `STOCK_COUNT` | HIGH |
| F3.2 | A diferença aplicada é a do instante do confirmar, e pode não ser a mostrada na tela; o motivo digitado explica outro número, sem aviso | MEDIUM |
| F3.3 | Tela sem modo cego (só a FO-01 tem) | MEDIUM |
| F3.4 | Seleção de lote sem proprietário, situação, validade ou saldo | MEDIUM |
| F3.5 | Diferença calculada no navegador por `Number` (§66); o servidor recalcula com `Decimal` e é quem vale | LOW |
| F3.6 | FO-01 genérica imprime o catálogo inteiro (itens inativos e lotes zerados); a versão cega mantém a coluna "Diferença", que ninguém consegue preencher sem o saldo | MEDIUM |
| F3.7 | Tela de Inventário aparece para papéis que a API recusa — já registrado como I8/P5 em [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md) | LOW |
| F3.8 | `occurredAt` de recebimento e de produção é a data digitada, podendo ser anterior ao lançamento; reconciliar por `occurredAt` erraria | HIGH (restrição de desenho) |
| F3.9 | Não existe uma trava comum por posição entre os escritores do ledger; reconciliar não pode depender de trava | HIGH (restrição de desenho) |
| F3.10 | Quantidade fracionária aceita em unidade de dimensão COUNT | LOW |
| F3.11 | Material físico sem lote no ERP não tem caminho legítimo de entrada (recebimento exige OC ou material de cliente; ajuste exige lote existente) | HIGH (fora desta capability) |

## Regras propostas

Todas **PROPOSTO**. Não entram em `PRODUCT_RULES.md` antes da implementação.

### Sessão de inventário

**Nome da entidade.** O repositório já chama a contagem de `StockCount` (`POST /stock-counts`, `StockCountInput`,
`StockCountResultDTO`, origem `STOCK_COUNT`, `StockCountPage`), e "Inventory" no código significa estoque/ledger
(`InventoryMovement`, módulo `inventory`). Recomendação: **`StockCount`** (a sessão/documento),
**`StockCountPosition`** e **`StockCountEntry`**. `PhysicalInventory` e `InventoryCountSession` foram descartados:
o primeiro não aparece em lugar nenhum, o segundo colide com o sentido de "inventory" no código.

**Código.** `INV-000001`, sequence `stock_count_code_seq`, prefixo `INV` como constante no shared (§49: prefixo
canônico mora no shared, com o teste de contrato de unicidade). `INV` não está em uso.

**Tipos.** `kind = SESSION` (inventário em lote) ou `QUICK` (Contagem rápida, uma posição, criada e encerrada na
mesma transação). **Modo.** `BLIND` (contagem cega) ou `ASSISTED` (contagem com saldo). Quick é sempre `ASSISTED`.

**Campos com função operacional** (modelo completo em "Modelo de dados proposto"): código, tipo, modo, status,
descrição curta, filtros usados (retrato), instante de referência, e autoria com data de cada passagem — criou/
iniciou, concluiu a primeira contagem, encerrou, cancelou (com motivo). **Descartados:** progresso, contadores e
divergências gravados (são derivados das posições), responsável separado do criador (sem atribuição na primeira
entrega), versão numérica (a sessão serializa por `SELECT … FOR UPDATE`, padrão do repositório).

### Estados

Conjunto mínimo recomendado: **`IN_PROGRESS` → `IN_REVIEW` → `COMPLETED`**, e **`CANCELLED`** a partir dos dois
primeiros.

| Estado (UI) | Propósito | Entra por | Sai por | Ações permitidas | Edita? | Cancela? | Reabre? | Afeta estoque? | Imutável? |
|---|---|---|---|---|---|---|---|---|---|
| `IN_PROGRESS` "Em contagem" | Primeira contagem | "Iniciar inventário" (congela posições e saldo de referência) | "Concluir primeira contagem" → `IN_REVIEW`; "Cancelar" → `CANCELLED` | Registrar/corrigir contagem (rodada 1), importar CSV, FO-01, exportar CSV, adicionar e retirar posição, registrar ocorrência | Registros acrescentados; posições e referência congeladas | Sim, com motivo | — | Não | Registros e referência |
| `IN_REVIEW` "Em revisão" | Divergências reveladas, recontagem e decisão | Conclusão da primeira contagem (todas as posições contadas ou retiradas) | "Encerrar e gerar ajustes" → `COMPLETED`; "Cancelar" → `CANCELLED` | Pedir recontagem, registrar recontagem, decidir Ajustar/Não ajustar com motivo, adicionar posição (entra como pendente), ocorrência, FO-01 de recontagem, CSV de recontagem | Registros e decisões acrescentados | Sim, com motivo | Não volta a `IN_PROGRESS` | Não | Registros, referência |
| `COMPLETED` "Encerrado" | Histórico | Encerramento confirmado (ajustes criados na mesma transação) | — | Consultar, FO-01/CSV de resultado | Não | Não | Não | **Sim — no instante do encerramento, uma única vez** | Tudo |
| `CANCELLED` "Cancelado" | Histórico de sessão abandonada | Cancelamento com motivo | — | Consultar | Não | — | Não | Não (nunca criou movimento) | Tudo |

**Por que não `DRAFT`.** O montador de escopo com preview é sem estado: filtros e retiradas vivem na tela até
"Iniciar". Um rascunho gravado envelhece (lotes entram e saem do filtro), obrigaria reavaliar o escopo no início de
qualquer jeito e não protege trabalho relevante — refazer filtros custa um minuto. A FO-01 da sessão só é útil com a
lista congelada, e congelar é iniciar. Se o PO quiser preparar o inventário na véspera, `DRAFT` entra depois sem
refazer o domínio (é um estado antes de `IN_PROGRESS`).

**Por que não `RECOUNT` separado.** Recontagem é atividade **por posição** dentro da revisão. Um estado de sessão
"em recontagem" impediria decidir as posições que já conferem enquanto três lotes são recontados.

**Reabrir.** `COMPLETED` nunca reabre nem estorna: os ajustes já estão no ledger e outros movimentos vieram depois.
Correção de inventário errado = novo inventário daquelas posições (a contagem nova é a verdade) ou ajuste manual com
motivo. `CANCELLED` nunca reabre: cria-se outro.

### Posição de contagem

- Item sem controle de lote → posição = item (`lotId = null`). Item com lote → posição = item + lote. Item com lote
  nunca tem posição "item inteiro por cima dos lotes" (a ajuda de hoje já diz isso).
- Chave de posição gravada como texto (`itemId` ou `itemId:lotId`) com unicidade por sessão — `@@unique` com
  `lotId` nulo não impede duplicata no PostgreSQL.
- Número sequencial por sessão (1..N), atribuído no início na ordem de percurso (local, depois código). É o que o
  papel e o CSV usam no lugar de UUID (§32: nunca UUID onde há identificador humano).
- Retrato no início (não muda depois): código, nome, tipo e unidade do item; código, proprietário (tipo, cliente),
  situação, validade e local do lote.
- Material de clientes diferentes nunca se mistura: a posição é o lote, e o lote tem um dono imutável. Item sem lote
  é sempre Veridi (§14).

### Localização física

**EXISTE HOJE:** `Lot.location` e `ReceiptLine.location`, texto livre informado no recebimento, sem rota de edição
(`lots.routes.ts` não tem PATCH), sem Warehouse/Zone/Bin (comentário em `schema.prisma:2794`). Item sem lote não tem
local.

**AGORA:** usar o texto existente como **retrato** na posição, para ordenar o percurso da grade e da FO-01 e como
filtro "local contém". Rotulado honestamente como "local informado no recebimento".

**FUTURO:** localização estruturada ([`ROADMAP_POST_MVP.md`](../ROADMAP_POST_MVP.md), Endereçamento avançado). O
modelo proposto aceita a extensão sem refazer nada: a chave de posição ganha um terceiro componente
(`itemId:lotId:locationId`) e o saldo por posição passa a ser por lote + local. Não criar agora.

### Última contagem

**Definição recomendada:** o `countedAt` do registro de contagem **que valeu** (última rodada) de uma posição **não
retirada** de uma sessão **`COMPLETED`** (inclui `QUICK`), com qualquer decisão (inclusive "Não ajustar").

Por que não as outras:

- *Última sessão concluída* — a sessão pode encerrar dias depois da contagem; o fato físico é a contagem.
- *Último ajuste* — contagem que confere não gera ajuste; o lote contado ontem pareceria nunca contado.
- *Última recontagem* — já está coberta (é o registro que valeu).
- *Sessão aberta ou cancelada* — contagem não validada não verifica nada.

**Legado:** movimentos `STOCK_COUNT` anteriores (sem documento) contam como contagem no seu `createdAt`. Contagem
legada sem diferença não deixou rastro e não é recuperável — na virada, quase tudo aparece "nunca contado", e isso é
verdade para o dado disponível.

### Movimentação recente

Definida sobre `InventoryMovement` real, por posição (lote; ou item com `lotId = null`), pela **data operacional**
`occurredAt` (§31) — o filtro de escopo é pergunta de negócio, não de reconciliação.

| Filtro (UI) | Tipos |
|---|---|
| Qualquer movimentação | todos, exceto `OPENING_BALANCE` |
| Recebido | `RECEIPT_IN` |
| Consumido em produção | `PRODUCTION_CONSUMPTION` |
| Produzido | `FINISHED_GOOD_PRODUCTION` |
| Expedido | `SHIPMENT_OUT` |
| Ajustado | `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `LOSS` (inclui ajustes de inventário) |
| Amostra / desenvolvimento | `SAMPLE_CONSUMPTION` |

"Usado recentemente" não é oferecido: é ambíguo entre consumido, expedido e amostra.

### Sem movimentação há X dias

- Por **posição** (item + lote; item sem lote no nível do item). Item com lote não tem "última movimentação do item"
  como filtro de posição.
- Última movimentação = maior `occurredAt` entre os tipos operacionais (todos menos `OPENING_BALANCE`). Sem nenhum
  movimento operacional, vale a data do `OPENING_BALANCE` ("parado desde a abertura"). `OPENING_BALANCE` fica fora de
  "movimentado recentemente" porque na virada (2026-09-14) todo lote migrado pareceria movimentado ontem.
- Lote sem nenhum movimento de nenhum tipo: "nunca movimentado" — raro (todo lote nasce com `RECEIPT_IN`,
  `FINISHED_GOOD_PRODUCTION` ou `OPENING_BALANCE`), e cai no filtro "sem movimentação".

### Qualidade e validade

| Filtro (UI) | Regra real | Fonte |
|---|---|---|
| Liberado para uso | `isLotAvailableForUse` (AVAILABLE, não vencido, CoA aprovado se exigido) | `inventory-ledger.ts:361` |
| Aguardando liberação | `status = AWAITING_RELEASE` e não vencido | persistido |
| Laudo pendente | `requiresCoaSnapshot` e `coaStatus ≠ APPROVED` | persistido |
| Bloqueado | `status = BLOCKED` e não vencido | persistido |
| Vencido | `isLotExpired` — **calculado**, dia civil inclusivo, `America/Sao_Paulo` | nunca o `status` gravado |
| Vence em X dias | `expiryDate` dentro de X dias civis a partir de hoje comercial, não vencido | calculado |
| Lote específico | busca por código, lote do fornecedor, lote comercial | `lots.service.ts:208` |

Vencido prevalece sobre o status gravado, na mesma precedência de `unavailableReasonForLot`. O filtro de status do R-01
usa o `status` gravado e por isso **não** serve como fonte para "vencido".

### Propriedade

`Veridi` (lote `VERIDI` + itens sem lote), `Material de cliente` (qualquer lote `CUSTOMER`), `Cliente específico`
(`ownerCustomerId`). Mesma regra de `lotOwnerWhere`/`movementOwnerWhere`. A coluna Proprietário é obrigatória na
grade, no preview, na FO-01 e no CSV.

### Preview do escopo

- Resultado: "63 itens · 91 posições", com quebra por tipo e por proprietário.
- Avisos, não bloqueios: posições que já estão em outro inventário aberto (ficam fora, com o código `INV-` que as
  segura); lotes vencidos; material de cliente; posições com reserva ativa ("separação de OP pode estar em curso").
- "Visualizar posições": tabela paginada com retirar/recolocar; retirada vive na tela até iniciar.
- "Iniciar inventário" envia filtros + retiradas + o resumo do que foi visto; o servidor reavalia e, se o conjunto
  mudou (lote recebido, saldo zerado), responde conflito com o delta e a tela reapresenta o preview. O que foi visto é
  o que se conta.
- **Motivo de inclusão por posição** ("sem contagem há 45 dias", "vence em 18 dias"): **evolução posterior**. Na
  primeira entrega o preview mostra os filtros aplicados; a posição não carrega explicação própria.

### Autocomplete, item e lote

- **Na grade** (posições da sessão): campo único "Item, código ou lote", casa código e nome do item (trecho),
  código interno do lote, lote do fornecedor e lote comercial. Enter com um único resultado leva ao campo Contagem
  daquela linha; vários, lista.
- **Leitura de etiqueta/scanner**: o mesmo campo aceita `LOT:<código>` (prefixo do QR) e código de barras externo do
  item; resolução exata tem prioridade sobre trecho.
- **Adicionar posição**: busca do servidor que já existe — itens (`GET /items?search=`, inclui `externalBarcode`) e
  lotes (`GET /lots?search=`, `GET /lots/lookup?code=`). Escolhido item com lote, a lista seguinte mostra os lotes
  **existentes** daquele item com proprietário, situação, validade e saldo — com saldo primeiro, zerados permitidos
  (material encontrado fisicamente pode estar num lote zerado no ERP).

### Adicionar durante a contagem

| Caso | Recomendação |
|---|---|
| **A** — item/lote existe no ERP, fora do escopo | "Adicionar posição" com motivo obrigatório; grava quem, quando, motivo e origem `ADDED`; saldo de referência lido no instante da adição; recusado se a posição estiver em outro inventário aberto |
| **B** — item existe, lote físico não existe no ERP | **Nunca cria lote.** "Registrar ocorrência": item, identificação lida (etiqueta, lote do fornecedor), quantidade e observação. Sem posição, sem ajuste. Aparece na revisão e no histórico |
| **C** — item físico não existe no ERP | Mesma ocorrência, com identificação em texto. Cadastro de item é outra tela e outra decisão |

A regularização de material encontrado sem lote é gap real (F3.11) e **não cabe aqui**: exige decidir custo, dono,
validade e qualidade de um material sem origem. Registrado como pendência de PO.

### Grade e produtividade

Colunas: Nº, Código, Item, Lote, Proprietário, Local, Unidade, **Contagem**, Situação. Em contagem com saldo: +
Saldo esperado e Diferença. Em contagem cega: nunca, na rodada 1.

Situação derivada (nunca gravada): Pendente · Contada · Confere · Divergente · Recontagem pedida · Recontada ·
Decidida (Ajustar / Não ajustar) · Retirada.

Filtros internos (chips): Pendentes, Contadas, Divergentes, Em recontagem, Com movimentação, Retiradas. Ordenação:
Nº (percurso), local, código.

### Teclado, Enter e erro

1. Foco no campo Contagem. Digita `12,5`.
2. **Enter**: valida no navegador pelo mesmo tradutor pt-BR do servidor (`parsePtBrNumber`, 12 casas, sem separador
   de milhar, sem negativo).
3. Válido e diferente do último salvo → envia o registro; a linha mostra "Salvando…" e depois "Salvo"; o foco desce
   para a **próxima posição pendente** na ordem e filtro atuais.
4. Inválido → foco fica, valor digitado permanece, erro ao lado (`role="alert"`); nada é enviado (§48).
5. **Vazio + Enter** → não grava e desce. Vazio nunca é zero. Zero exige digitar `0` (posição não encontrada).
6. **Tab** → também confirma o valor válido e vai para o próximo campo; Shift+Tab volta.
7. **Esc** → descarta a edição não salva e volta ao último valor salvo.
8. Falha de rede → linha em "Não enviado — tentar de novo", valor na fila local, foco segue.

Sem atalho para concluir rodada, zerar pendentes, ajustar ou encerrar — tudo isso é botão com confirmação.

**Unidade de contagem.** Sempre a unidade de estoque do item (retrato). Sem conversão na primeira entrega. Unidade de
dimensão COUNT com casa decimal: recomendação **recusar** na contagem (pendência P2 — hoje o domínio aceita).

### Autosave

| Opção | Rede instável | Sessão expirada | PC reinicia / navegador fecha | Operação longa | Veredito |
|---|---|---|---|---|---|
| A — por linha, ao confirmar (Enter/Tab/sair do campo) | Fila local + reenvio idempotente | Fila local sobrevive ao login | Perde no máximo a linha em edição | Cada linha é um POST pequeno | **Recomendado** |
| B — salvar a grade explicitamente | Um POST grande falha inteiro | Perde tudo desde o último salvar | Perde tudo desde o último salvar | Payload cresce com a sessão | Rejeitado |
| C — debounce enquanto digita | Idem A | Idem A | Idem A | Grava números parciais (`1` de `12`) num histórico que só acrescenta | Rejeitado |

Detalhes da opção A: cada tentativa leva um `clientRequestId` (UUID); reenvio com o mesmo id devolve o registro já
criado, nunca duplica. Valores ainda não confirmados pelo servidor ficam no `localStorage` por sessão + posição; ao
reabrir, a tela mostra "2 contagens não enviadas" com Enviar/Descartar. A guarda de alterações não salvas
(`useUnsavedChangesGuard`) pergunta enquanto a fila não estiver vazia. 401 no meio: fila preservada, login, retomada.

### Contagem cega

- Rodada 1 em modo cego: a API não devolve saldo de referência, saldo esperado nem diferença; a FO-01 e o CSV não os
  trazem. **A cegueira é do servidor.**
- Revelação na conclusão da primeira contagem ("82 conferem · 9 divergentes").
- Recontagem em modo cego: **quem reconta não vê** a primeira contagem, o esperado nem a diferença; a tela de revisão
  (quem pede a recontagem e decide) vê tudo. Se a mesma pessoa revisa e reconta, a cegueira deixa de existir de fato —
  o sistema não impede (empresa pequena), registra e sinaliza "recontada pela mesma pessoa que revisou".
- Contagem com saldo (`ASSISTED`) mostra esperado e diferença desde a rodada 1 — útil para conferência pontual e
  para quem conta sozinho.

### Recontagem

Casos obrigatórios:

| Esperado | 1ª | 2ª | Resultado |
|---|---|---|---|
| 10 | 8 | 10 | Diferença final 0 → nenhum ajuste; a 1ª contagem fica no histórico como erro de contagem |
| 10 | 8 | 8 | Diferença final −2 confirmada → ajuste de saída de 2 com motivo |

Regras recomendadas (D2):

- Recontagem **não é obrigatória**. O revisor pede por posição ou em lote ("Recontar divergências").
- **Posição divergente que teve movimentação durante o inventário** só fecha com recontagem **ou** confirmação
  explícita do revisor ("Confirmo que os movimentos listados aconteceram depois da contagem").
- Segundo operador permitido, não exigido; mesma pessoa permitida, registrada.
- **Vale a última rodada.** Não há média nem escolha entre rodadas: para mudar, reconta de novo. Rodadas ilimitadas.
- **Cada recontagem congela o seu próprio saldo esperado** no instante do registro. Comparar a 2ª contagem com o
  esperado da 1ª seria erro de saldo sempre que houve movimento entre elas (BLOCKER se implementado assim).

### Tolerância

| Opção | Prós | Contras | Classificação |
|---|---|---|---|
| Sem tolerância | Consistente com §49 e `RecipeWeighing` ("diferença é registrada, nunca escondida"); nada some | Diferença de balança (0,001 kg) vira decisão | **Primeira entrega** |
| Absoluta por posição | Simples | Um número para kg e un não serve | Evolução |
| Percentual | Escala | Some com diferença de lote pequeno; "a pequena é como a grande começa" | Não colocar agora |
| Por unidade | Resolve kg × un | Configuração nova | Evolução |
| Por categoria/família | Fino | Engine | Evolução posterior |

Recomendação (D3): **sem tolerância**; toda diferença ≠ 0 é divergência; ruído se trata com a decisão **"Não
ajustar"** com motivo, em lote para as posições selecionadas.

### Contar × aprovar

Capacidades separadas no domínio, registradas com autor e instante: criar/iniciar, contar, recontar, importar CSV,
adicionar/retirar posição, concluir primeira contagem, pedir recontagem, decidir (revisar), encerrar (aprovar
ajustes), cancelar. Papéis na seção "Auditoria e permissões" (D4).

### Encerramento

Numa transação única, com a sessão travada (`FOR UPDATE`) e as linhas de item e de lote das posições com ajuste
travadas em ordem (`items` por id, depois `lots` por id — mesma ordem da Expedição, sem deadlock):

1. Toda posição contada ou retirada; toda posição com diferença final ≠ 0 decidida (Ajustar / Não ajustar) com
   motivo; posição divergente com movimentação durante o inventário recontada ou confirmada.
2. Unidade do item igual ao retrato.
3. Para cada posição "Ajustar": `saldo atual + diferença final ≥ 0`, e, em ajuste de saída, `≥ reservado atual`
   (análogo de `CountBelowReservedError`). Violou → encerramento recusado, com a lista de posições (recontar ou
   revisar reservas).
4. Cria um `InventoryMovement` por posição "Ajustar": `ADJUSTMENT_IN`/`ADJUSTMENT_OUT`, `quantity = |diferença
   final|`, `sourceType = STOCK_COUNT`, `sourceId` e FK 1:1 = posição, `reason` = motivo da decisão, `createdBy` =
   quem encerrou, **`occurredAt` = instante do encerramento** — nunca retroativo ao `countedAt`, porque movimento
   retroativo é exatamente o que confunde a reconciliação do próximo inventário.
5. Sessão `COMPLETED`. Repetir o encerramento é recusado pelo status e, no banco, pela FK única.

### Contagem rápida — destino da tela atual

**Manter** a tela e o fluxo (uma posição, com saldo, confirma e ajusta), renomeada **"Contagem rápida"** no menu e
nas ações da home. Mudanças recomendadas:

- Grava um `StockCount` `kind = QUICK`, com uma posição e um registro, já `COMPLETED`, na mesma transação do ajuste.
  A contagem que confere passa a deixar rastro e alimenta "última contagem"; o ajuste ganha documento. Contrato da
  resposta (`StockCountResultDTO`) preservado.
- Recusa posição que está em inventário aberto ("este lote está no INV-000014; registre lá").
- Envia o saldo que a tela mostrou; se o saldo mudou até o confirmar, 409 "O saldo mudou desde que você abriu (era
  10, agora 8). Confira antes de confirmar" (fecha F3.2).
- Lote com proprietário, situação, validade e saldo na escolha (fecha F3.4); diferença exibida com decimal (F3.5).

A rota `/estoque/inventario` passa a ser a home dos inventários; a Contagem rápida ganha rota própria. Testes de rota e
de navegação que citam `stock-count` mudam junto.

## Gaps

| # | Gap (hoje) | Severidade |
|---|---|---|
| G1 | Sem sessão/documento: sem escopo, progresso, retomada, recontagem, revisão ou histórico (F3.1) | HIGH |
| G2 | Contagem sem diferença não deixa rastro; "última contagem" e "divergência anterior" irrespondíveis (F3.1) | HIGH |
| G3 | Sem modo cego na tela (F3.3) | MEDIUM |
| G4 | Diferença aplicada ≠ diferença mostrada quando o saldo muda (F3.2) | MEDIUM |
| G5 | Lote sem proprietário na escolha (F3.4) | MEDIUM |
| G6 | FO-01 sem vínculo, catálogo inteiro, coluna Diferença na cega (F3.6) | MEDIUM |
| G7 | Sem importação CSV em lugar nenhum do produto | MEDIUM (construção nova) |
| G8 | Sem autosave, sem fila local, sem idempotência de registro | HIGH para sessão longa |
| G9 | Sem caminho legítimo para material encontrado sem lote no ERP (F3.11) | HIGH — fora desta capability |
| G10 | Unidade COUNT aceita fração (F3.10) | LOW |
| G11 | Ação visível para papel recusado (F3.7) | LOW — já em P5 do discovery de permissões |
| G12 | Localização é texto livre sem edição | LOW — FUTURO |

## Riscos

| # | Risco | Severidade | Tratamento recomendado |
|---|---|---|---|
| R1 | Defasagem físico × lançamento (material separado antes do picking confirmado; carga saiu antes da expedição confirmada; recebimento lançado depois com data retroativa) | HIGH residual | Marca de movimentação por posição; lançamento com `occurredAt` anterior ao registro da contagem destacado; recontagem ou confirmação explícita; orientação "confirme separações antes de contar" |
| R2 | Duas sessões abertas na mesma posição ajustam a mesma diferença duas vezes | BLOCKER se não impedido | Uma posição em no máximo uma sessão aberta, verificado sob trava da linha de item/lote no início e na adição; Contagem rápida respeita |
| R3 | Cegueira só na tela vaza saldo pela rede | HIGH | API não devolve esperado/diferença na rodada 1 cega |
| R4 | Comparar com o saldo no encerramento (opção D) | BLOCKER | Ajuste = diferença congelada no registro |
| R5 | Recontagem comparada com o esperado da 1ª contagem | BLOCKER | Cada registro congela o próprio esperado |
| R6 | Ajuste com `occurredAt` retroativo | HIGH | `occurredAt` = encerramento |
| R7 | Ação em lote "zerar pendentes" apaga estoque de prateleira não visitada | BLOCKER se oferecida | Não oferecer; pendente se conta (inclusive `0`) ou se retira com motivo |
| R8 | Autosave com debounce enche o histórico de números parciais | MEDIUM | Autosave só ao confirmar a linha |
| R9 | Último-write-vence entre operadores apaga contagem | HIGH | Conflito explícito (409) |
| R10 | Encerramento de 1.000 posições segura travas de item/lote | MEDIUM | Travar só posições com ajuste, em ordem; transação curta (somas em lote, `createMany`); limite de posições por sessão |
| R11 | Sessão aberta por dias acumula movimentação e marcas | MEDIUM | Aviso "em contagem há 3 dias"; recomendação operacional de dividir por tipo/área |
| R12 | CSV de outra sessão ou antigo aplicado | HIGH | Código `INV-` e nº de posição validados; hash do arquivo |

## Concorrência e saldo de referência

**HIGH / STRUCTURAL DECISION.** Esta é a pergunta que decide se o inventário produz saldo certo.

### O problema, com o cenário obrigatório

14:00 saldo ERP = 10, inventário começa. 14:10 a produção consome 2. 14:15 o operador conta 8. A diferença real é
**0**; qualquer desenho que conclua −2 gera um ajuste de saída de 2 e tira do livro material que existe.

Duas restrições do código real limitam as soluções:

- **`occurredAt` não é ordem de lançamento** (F3.8). Recebimento e apontamento de produção gravam a data digitada. Um
  recebimento lançado às 15:00 com `receivedAt` 13:00 tem `occurredAt` anterior ao início do inventário, mas não
  estava no saldo lido às 14:00. Reconciliar por `occurredAt` erra.
- **`createdAt` também não é ordem de efetivação.** É `DEFAULT CURRENT_TIMESTAMP`, que no PostgreSQL é o início da
  transação; uma transação que começou antes de uma leitura e confirmou depois tem `createdAt` menor e não estava na
  leitura. E não há trava comum por posição entre os escritores (F3.9). Portanto **partição por carimbo de tempo não
  pode ser a fonte dos números**; serve para listar e explicar.

### Alternativas

| | A — Bloquear movimentações | B — Retrato no início | C — Referência + reconciliar movimentos até a contagem | D — Saldo atual no confirmar/encerrar | E — Esperado por posição no registro | **F — Híbrido recomendado** |
|---|---|---|---|---|---|---|
| Cenário 10 → −2 → conta 8 | 0 (nada se moveu) | **−2 errado** | 0 | Se encerrar às 14:15: 0. Se encerrar às 17:00 com recebimento de +5 às 15:00: **−5 errado** | 0 | 0 |
| Segurança do saldo | Alta, se ninguém lançar retroativo depois | Baixa | Alta, se o instante da contagem for conhecido | **BLOCKER** em sessão longa | Alta | Alta, com risco residual R1 sinalizado |
| Complexidade | Média-alta: gate em 6 escritores + desbloqueio | Baixa | Média | Baixa (é o de hoje) | Baixa | Média |
| Operação real (Veridi produz, recebe e expede todo dia) | **Inviável**: parar doca, picking e expedição por horas | Só funciona com A | Boa | Só serve para uma posição instantânea | Boa | Boa |
| Rastreabilidade | Boa | Fraca (diferença não explicada) | Boa (lista movimentos) | Fraca | Média (sem referência da sessão) | Boa: referência, esperado, movimentos, decisão, ajuste |
| Multiusuário | Neutro | Neutro | Neutro | Neutro | Neutro | Neutro |
| Performance | Checagem extra em todo lançamento | Uma leitura | Leitura por posição por registro | Leitura no encerramento | Uma soma por registro | Uma leitura no início + uma soma por registro + somas em lote no encerramento |
| UX | Ruim: "estoque bloqueado por inventário" | Simples e errada | Boa | Enganosa | Boa | Boa; revisão mostra a conta |
| Risco de erro | Lançamento represado vira lançamento retroativo depois (pior) | Alto | Depende de instante confiável | Alto | Baixo | Baixo |
| Recebimento | Bloqueado | Diferença falsa | Sem impacto | Diferença falsa | Sem impacto | Sem impacto; retroativo sinalizado |
| Produção | Bloqueada | Diferença falsa | Sem impacto | Diferença falsa | Sem impacto | Sem impacto; marca de movimentação |
| Expedição | Bloqueada | Diferença falsa | Sem impacto | Diferença falsa | Sem impacto | Sem impacto; marca de movimentação |

**D é o comportamento de hoje**, e é correto só porque a Contagem rápida confirma no mesmo minuto em que conta.
Numa sessão ele produz ajuste de material real (BLOCKER).

### Recomendação — F

1. **Saldo de referência por posição, no início** (ou na adição). Uma leitura do ledger para todas as posições, na
   transação que congela o escopo. Serve à auditoria e à explicação ("referência 10"), não é a base do ajuste.
2. **Saldo esperado congelado em cada registro de contagem.** A transação que grava o registro soma o ledger da
   posição naquele instante (leitura confirmada) e grava `expectedQuantity` junto de `countedQuantity`. A diferença do
   registro é `contado − esperado do mesmo registro`.
3. **Ajuste = diferença congelada do registro que vale**, aplicada como **delta** no encerramento. Movimentos
   lançados depois da contagem continuam no ledger e não são desfeitos nem contados de novo.
4. **Marca de movimentação durante o inventário** por posição: esperado ≠ referência, ou movimentos da posição
   lançados depois da referência (listados por `createdAt`), ou movimentos lançados depois do registro da contagem.
   Movimento lançado depois da contagem com `occurredAt` anterior a ela é destacado como **lançamento retroativo**.
5. **Posição divergente e marcada** fecha só com recontagem ou confirmação explícita (D2).
6. **Sem bloqueio** de Recebimento, Produção, Expedição, Amostra ou Ajuste. A única exclusividade é entre inventários
   (R2).

### Modelo de reconciliação

Definições por posição:

| Símbolo | Nome (UI) | Quando | Gravado? |
|---|---|---|---|
| `t_ref` | Início do inventário (ou adição da posição) | "Iniciar inventário" / "Adicionar posição" | Sim |
| `R` | Saldo de referência | Lido do ledger em `t_ref` | Sim |
| `t_k` | Registro da contagem k | Gravação do registro (servidor) | Sim |
| `E_k` | Saldo esperado | Lido do ledger em `t_k`, na transação do registro | Sim |
| `C_k` | Contagem | Digitado / importado | Sim |
| `M(t_ref, t_k]` | Movimentos após a referência | `E_k − R` | Derivado |
| `D_k` | Diferença | `C_k − E_k` | Derivado |
| `k*` | Registro que vale | Último registro válido da maior rodada | Derivado |
| `t_rev` | Decisão | Revisor decide | Sim (autor, motivo) |
| `t_close` | Encerramento | "Encerrar e gerar ajustes" | Sim |
| `B_close` | Saldo no encerramento | Lido sob trava em `t_close` | Não (é do ledger) |
| `A` | Ajuste | `D_k*` | Sim (é o movimento) |

Fórmula conceitual:

```
E_k   = OnHand_ledger(posição, t_k)            -- congelado no registro
D_k   = C_k − E_k
A     = D_k*                                     -- nunca C_k* − B_close, nunca C_k* − R
B_após = B_close + A
       = C_k* + [B_close − E_k*]                 -- contado + o que foi lançado depois da contagem
Invariantes no encerramento: B_após ≥ 0; se A < 0, B_após ≥ Reservado(t_close)
```

**Movimentos considerados:** todos os `InventoryMovement` da posição (lote; ou item com `lotId = null`), de todos os
tipos, inclusive ajustes manuais e contagens rápidas anteriores. O On Hand é a soma algébrica; nenhum tipo é excluído.

**Intervalos:** `(t_ref, t_k]` explica o esperado (lista na revisão); `(t_k*, t_close]` é preservado pelo delta (lista
"lançados depois da contagem").

**Prevenção de dupla contagem:** o ajuste nunca reaplica movimento. Cada movimento está no ledger uma vez, e o
ajuste é só a diferença entre o físico e o livro **no mesmo instante** (`t_k*`). A FK 1:1 posição → movimento impede
ajuste duplicado; a exclusividade de posição entre sessões abertas impede dois inventários ajustando a mesma diferença.

**Números vêm das somas gravadas; listas vêm de `createdAt`.** Se a soma da lista de movimentos não fechar com
`E_k − R` (transação que atravessou o instante da leitura), a revisão mostra "movimento em processamento no instante
da referência" — o número continua certo, porque não depende da lista.

**Auditoria:** `R`, `t_ref`, cada `(C_k, E_k, t_k, autor, origem)`, a decisão (autor, motivo, confirmação de
movimentação), o movimento de ajuste (FK) e os movimentos do ledger permitem refazer a conta a qualquer tempo.

**Exemplo obrigatório:**

```
14:00  R  = 10                          (referência)
14:10  consumo de produção −2           (ledger = 8)
14:15  contagem C1 = 8; E1 = 8          (esperado lido no registro)
       M(ref, t1] = E1 − R = −2
       D1 = C1 − E1 = 0                 → Confere; nenhum ajuste
```

**Exemplo com perda real e movimento depois da contagem:**

```
14:00  R = 10
14:10  consumo −2                       (ledger 8)
14:15  C1 = 7; E1 = 8; D1 = −1          → Divergente, com movimentação (consumo)
15:00  recebimento de item sem lote +5  (ledger 13)
15:30  recontagem cega: C2 = 12; E2 = 13; D2 = −1   → vale a rodada 2
16:00  revisor decide Ajustar, motivo "avaria"
17:00  encerramento: B_close = 13; A = D2 = −1; B_após = 12 = C2 + 0   ✓
```

**Exemplo do risco residual (lançamento retroativo):** 13:00 chegam fisicamente 5; 14:00 `R` = 10 (sem os 5); 14:15
`C1` = 15, `E1` = 10, `D1` = +5; 15:00 o recebimento é lançado com `receivedAt` = 13:00 (ledger 15). Sem proteção, o
encerramento aplicaria +5 → 20 (errado). Com F, a posição aparece com **lançamento retroativo anterior à contagem**; a
recontagem (`C2` = 15, `E2` = 15, `D2` = 0) resolve, ou o revisor decide "Não ajustar".

### Outros movimentos durante a contagem

| Evento | Quantitativo? | Efeito no desenho |
|---|---|---|
| Recebimento de item com lote | Sim, em **lote novo** (todo recebimento cria lote) | Posição nova, fora do escopo; aviso "lotes recebidos após o início" na grade; se contado, "Adicionar posição" (referência já inclui a entrada) |
| Recebimento de item sem lote | Sim, na posição do item | Reconciliado pelo esperado; `receivedAt` retroativo destacado |
| Consumo de produção (picking) | Sim | Reconciliado; defasagem física (R1) marcada |
| Entrada de PA | Sim, em lote novo ou em lote existente (`requestedLotId`) | Lote existente: reconciliado; `producedAt` retroativo destacado |
| Expedição | Sim | Reconciliada; defasagem física marcada |
| Ajuste manual / perda | Sim | Reconciliado e listado; não é bloqueado |
| Consumo de amostra | Sim | Reconciliado |
| Contagem rápida | Sim | **Recusada** em posição de inventário aberto |
| Outro inventário | Sim | **Impedido** pela exclusividade (R2) |
| Liberação de qualidade | Não — status | Nenhum efeito na diferença; a revisão mostra a situação atual ao lado do retrato |
| Bloqueio / desbloqueio de lote | Não — status | Idem; lote bloqueado continua contável e ajustável |
| Aprovação/rejeição de CoA | Não — documental | Idem |
| Vencimento durante a contagem | Não — calculado | Idem |

## Escopo e filtros

Semântica: **E** entre grupos, **OU** dentro do grupo (ex.: MP ou Embalagem). Filtros por posição.

| Grupo | Filtro | Suportável hoje? | Fonte |
|---|---|---|---|
| Tipo | Matéria-prima / Embalagem / Produto acabado / Todos | Sim | `Item.type` |
| Saldo | Somente com saldo / Com ou sem saldo | Sim | Ledger (`lotIdsComSaldoPositivo`, `getOnHandByItems`) |
| Última contagem | Nunca contado; sem contagem há 7/15/30/60/90/X dias | **Depende de histórico** — responde a partir da primeira entrega; hoje só pelos ajustes `STOCK_COUNT` legados | `StockCountEntry` de sessão `COMPLETED` + legado |
| Movimentação | Movimentado nos últimos X dias; sem movimentação há X dias; recebido/consumido/produzido/expedido/ajustado/amostra recentemente | Sim | `InventoryMovement.occurredAt` + tipo |
| Lote | Liberado / Aguardando liberação / Laudo pendente / Bloqueado / Vencido / Vence em X dias / Lote específico | Sim | Lote + `isLotExpired` |
| Histórico | Com divergência anterior | **Depende de histórico** — legado parcial pelos ajustes `STOCK_COUNT` | Posições encerradas com diferença final ≠ 0 |
| Histórico | Divergência recorrente | **Evolução** | ≥ 2 divergências nas últimas N sessões |
| Propriedade | Veridi / Material de cliente / Cliente específico | Sim | `Lot.ownerType`, `ownerCustomerId` |
| Local | Local contém | Sim (texto livre) | `Lot.location` |
| Seleção | Manual | Sim | Busca de item/lote |

"Com ou sem saldo" inclui lotes zerados de toda a história: o preview avisa o volume. Item inativo **com saldo** é
contável (o material existe); item inativo sem saldo fica fora.

Filtros **futuros**: alto giro, divergência recorrente, sugestão cíclica, localização estruturada.

## UX recomendada

Vocabulário da UI: nada de SKU, cut-off, snapshot, recount, lock.

| Interno | Na tela |
|---|---|
| SKU / item code | Código do item |
| snapshot / reference | Saldo de referência · Início do inventário |
| expected | Saldo esperado |
| recount | Recontagem |
| blind / assisted | Contagem cega · Contagem com saldo |
| position | Posição |
| entry | Registro de contagem |
| lock (exclusividade) | "Posição em outro inventário (INV-000014)" |
| finding | Ocorrência |
| ADJUST / NO_ADJUSTMENT | Ajustar · Não ajustar |
| COMPLETED / CANCELLED | Encerrado · Cancelado |

### Lista (home)

```
INVENTÁRIO FÍSICO
[ + Novo inventário ]  [ Contagem rápida ]  [ Folha de contagem ]

Filtros: Situação [Em aberto ▾]   Período [    ]   Busca [INV-, descrição]

Código      Data        Escopo                      Progresso        Divergências  Situação     Responsável  Ações
INV-000014  15/09 08:02 MP · com saldo · Veridi      51 / 91 · 56%    —             Em contagem  Ana          [Retomar]
INV-000013  12/09 09:10 Embalagem                    40 / 40 · 100%   3             Em revisão   Bruno        [Revisar]
INV-000012  05/09 07:45 PA · cliente CLI-000003      28 / 28 · 100%   0             Encerrado    Ana          [Ver]
```

"Divergências" só aparece depois da revelação. Contagem rápida lista em aba própria ("Contagens rápidas") para não
poluir.

### Novo inventário

```
NOVO INVENTÁRIO
Descrição (opcional) [Matérias-primas — setembro]
Modo  (•) Contagem cega  ( ) Contagem com saldo

Tipo            [x] Matéria-prima [ ] Embalagem [ ] Produto acabado
Saldo           (•) Somente com saldo ( ) Com ou sem saldo
Propriedade     (•) Todos ( ) Veridi ( ) Material de cliente ( ) Cliente [      ▾]
Lote            [ ] Liberado [ ] Aguardando [ ] Laudo pendente [ ] Bloqueado [ ] Vencido [ ] Vence em [30] dias
Última contagem ( ) Qualquer ( ) Nunca contado ( ) Sem contagem há [30▾] dias
Movimentação    ( ) Qualquer ( ) Movimentado nos últimos [7] dias ( ) Sem movimentação há [90] dias
                Tipo [Qualquer ▾]
Local contém    [        ]
[+ Adicionar item ou lote manualmente]

────────────────────────────────────────────
63 itens · 91 posições   (MP 91 · Veridi 84 · cliente 7)
⚠ 4 posições já estão no INV-000013 e ficam fora
⚠ 2 lotes vencidos · 11 posições com reserva ativa
[ Visualizar posições ]                    [ Iniciar inventário ]
```

Filtros avançados (lote, última contagem, movimentação, local) recolhidos por padrão; o preview atualiza a cada
mudança. Não vira formulário gigante: um bloco por grupo, uma linha cada.

### Preview

`Visualizar posições` abre tabela paginada (Nº provisório, Código, Item, Lote, Proprietário, Local, Validade,
Situação do lote, [Saldo se contagem com saldo], Retirar). Recomendação:

- retirar e recolocar: sim;
- adicionar: sim (mesma busca da adição);
- voltar aos filtros: sim, preservando retiradas que continuam no filtro;
- congelar ao iniciar: sim; conjunto divergente do visto → conflito com delta.

### Contagem

```
INV-000014 · Matérias-primas — setembro · Em contagem · Contagem cega
51 / 91 posições · 56%                     Início 15/09 08:02 · Ana

[ Item, código ou lote ________________ ]   [Pendentes 40] [Contadas 51] [Com movimentação 6]
[ Importar CSV ] [ Exportar CSV ] [ FO-01 ] [ + Adicionar posição ] [ Ocorrência ]      [ Concluir primeira contagem ]

Nº  Código     Item              Lote               Proprietário  Local    Un  Contagem   Situação
12  MP-000431  Vitamina C        LT-20260902-000118 Veridi        A-03     kg  [ 12,5  ]  Salvo
13  MP-000431  Vitamina C        LT-20260910-000140 Veridi        A-03     kg  [       ]  Pendente
14  MP-000077  Colágeno          LT-20260815-000020 CLI-000003    B-01     kg  [ 0     ]  Contada
```

"Concluir primeira contagem" só habilita com zero pendentes (pendente se conta, inclusive `0`, ou se retira com
motivo).

### Divergências (após a primeira rodada)

```
Primeira contagem concluída: 82 conferem · 9 divergentes (3 com movimentação durante o inventário)
[ Recontar divergências ]  [ Revisar ]
```

### Revisão

```
Nº  Item / Lote              Saldo ref.  Movimentos após ref.  Esperado  Contagem  Recontagem  Diferença final  Ajuste proposto   Decisão / Motivo
14  Colágeno LT-…000020     10,000      −2,000 (OP-2026-0031)  8,000     7,000     7,000       −1,000           Saída 1,000 kg    [Ajustar ▾] [avaria na embalagem]
22  Vitamina D LT-…000031   5,000       0                      5,000     4,000     —           −1,000           Saída 1,000 kg    [Não ajustar ▾] [lote possivelmente trocado]
31  Magnésio LT-…000044     20,000      +5,000 retroativo ⚠    25,000    20,000    —           −5,000           Saída 5,000 kg    ⚠ Recontar ou confirmar movimentos
```

Cada linha expande para o histórico: registros com autor, hora e origem; movimentos após a referência e após a
contagem; decisão.

### Encerramento

```
Encerrar INV-000014
Serão gerados 6 ajustes:
  Entradas  2 · Saídas 4
  Itens 5 · Lotes 6
  Por unidade:  kg  +0,300 / −6,500     un  −12
3 posições decididas "Não ajustar" · 82 conferem · 0 pendências
⚠ 1 posição recusada: MP-000102 LT-…000077 — o ajuste deixaria o saldo abaixo do reservado (OP-2026-0040)

[ Voltar à revisão ]                 [ Confirmar encerramento ]
```

Totais nunca somam unidades diferentes.

### Histórico

Sessão encerrada ou cancelada: somente leitura. Cabeçalho com escopo (filtros), modo, criador, quem concluiu a
primeira contagem, quem encerrou/cancelou e quando. Abas: Posições (com linha do tempo por posição: referência,
registros, movimentos concorrentes, decisão, ajuste com link para Movimentações), Ajustes gerados, Ocorrências,
Importações CSV. Ações: FO-01 de resultado e CSV de resultado.

## CSV

### Padrão existente

`apps/api/src/lib/csv.ts` e §32: UTF-8 com BOM, `;`, CRLF, cabeçalho em português, decimal pela string do `Decimal`
com vírgula, código como texto, neutralização de fórmula, nome de arquivo legível. Reusar integralmente na exportação.

### Exportação da sessão

Colunas: `inventario;posicao;codigo_item;item;lote;proprietario;local;unidade;contagem`

- Contagem cega: **nunca** saldo, esperado ou diferença.
- Contagem com saldo: + `saldo_referencia` antes de `contagem`.
- Em revisão: exporta só as posições com recontagem pedida, com `contagem` vazia (rodada seguinte).
- Encerrado: CSV de resultado com referência, esperado, contagens, diferença final, decisão e ajuste.
- `posicao` é o Nº da sessão; sem UUID. Nome: `veridi_inventario_INV-000014_2026-09-15.csv`.

### Importação (controlada)

Fluxo: upload → parse → validar → preview (válidas, avisos, erros por linha) → confirmar → aplicar. **Importar só
cria registros de contagem; nunca ajusta estoque.** A confirmação reenvia o arquivo com o hash do preview; o servidor
revalida contra o estado atual e aplica as linhas válidas numa transação. Cada registro importado leva origem `CSV`,
o lote de importação (arquivo, hash SHA-256, contagens) e o usuário que importou como autor.

| Situação | Nível | Efeito |
|---|---|---|
| Código `inventario` diferente da sessão (outra sessão, inventário antigo) | ERRO global | Arquivo inteiro recusado |
| Sessão encerrada ou cancelada | ERRO global | Recusado |
| Cabeçalho diferente do exportado | ERRO global | Recusado, com as colunas esperadas |
| Mesmo arquivo (hash) já aplicado nesta rodada | AVISO global | "Arquivo já importado às 14:03 por Ana"; linhas iguais ignoradas |
| `posicao` inexistente na sessão | ERRO linha | Fora |
| `codigo_item`/`lote` não batem com o retrato da posição (posição incorreta, item/lote incompatíveis) | ERRO linha | Fora |
| Item ou lote inexistente | ERRO linha | Fora (nunca cria) |
| `unidade` diferente do retrato | ERRO linha | Fora |
| `posicao` duplicada no arquivo | ERRO nas duas linhas | Ambas fora |
| Quantidade negativa | ERRO linha | Fora |
| Decimal inválido, separador de milhar, mais de 12 casas | ERRO linha | Fora, com o formato aceito |
| Fração em unidade COUNT | ERRO linha (se P2 aprovar) | Fora |
| Posição retirada | ERRO linha | Fora |
| Em revisão: posição sem recontagem pedida | ERRO linha | Fora |
| Linha fora do escopo (item/lote que não é posição) | ERRO linha | Fora; adicionar é ação na tela, nunca pelo arquivo |
| Contagem vazia | AVISO linha | Ignorada ("não informado", nunca zero) |
| Linha totalmente vazia | — | Ignorada em silêncio |
| Mesmo valor já registrado na rodada | AVISO linha | Ignorada |
| Valor diferente de um registro já feito na rodada | AVISO linha | Substitui só com confirmação explícita ("substitui 8 de Ana por 9") |
| CSV parcialmente válido | — | Preview mostra as duas partes; confirmar aplica **só as válidas**, com o número na frase ("Aplicar 112 linhas; 8 com erro ficam de fora") |

### Controlado × simples

| | A — Exportar e reimportar da sessão | B — `codigo_item;lote;contagem` | C — Ambos |
|---|---|---|---|
| Identidade | Nº da posição + código da sessão | Casamento por código de item e "lote" | — |
| Ambiguidade | Nenhuma | Real: a Veridi tem **três** identidades de lote (interno `LT-`, do fornecedor, comercial); qual o operador digitou? | — |
| Arquivo de outra sessão | Detectado | Indetectável | — |
| Uso | Round trip da FO-01 / planilha exportada | Planilha feita fora | — |

**Recomendação (D6): A na primeira entrega; B como evolução**, com regra explícita de qual lote casa.

## FO-01

**Hoje (EXISTE HOJE):** PDF do R-01 com todo o catálogo, modo cego omite o saldo, sem vínculo a documento.

**Proposta:**

- **FO-01 da sessão** (a partir da tela do inventário): cabeçalho `INV-000014`, descrição, modo ("Contagem cega —
  saldo do sistema omitido"), início, gerado por/em, e campos de papel "Contado por ____ Data ____ Hora de início ____
  Hora de fim ____". Colunas: Nº, Código, Item, Lote, Proprietário, Local, Validade, Unidade, **Contagem**
  (linha de escrita), Observação. Contagem com saldo: + "Saldo de referência" (rotulado assim, com a data).
  **Cega: sem saldo e sem coluna Diferença.** Ordem: Nº (percurso por local).
- Recortes: todas, só pendentes, só recontagem (em revisão; sempre cega em modo cego).
- A hora anotada no papel não vira dado (continua valendo a regra das folhas operacionais), mas orienta o revisor
  quando a posição tem movimentação.
- **FO-01 genérica** (ação "Folha de contagem" da home) continua existindo para a Contagem rápida; recomendação de
  refinamento: padrão "somente com saldo" e sem coluna Diferença na cega (F3.6).

## Recontagem

Regras em "Regras propostas → Recontagem". Fluxo:

1. Na revisão, "Recontar divergências" (todas) ou seleção → posições em "Recontagem pedida" (autor, instante).
2. Recontagem na grade filtrada, FO-01 de recontagem ou CSV de recontagem; cega em modo cego.
3. Registro da rodada n congela o próprio esperado.
4. Revelação da recontagem ao revisor; nova rodada se precisar; decisão.

## Auditoria e permissões

### Papéis existentes

`ADMIN, PRODUCTION, QUALITY, PURCHASING, COMMERCIAL, VIEWER` (`schema.prisma:106-113`). Escrita de estoque:
`ADMIN, PRODUCTION, QUALITY` (`inventory.routes.ts:89`). Decisões de lote: `QUALITY, ADMIN`. Leitura aberta a toda
sessão autenticada (padrão do produto). [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md)
trata o estoque como fronteira e precedente (seções I8/P5).

### Matriz recomendada (D4)

| Ação | ADMIN | PRODUCTION | QUALITY | PURCHASING | COMMERCIAL | VIEWER |
|---|---|---|---|---|---|---|
| Consultar inventários e histórico | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Criar/iniciar inventário | ✓ | ✓ | ✓ | — | — | — |
| Contar, recontar, importar CSV | ✓ | ✓ | ✓ | — | — | — |
| Adicionar/retirar posição, ocorrência | ✓ | ✓ | ✓ | — | — | — |
| Concluir primeira contagem | ✓ | ✓ | ✓ | — | — | — |
| Pedir recontagem, decidir (revisar) | ✓ | ✓ | ✓ | — | — | — |
| Encerrar e gerar ajustes (aprovar) | ✓ | ✓ | ✓ | — | — | — |
| Cancelar | ✓ | ✓ | ✓ | — | — | — |
| Contagem rápida | ✓ | ✓ | ✓ | — | — | — |

Justificativa: `PRODUCTION` já ajusta estoque diretamente pelo "Ajustar estoque"; restringir o encerramento a
`ADMIN`/`QUALITY` sem mexer no ajuste manual criaria um desvio óbvio (fechar sem inventário). Nenhum papel novo.
Segregação contar × aprovar é **registrada e sinalizada** ("encerrado pela mesma pessoa que contou 80% das
posições"), não imposta; exigir aprovador diferente é evolução configurável.

Gate no servidor antes do corpo (`requireRole`), `ForbiddenError` mapeado para 403, ação escondida na tela para quem
a API recusa (lição de I8/P5). Autoria sempre da sessão, com FK de usuário + nome retratado (§41).

### Trilha

Quem criou/iniciou, contou (por registro), recontou, adicionou/retirou (com motivo), importou (arquivo e hash), pediu
recontagem, decidiu (com motivo), encerrou, cancelou (com motivo) — cada um com instante. Movimento de ajuste com FK à
posição e `createdBy`. Nada é apagado.

### Imutabilidade

Registro de contagem: imutável sempre (correção = registro novo que substitui, mantendo o anterior). Retrato e
referência: imutáveis desde o início. Decisão: substituível até o encerramento (fica a última, com histórico);
imutável depois. Sessão `COMPLETED`/`CANCELLED`: somente leitura.

### Cancelamento

| Em | Permitido? | Registros ficam? | Algum movimento existe? | Reabre? | Apaga algo? |
|---|---|---|---|---|---|
| (preview, sem sessão) | — descartar tela | — | Não | — | Não |
| `IN_PROGRESS` | Sim, com motivo | Sim | Não | Não | Não; libera as posições |
| `IN_REVIEW` (com recontagem em curso) | Sim, com motivo | Sim, inclusive decisões | Não | Não | Não; libera as posições |
| `COMPLETED` | **Não** | — | Sim, os ajustes | Não | Não; correção por novo inventário ou ajuste manual |

### Multiusuário

- **A — dois operadores em posições diferentes:** sem conflito; registros por posição; a grade recarrega ao ganhar
  foco e mostra o progresso dos outros.
- **B — dois operadores na mesma posição:** comparação das opções:

| Opção | Perde contagem? | Operação | Veredito |
|---|---|---|---|
| Último write vence | Sim, em silêncio | Simples | Rejeitado |
| Lock pessimista da linha na tela | Não | Trava fantasma quando o navegador fecha | Rejeitado |
| Atribuição de posição a operador | Não | Exige planejamento prévio | Evolução |
| Aviso "outra pessoa editando" | Não impede | Ruído | Complemento futuro |
| **Otimista por "último registro visto"** | **Não** | Conflito raro, resolvido na hora | **Recomendado (D5)** |

Otimista: o registro envia o id do último registro que a tela conhecia para a posição e rodada. Mudou → 409 com o
registro atual ("Bruno registrou 8 às 14:12"). Mesmo valor → sem conflito (idempotente). Valor diferente → a tela
oferece "Substituir pela minha contagem" (novo registro que substitui, com os dois no histórico) ou "Manter a de
Bruno"; o revisor vê as duas.

### Interrupção e recuperação

| Evento | Resultado recomendado |
|---|---|
| Navegador fecha | Registros confirmados no servidor; não confirmados na fila local, oferecidos ao reabrir |
| PC reinicia | Idem (fila local no navegador daquele PC); em outro PC, retoma do servidor |
| Internet cai | Linha "Não enviado"; fila; reenvio automático ao voltar e botão "Tentar de novo" |
| Sessão de login expira (12 h) | 401 → fila preservada → login → reenvio idempotente |
| Usuário sai no meio | Outro usuário abre a sessão e continua; nada é "dono" da sessão |
| API falha depois de gravar | Reenvio com o mesmo `clientRequestId` devolve o registro existente; sem duplicata |
| Inventário aberto por dias | Permitido; aviso de idade; mais marcas de movimentação |

### Escala

| Posições | Grade | Paginação/virtualização | Busca/filtros | CSV | Autosave | Payload |
|---|---|---|---|---|---|---|
| 5 | Trivial | Não | Opcional | Desnecessário | Por linha | Mínimo |
| 50 | Boa | Não | Útil | Opcional | Por linha | ~15 KB |
| 300 | Boa com chips e "próxima pendente" | Página de 100 linhas | Essencial | Útil | Por linha | ~100 KB |
| 1.000+ | Boa com percurso por local | Página de 100 linhas (sem biblioteca de virtualização — `CLAUDE.md` veda biblioteca de UI) | Essencial | Essencial | Por linha | ~300 KB carregado uma vez |

Limite recomendado: **3.000 posições por sessão** (P1). Inventário geral de ~2.700 itens ativos com lotes passa disso
e deve ser dividido por tipo ou local — que é também como a operação física se organiza.

## Cenários adversariais

"Hoje" = recurso atual. "Proposta" = primeira entrega recomendada. Severidade = do risco se não resolvido.

| # | Cenário | Hoje | Proposta | Severidade | Observação |
|---|---|---|---|---|---|
| S1 | 300 posições, retoma amanhã | NO | YES | HIGH | Sessão persistida; progresso; registros no servidor |
| S2 | Movimento durante a contagem | PARTIAL | YES | BLOCKER | Hoje compara no confirmar (serve para uma posição). Proposta: esperado congelado no registro; risco residual R1 sinalizado |
| S3 | Dois operadores, posições diferentes | NO | YES | MEDIUM | Registros independentes |
| S4 | Dois operadores, mesma posição | PARTIAL | YES | HIGH | Hoje a trava serializa e o segundo compara com o saldo já ajustado. Proposta: 409 com escolha explícita |
| S5 | CSV duplicado | NO | YES | MEDIUM | Hash do arquivo; mesmo valor ignorado |
| S6 | CSV de inventário antigo | NO | YES | HIGH | Código `INV-` diferente → recusa global |
| S7 | Lote físico não existe no ERP | NO | PARTIAL | HIGH | Ocorrência registrada, sem entrada de estoque; regularização é pendência PO (G9) |
| S8 | Lote do ERP não encontrado fisicamente | YES | YES | HIGH | Contagem `0` → ajuste de saída no encerramento; recusado se abaixo do reservado |
| S9 | Lote zerado fisicamente | YES | YES | MEDIUM | Idem S8; lote segue no histórico com saldo zero |
| S10 | Diferença extrema | PARTIAL | PARTIAL | MEDIUM | Sem tolerância; recontagem sugerida; encerramento lista as maiores diferenças. Sem regra automática de "extremo" |
| S11 | Quantidade decimal | YES | YES | LOW | pt-BR, 12 casas, sem milhar, servidor com autoridade |
| S12 | Item unitário | NO | YES | LOW | Recusar fração em unidade COUNT (P2) |
| S13 | Material de cliente | PARTIAL | YES | HIGH | Hoje o lote aparece sem dono na escolha. Proposta: proprietário na grade, FO-01, CSV e filtros; posição = lote de um dono |
| S14 | Lote bloqueado | YES | YES | LOW | Contável e ajustável; status inalterado |
| S15 | Lote vencido | YES | YES | LOW | Vencido calculado; contável e ajustável |
| S16 | Recebimento após o início | NO | YES | HIGH | Lote novo fora do escopo com aviso; item sem lote reconciliado; retroativo destacado |
| S17 | Consumo após o início | NO | YES | BLOCKER | Cenário obrigatório: diferença 0 |
| S18 | 100% sem divergência | PARTIAL | YES | LOW | Hoje nada fica gravado. Proposta: encerra com 0 ajustes e atualiza "última contagem" |
| S19 | Recontagem elimina divergência | NO | YES | MEDIUM | Vale a última rodada; nenhum ajuste |
| S20 | Recontagem mantém divergência | NO | YES | MEDIUM | Ajuste pela diferença da última rodada, com o esperado dela |
| S21 | Sessão expira durante autosave | NO | YES | HIGH | Fila local + reenvio idempotente |
| S22 | CSV metade válido | NO | YES | MEDIUM | Aplica só as válidas, com confirmação numerada |
| S23 | Posição adicionada manualmente | NO | YES | MEDIUM | Motivo, autor, referência na adição, exclusividade |
| S24 | Usuário sem permissão aprova | PARTIAL | YES | HIGH | Hoje 403 na API, botão visível (I8). Proposta: gate + ação escondida |
| S25 | Ajuste confirmado e tentativa de reabrir | YES | YES | HIGH | Hoje o ajuste é movimento imutável. Proposta: `COMPLETED` não reabre; FK 1:1 impede reaplicar |

Cenários extras derivados deste domínio:

| # | Cenário | Proposta | Severidade | Observação |
|---|---|---|---|---|
| X1 | Duas sessões abertas com o mesmo lote | YES | BLOCKER | Exclusividade de posição |
| X2 | Contagem rápida em lote de inventário aberto | YES | HIGH | Recusada com o código da sessão |
| X3 | Recontagem comparada com o esperado da 1ª | YES | BLOCKER | Esperado por registro |
| X4 | Encerramento com consumo depois da contagem que deixa o saldo negativo | YES | HIGH | Recusa com a lista de posições |
| X5 | Unidade do item alterada durante a sessão (item sem uso operacional) | YES | MEDIUM | Retrato comparado no encerramento |
| X6 | Cegueira via aba de rede | YES | HIGH | API não devolve |
| X7 | "Zerar pendentes" em lote | YES (não existe) | BLOCKER | Ação não oferecida |
| X8 | Duplo clique em "Encerrar" | YES | HIGH | Trava da sessão + status + FK única |

## Dia na vida

| Hora | Evento | O que acontece | Risco / gap / gambiarra / bloqueio |
|---|---|---|---|
| 08:00 | Ana (PRODUCTION) cria o inventário: MP, com saldo, cega → 230 posições; inicia; imprime a FO-01 cega; dois operadores | Referência congelada 08:02 | Nenhum. Risco: 12 posições com reserva ativa → aviso "separações podem estar em curso" |
| 08:30 | Caminhão: recebimento de 3 lotes de MP | Lotes novos, fora do escopo; a grade avisa "3 lotes do escopo recebidos após o início" | Gambiarra evitada: contar o pallet novo dentro de um lote antigo — o código `LT-` da etiqueta difere. Se o pallet ficou na área contada: "Adicionar posição" |
| 09:15 | Picking da OP consome LT-…118 | Ledger −2,5 kg | Se a posição foi contada às 09:40: esperado já inclui, diferença certa. Se foi contada no papel às 09:00 e digitada às 11:00: diferença falsa +2,5 **marcada** "com movimentação" → recontagem (R1) |
| 10:00 | Operador acha lote fora da lista | Existe: "Adicionar posição" com motivo. Não existe: ocorrência | Gap: material sem lote no ERP não entra em estoque por aqui (G9) |
| 11:00 | CSV parcial: 120 linhas | Preview: 112 válidas, 8 erros (lote trocado) → aplica 112 | As 8 são corrigidas na grade |
| 12:00 | Almoço | Nada a salvar: tudo confirmado por linha | — |
| 14:00 | Bruno continua de outro PC | Abre a sessão, chip "Pendentes", continua | Conflito na mesma posição → 409 com escolha |
| 15:00 | Primeira contagem concluída | 212 conferem, 18 divergentes (5 com movimentação); recontagem pedida das 18, cega | Mesma pessoa revisando e recontando: sinalizado |
| 16:00 | Recontagem e revisão | 11 zeradas pela recontagem; 7 mantidas: 6 "Ajustar", 1 "Não ajustar" + ocorrência | — |
| 16:30 | Uma OP é liberada e reserva MP-000102 LT-…077, que a revisão decidiu ajustar para baixo | Com o ajuste, o saldo ficaria abaixo do reservado | Encerramento recusará essa posição, com a OP na mensagem |
| 17:00 | Encerramento | "6 ajustes: 2 entradas, 4 saídas; 5 itens; 6 lotes"; 1 posição recusada por reserva → decidida "Não ajustar" até revisar a OP → encerra com 5 ajustes | Bloqueio correto, com caminho claro |

## Gap Matrix

| Tema | Coberto hoje? | Gap | Severidade | Primeira entrega / Futuro | Recomendação |
|---|---|---|---|---|---|
| **COBERTO** | | | | | |
| Nunca sobrescrever saldo | Sim (§16) | — | — | Mantido | Ajuste pela diferença congelada |
| Ledger imutável e auditável | Sim (§15) | — | — | Mantido | FK 1:1 posição → ajuste |
| Negativo e reservado protegidos | Sim (§14, §16) | — | — | Mantido | Guardas no encerramento |
| Propriedade do lote | Sim (§14) | Tela não mostra | MEDIUM | Primeira entrega | Coluna e filtro |
| Validade e qualidade calculadas | Sim (`inventory-ledger.ts`) | — | — | Mantido | Filtros sobre a mesma função |
| CSV exportação brasileira | Sim (§32) | — | — | Mantido | Reusar `lib/csv.ts` |
| Busca de item e lote no servidor | Sim (§48) | — | — | Mantido | Reusar |
| **FALTANDO** | | | | | |
| Sessão, estados, escopo, preview | Não | G1 | HIGH | Primeira entrega | `StockCount` + montador |
| Registro de contagem com rastro | Não | G2 | HIGH | Primeira entrega | `StockCountEntry` append-only |
| Grade, Enter, autosave, fila, idempotência | Não | G8 | HIGH | Primeira entrega | Opção A |
| Contagem cega na tela | Não | G3 | MEDIUM | Primeira entrega | Cegueira no servidor |
| Reconciliação de movimentos | Não | Seção de concorrência | BLOCKER | Primeira entrega | Opção F |
| Recontagem e revisão | Não | — | HIGH | Primeira entrega | Por posição, última rodada vale |
| Exclusividade de posição entre sessões | Não | R2 | BLOCKER | Primeira entrega | Verificação sob trava |
| FO-01 vinculada | Não | G6 | MEDIUM | Primeira entrega | FO-01 da sessão |
| CSV importação controlada | Não | G7 | MEDIUM | Primeira entrega | Preview + erros por linha |
| Ocorrência de lote/item sem cadastro | Não | S7 | HIGH | Primeira entrega | Registro sem estoque |
| Histórico somente leitura | Não | — | HIGH | Primeira entrega | Tela da sessão |
| Última contagem / divergência anterior | Não | G2 | MEDIUM | Primeira entrega (dado) | Derivado das sessões |
| Unidade COUNT inteira | Não | G10 | LOW | Primeira entrega (P2) | Recusar fração |
| **RISCO OPERACIONAL** | | | | | |
| Defasagem físico × lançamento | Não | R1 | HIGH residual | Primeira entrega (sinalização) | Marca + recontagem |
| Lançamento retroativo | Não | F3.8 | HIGH | Primeira entrega | Destaque na revisão |
| Material sem lote no ERP | Não | G9 | HIGH | Futuro (decisão PO) | Capability de regularização |
| Encerramento grande | — | R10 | MEDIUM | Primeira entrega | Limite + travas ordenadas |
| Inventário de dias | — | R11 | MEDIUM | Primeira entrega (aviso) | Dividir escopo |
| **NÃO COLOCAR AGORA** | | | | | |
| Bloqueio de movimentações | — | Opção A | — | Não | Inviável para a operação |
| Tolerância percentual | — | — | — | Não | §49 |
| Estorno/reabertura de encerrado | — | — | — | Não | Novo inventário |
| Valor financeiro da divergência | — | Custo incompleto; material de cliente sem custo | — | Não | Só com qualidade de custo |
| Localização estruturada, GTIN, coletor | — | G12 | LOW | Futuro | Roadmap WMS |

## Primeira entrega recomendada

**PRIMEIRA ENTREGA DO NOVO INVENTÁRIO FÍSICO.** Uma capability, fatiada para implementar e validar em ordem. Nada
dela é opcional para o objetivo de "processo operacional real"; o que é opcional ficou em "Evoluções posteriores".

**Fatia 1 — domínio e API (sem tela nova).**

- `StockCount`, `StockCountPosition`, `StockCountEntry`, `StockCountImportBatch`, `StockCountFinding`;
  `InventoryMovement.stockCountPositionId` único; prefixo `INV` no shared.
- Preview de escopo (filtros suportáveis hoje + última contagem/divergência pelo dado novo e pelo legado) e início
  com congelamento e referência; exclusividade de posição.
- Registro de contagem com esperado congelado, idempotência e conflito otimista; cegueira no servidor.
- Adicionar/retirar posição, ocorrência, concluir primeira contagem, pedir recontagem, decidir, encerrar com as
  guardas, cancelar.
- Contagem rápida gravando `kind = QUICK`, recusando posição em sessão aberta e conferindo o saldo mostrado.
- Permissões (matriz D4), 403 mapeado.

**Fatia 2 — telas.** Home, Novo inventário com preview, grade de contagem (Enter, autosave, fila local), revisão com a
conta da reconciliação, encerramento com resumo, histórico somente leitura, Contagem rápida renomeada com as
correções F3.2/F3.4/F3.5.

**Fatia 3 — papel e arquivo.** FO-01 da sessão (cega, pendentes, recontagem, resultado), CSV de exportação e
importação controlada com preview.

**Justificativa do faseamento:** a fatia 1 carrega todas as invariantes de estoque e é testável por API sem tela;
a fatia 2 não muda regra; a fatia 3 depende do contrato das duas primeiras. Entregar só a fatia 1 em PROD não tem
valor operacional; publicar depois da fatia 3.

## Evoluções posteriores

- Inventário cíclico com sugestões (nunca contado, dias desde a última contagem, movimentação recente, alto giro,
  divergência recorrente, vencimento próximo) e agendamento. **A modelagem já permite:** última contagem e
  divergência por posição saem das sessões encerradas; movimentação e giro saem do ledger; validade do lote; uma
  sugestão é um conjunto de filtros com ordenação, que o montador já recebe.
- Motivo de inclusão por posição no preview.
- Tolerância por unidade ou por categoria.
- CSV modelo simples `codigo_item;lote;contagem`.
- Atribuição de posições a operadores; divisão automática de posições.
- Exigir aprovador diferente de quem contou (configurável).
- `DRAFT` para preparar inventário na véspera.
- Relatórios: histórico de contagens por item/lote (aba no detalhe), divergências recorrentes, dias desde a última
  contagem, acuracidade.
- Indicadores e painéis avançados; scoring de posições.
- Duplicar escopo de uma sessão anterior.
- Scanner dedicado / coletor industrial; GS1/GTIN.
- Localização estruturada (endereçamento).
- Pausa voluntária de movimentação por posição.
- Regularização de material encontrado sem lote no ERP (depende de decisão PO).

## Não colocar agora

- Bloqueio global de movimentações durante inventário.
- Retrato único no início sem reconciliação; comparação com o saldo do encerramento.
- Ajuste com data retroativa à contagem.
- Estorno ou reabertura de inventário encerrado.
- Criação automática de lote ou item a partir da contagem ou do CSV.
- Adicionar posição pelo CSV.
- Autosave com debounce; último-write-vence; lock pessimista de linha.
- Ação em lote "zerar pendentes".
- Tolerância percentual automática.
- Valor financeiro da divergência e acuracidade financeira.
- Papel novo de aprovador.
- Média ou escolha entre rodadas de contagem.
- Biblioteca de virtualização de tabela.

## Decisões PO

Prioridade na ordem pedida. Cada uma com recomendação.

**DECISÃO 1 — Saldo de referência e concorrência** (bloqueia)
Recomendação: opção F — referência por posição no início, saldo esperado congelado em cada registro, ajuste = diferença
congelada do registro que vale aplicada como delta no encerramento, movimentação e lançamento retroativo sinalizados,
nenhuma movimentação bloqueada, uma posição em no máximo uma sessão aberta.
Alternativa: A — bloquear Recebimento, Produção, Expedição, Amostra e Ajuste das posições em inventário.
Impacto: F mantém a fábrica rodando e exige revisão das posições marcadas; A dá números mais simples ao custo de parar
a operação e empurrar lançamentos para depois, com data retroativa.

**DECISÃO 2 — Recontagem** (bloqueia)
Recomendação: não obrigatória; pedida pelo revisor por posição ou "todas as divergências"; cega em modo cego; vale a
última rodada; posição divergente com movimentação durante o inventário só fecha com recontagem ou confirmação
explícita; mesma pessoa permitida e registrada.
Alternativa: recontagem obrigatória para toda divergência, por segundo operador.
Impacto: a recomendação cabe numa equipe pequena; a alternativa dobra o trabalho e trava o encerramento sem segundo
operador.

**DECISÃO 3 — Tolerância** (bloqueia)
Recomendação: sem tolerância (§49); "Não ajustar" com motivo, em lote, para ruído.
Alternativa: tolerância absoluta por unidade.
Impacto: sem tolerância nenhuma diferença some; a alternativa exige cadastro e esconde diferença pequena.

**DECISÃO 4 — Contar × aprovar** (bloqueia)
Recomendação: mesmos papéis de escrita de estoque (ADMIN, PRODUCTION, QUALITY) para contar, revisar e encerrar;
mesma pessoa permitida, registrada e sinalizada; nenhum papel novo.
Alternativa: encerrar só ADMIN/QUALITY.
Impacto: a alternativa só tem efeito se o ajuste manual também sair de PRODUCTION — o que é decisão do discovery de
permissões.

**DECISÃO 5 — Multiusuário**
Recomendação: sem reserva de posição; conflito otimista (409) com escolha explícita; nunca último-write silencioso.
Alternativa: atribuir posições por operador antes de iniciar.
Impacto: a recomendação não exige planejamento; a alternativa evita conflito e cria trabalho de preparação.

**DECISÃO 6 — CSV**
Recomendação: primeira entrega só CSV controlado (exportar e reimportar da sessão); aplicar só as linhas válidas com
confirmação numerada; modelo simples depois.
Alternativa: incluir o modelo simples já; ou importação tudo-ou-nada.
Impacto: o simples reabre a ambiguidade das três identidades de lote; tudo-ou-nada força redigitar o arquivo por uma
linha errada.

**DECISÃO 7 — Posição adicionada e material sem cadastro**
Recomendação: adicionar só item/lote existente, com motivo; lote ou item sem cadastro vira ocorrência, sem estoque;
regularização é capability própria.
Alternativa: criar "lote de regularização" dentro do inventário.
Impacto: a alternativa decide custo, dono, validade e qualidade de material sem origem dentro de uma contagem.

**DECISÃO 8 — Cancelamento e reabertura**
Recomendação: cancelar em contagem ou revisão com motivo, sem apagar nada; encerrado nunca reabre nem estorna;
correção por novo inventário ou ajuste manual.
Alternativa: estorno automático do encerrado.
Impacto: o estorno desfaz ajustes sobre um ledger que já andou e cria uma segunda verdade.

## Pendências PO

Não estruturais; cada uma com recomendação, decidíveis na implementação se o PO não se opuser.

- **P1** — limite de posições por sessão. Recomendado: 3.000.
- **P2** — fração em unidade de dimensão COUNT. Recomendado: recusar na contagem e no CSV.
- **P3** — nome da função preservada: "Contagem rápida" (recomendado) ou "Conferência pontual".
- **P4** — Contagem rápida passa a gravar documento `INV-` (inclusive quando confere). Recomendado: sim.
- **P5** — "Com ou sem saldo" inclui todos os lotes zerados históricos. Recomendado: sim, com aviso de volume no
  preview.
- **P6** — FO-01 genérica: padrão "somente com saldo" e sem coluna Diferença na cega. Recomendado: sim.
- **P7** — capability futura de regularização de material encontrado sem lote no ERP (G9). Recomendado: abrir
  discovery próprio quando a operação pedir.

## Addendum PO — decisões fechadas

Fonte: handoff **INVENTORY-PHYSICAL-COUNT-01** (Fatia 1), 2026-09-15. Registrado antes da implementação.
**`READY_TO_IMPLEMENT = YES`.**

| # | Decisão do PO | Em relação à recomendação |
|---|---|---|
| D1 | Concorrência = opção F | Igual |
| D2 | Recontagem opcional | Igual |
| D3 | Sem tolerância na primeira entrega | Igual |
| D4 | ADMIN, PRODUCTION e QUALITY podem contar e aprovar; a mesma pessoa pode fazer os dois, e isso fica auditável | Igual |
| D5 | Multiusuário otimista, com conflito explícito; nunca último-write silencioso | Igual |
| D6 | CSV controlado, na Fatia 3 | Igual |
| D7 | Item ou lote inexistente vira ocorrência; nunca cria cadastro em silêncio | Igual |
| D8 | Cancelado ou encerrado não reabre nem estorna | Igual |
| P1 | Máximo inicial de 3.000 posições por sessão | Igual |
| P2 | Unidade de dimensão COUNT não aceita quantidade fracionária | Igual |
| P3 | Nome: "Contagem rápida" | Igual |
| P4 | Contagem rápida gera `INV-` com `kind = QUICK` | Igual |
| P5 | "Com ou sem saldo" inclui lotes elegíveis com saldo zero; "Somente com saldo" exclui saldo zero | Igual |
| P6 | FO-01 genérica fica como está; FO-01 de sessão entra na Fatia 3 | **Diverge**: o discovery recomendava "somente com saldo" e sem coluna Diferença na cega |
| P7 | Material físico sem lote cadastrado vira ocorrência; regularização é futuro | Igual |

Precisões do handoff sobre a Fatia 1:

- Escopo: domínio, schema, migration, service/API e compatibilidade da Contagem rápida. Sem home, grade, wizard, CSV,
  FO-01 de sessão, scanner, inventário cíclico, painel ou relatório.
- `StockCountImportBatch` só nasce na Fatia 3, com o CSV — nada de schema prematuro.
- Sem `DRAFT` e sem status `RECOUNT`: recontagem é da posição e do registro.
- A exclusividade de posição entre sessões abertas resiste a concorrência real — consultar e depois inserir não basta.
  A Contagem rápida respeita.
- Ajuste = diferença congelada no registro que vale, aplicada como delta no encerramento. Exemplos obrigatórios em
  teste: saldo 10, consumo −2, contagem 8 → zero ajuste; esperado 8, contagem 7, recebimento +5 depois da contagem →
  o encerramento aplica −1 e o saldo fica 12.
- Contagem cega: o backend é a autoridade; na primeira rodada a API não devolve saldo esperado nem diferença.
- Contrato HTTP da tela atual preservado; se precisar mudar, compatível até a Fatia 2.

## Modelo de dados proposto

**Conceitual. Sem migration.** Nomes seguem as convenções do schema (`@@map` em snake_case, `Decimal(24,12)` para
quantidade física, autoria com FK + nome retratado).

### `StockCount` — sessão / documento

| Campo | Tipo | Função |
|---|---|---|
| `id` | uuid | — |
| `code` | String único | `INV-000001` |
| `kind` | `StockCountKind` = `SESSION` \| `QUICK` | Inventário ou Contagem rápida |
| `mode` | `StockCountMode` = `BLIND` \| `ASSISTED` | Cega ou com saldo |
| `status` | `StockCountStatus` = `IN_PROGRESS` \| `IN_REVIEW` \| `COMPLETED` \| `CANCELLED` | — |
| `description` | String? | Rótulo humano |
| `scopeFilters` | Json | Retrato dos filtros e do número de retiradas/adições do preview |
| `referenceAt` | DateTime | Início (instante de referência) |
| `createdAt`, `createdByUserId`, `createdByName` | | Criou/iniciou |
| `firstRoundClosedAt`, `…ByUserId`, `…ByName` | ? | Concluiu a primeira contagem |
| `completedAt`, `completedByUserId`, `completedByName` | ? | Encerrou (aprovou ajustes) |
| `cancelledAt`, `cancelledByUserId`, `cancelledByName`, `cancelReason` | ? | Cancelou |
| `updatedAt` | DateTime | Técnico |

Índices: `status`, `createdAt`, `kind`.

### `StockCountPosition` — posição

| Campo | Tipo | Função |
|---|---|---|
| `id` | uuid | — |
| `stockCountId` | FK | — |
| `sequence` | Int | Nº da posição (papel, CSV); `@@unique([stockCountId, sequence])` |
| `positionKey` | String | `itemId` ou `itemId:lotId`; `@@unique([stockCountId, positionKey])` |
| `itemId` | FK Item | — |
| `lotId` | FK Lot? | Null para item sem lote |
| `itemCode`, `itemName`, `itemType`, `unitCode` | retrato | Histórico legível; unidade conferida no encerramento |
| `lotCode`, `ownerType`, `ownerCustomerId`, `ownerCustomerName`, `lotStatusAtReference`, `expiryDateAtReference`, `locationAtReference` | retrato? | Escopo como era |
| `origin` | `SCOPE` \| `ADDED` | — |
| `addedAt`, `addedByUserId`, `addedByName`, `addReason` | ? | Adição auditada |
| `referenceQuantity` | Decimal(24,12) | `R` |
| `referenceAt` | DateTime | `t_ref` da posição |
| `recountRequestedRound`, `recountRequestedAt`, `…ByUserId`, `…ByName` | ? | Recontagem pedida |
| `removedAt`, `removedByUserId`, `removedByName`, `removeReason` | ? | Retirada |
| `decision` | `ADJUST` \| `NO_ADJUSTMENT`? | Revisão |
| `decisionReason`, `decidedAt`, `decidedByUserId`, `decidedByName` | ? | — |
| `concurrentMovementConfirmed` | Boolean | Confirmação explícita da movimentação durante o inventário |
| `inventoryMovement` | relação 1:1 | Ajuste gerado |

Índices: `itemId`, `lotId`, `stockCountId`. Exclusividade entre sessões abertas: verificada no serviço sob trava das
linhas de item/lote (o status mora na sessão; índice parcial denormalizado fica para quando for preciso).

### `StockCountEntry` — registro de contagem (só acrescenta)

| Campo | Tipo | Função |
|---|---|---|
| `id` | uuid | — |
| `positionId` | FK | — |
| `round` | Int | 1 = contagem; ≥ 2 = recontagem |
| `countedQuantity` | Decimal(24,12) | `C_k` |
| `expectedQuantity` | Decimal(24,12) | `E_k`, lido do ledger na transação |
| `countedAt` | DateTime | `t_k` (servidor) |
| `countedByUserId`, `countedByName` | | Autor |
| `source` | `GRID` \| `CSV` \| `QUICK` | Origem |
| `importBatchId` | FK? | Lote de importação |
| `clientRequestId` | String único | Idempotência |
| `supersedesEntryId` | FK? único | Correção na mesma rodada |
| `note` | String? | Observação |

Índice: `[positionId, round]`.

### `StockCountImportBatch`

`id`, `stockCountId`, `round`, `fileName`, `fileSha256`, `rowsTotal`, `rowsApplied`, `rowsIgnored`, `rowsRejected`,
`importedAt`, `importedByUserId`, `importedByName`. Índice `[stockCountId, fileSha256]`.

### `StockCountFinding` — ocorrência

`id`, `stockCountId`, `kind` (`UNREGISTERED_LOT` \| `UNREGISTERED_ITEM` \| `OTHER`), `itemId?`, `identification`
(texto lido), `quantity Decimal?`, `unitCode?`, `note`, `createdAt`, `createdByUserId`, `createdByName`.

### Alteração em `InventoryMovement`

`stockCountPositionId String? @unique` com relação para `StockCountPosition` — mesmo padrão de `receiptLineId`,
`productionConsumptionId`, `productionOutputId`, `shipmentLineId`: garante no banco no máximo um ajuste por posição.
`sourceType = STOCK_COUNT` e `sourceId = position.id`. Linhas antigas ficam com `null` e são lidas como "contagem
anterior sem documento".

### Relações

`Item` 1–N posições; `Lot` 1–N posições; `User` autor de sessão/registro/decisão; `Customer` pelo retrato do dono do
lote; `InventoryMovement` 1–1 posição.

### Derivado, nunca gravado

Situação da posição, progresso, contadores, diferença, `M(t_ref, t_k]`, marca de movimentação, lista de movimentos
concorrentes, resumo do encerramento, última contagem, divergência anterior.

### Retrato e reconciliação — o que implementar sem improvisar

| Pergunta | Resposta |
|---|---|
| Qual valor congelamos? | `R` por posição; `E_k` e `C_k` por registro; retrato de cadastro da posição |
| Quando? | `R` na transação de início (uma leitura agrupada para todas as posições) ou na adição; `E_k` na transação do registro |
| O que nunca muda? | `R`, `t_ref`, retrato, todo registro, a decisão depois do encerramento, o movimento de ajuste |
| O que é recalculado? | Situação, marcas, listas de movimentos, situação atual do lote para exibição, `B_close` e reservado no encerramento |
| Quais movimentos entram? | Todos os da posição, de todos os tipos |
| Como fechamos a diferença? | Ajuste = `D_k*` como delta, `occurredAt` = encerramento, guardas de negativo e reservado |
| Como provamos depois? | Números gravados + FK do ajuste + ledger listável por posição e por `createdAt` + trilha de autoria |

### Performance

| Ponto | Custo | Índice / cuidado |
|---|---|---|
| Filtros do preview | `groupBy` do ledger por `lotId`/`itemId` com `occurredAt` e tipo | Índices atuais (`lotId`, `itemId`, `occurredAt`, `type`); composto `(lotId, occurredAt)` só se medir lento |
| Início com 1.000 posições | Uma soma agrupada + `createMany` | Transação curta |
| Registro | Uma soma por tipo da posição + insert | Índice `lotId` |
| Autocomplete | Busca existente de item e lote | — |
| CSV 1.000 linhas | Parse e validação em memória, uma leitura das posições | Limite de upload já é 10 MB |
| Encerramento | Somas agrupadas + reservas em lote + travas ordenadas só das posições com ajuste + `createMany` | Limite P1 |
| Histórico | Posições + registros da sessão | `[positionId, round]` |

Sem otimização prematura: nenhum saldo materializado, nenhuma tabela de agregado.

## Relatórios

| Relatório | Primeira entrega | Evolução |
|---|---|---|
| Histórico por sessão | Sim — tela da sessão + CSV/FO-01 de resultado | — |
| Origem `INV-` no R-03 Movimentações | Sim — o ajuste aponta a sessão | — |
| Histórico por item/lote | — | Aba "Contagens" no detalhe do item e do lote |
| Divergências recorrentes | — | Sim |
| Dias desde a última contagem | Pelo filtro do montador | Relatório próprio |
| Acuracidade | — | Sim, depois de histórico suficiente e definição de fórmula |

**Indicadores.** Operacionais úteis (primeira entrega, na home e na sessão): inventários em aberto, posições
pendentes, % concluído, divergências, recontagens pendentes, ajustes gerados por unidade. **Vanity ou inseguros
agora:** valor divergente (custo incompleto; material de cliente sem custo Veridi — `null` nunca vira `0`), acuracidade
percentual sem histórico, qualquer soma entre unidades diferentes.

## Próxima capability

**INVENTORY-PHYSICAL-COUNT-01** — Primeira entrega do novo Inventário Físico (fatias 1 → 2 → 3), depois de o PO
responder D1–D4 (e, idealmente, D5–D8 e P1–P7). Ordem sugerida: `/erp-functional-reviewer` sobre este documento com
as decisões → `/ship` fatia a fatia → `/erp-operations-reviewer` sobre o fluxo entregue, com S1–S25 e X1–X8.

## Implementação

**NÃO IMPLEMENTADO.**

READY_TO_IMPLEMENT = **NO**. Motivo: a pergunta estrutural (concorrência / saldo de referência) tem recomendação
clara e sem ambiguidade técnica, mas D1–D4 tocam quantidade de estoque e permissões e continuam sem resposta do PO.
Com D1–D4 aceitas como recomendado, a primeira entrega pode ser implementada sem ambiguidade perigosa.

**Atualização 2026-09-15:** READY_TO_IMPLEMENT = **YES** — D1–D8 e P1–P7 fechadas pelo PO ("Addendum PO — decisões
fechadas"). A implementação começa pela Fatia 1 (INVENTORY-PHYSICAL-COUNT-01).

## Histórico de decisões

- 2026-09-15 — Discovery executado sobre `c63c124`; status `EM_ANALISE`; D1–D8 e P1–P7 abertas.
- 2026-09-15 — PO fecha D1–D8 e P1–P7 no handoff INVENTORY-PHYSICAL-COUNT-01; status `EM_ANALISE` → `DECIDIDO`;
  `READY_TO_IMPLEMENT` NO → YES. P6 muda a recomendação: a FO-01 genérica fica como está (antes: "somente com saldo"
  e sem coluna Diferença na cega); a FO-01 de sessão entra na Fatia 3.

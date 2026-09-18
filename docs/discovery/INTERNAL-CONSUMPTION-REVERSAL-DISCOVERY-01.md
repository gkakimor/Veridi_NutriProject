# INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01 — estorno do Consumo Interno (CI-)

## 1. Status

`DECIDIDO` — **P1–P4 decididas pelo PO em 2026-09-18** no handoff de INTERNAL-CONSUMPTION-REVERSAL-01, todas com a
recomendação: estorno próprio (A), ADMIN + QUALITY, R-21 líquido na data do CI (R21-a) e recusa quando a posição foi
inventariada depois do CI ou está em INV- aberto. P5–P10 valem como recomendadas. Implementação na seção 16.

Discovery READ ONLY de 2026-09-18 sobre `main` `f14b18f9`, entregue só no chat (o handoff da rodada proibia mexer em doc
canônica) e persistido aqui na implementação, sobre `02755f39`. O delta `f14b18f9..02755f39` não toca nenhuma área do
estorno (Consumo Interno, estoque, inventário, relatórios, exportação, painel, `lib`, shared de estoque e as telas de
estoque, relatórios e PDF): as linhas citadas abaixo são as de `f14b18f9` e continuam valendo.

Dados na base da discovery: o CI não está em PROD (migration `20260925093035`, commit `c9ee5be7`, fora de `release/prod`
`8e824e8f`); no DEV, leitura em transação READ ONLY com ROLLBACK achou 0 CI, 0 Item de uso e consumo e 0 INV-. Não há dado
legado para migrar: o estorno pode ir para PROD junto com o CI.

## 2. Objetivo

Definir a forma segura de corrigir um Consumo Interno lançado errado (quantidade, item, lote ou lançamento indevido) sem
apagar nem editar o que já foi confirmado, preservando o ledger imutável, a rastreabilidade, o custo histórico e o R-21.

## 3. PO baseline

- §115 (INTERNAL-CONSUMPTION-01): consumo interno é saída própria (`INTERNAL_CONSUMPTION`), nunca `ADJUSTMENT_OUT`; custo
  congelado no registro; Compras registra, e "corrigir saldo continua sendo outra autoridade".
- §117 (INTERNAL-CONSUMPTION-REPORT-01): o R-21 lê só o snapshot do CI e não recalcula custo.
- §107: item inativo não recebe entrada manual.
- Regras gerais: o ledger é imutável e erro se corrige com movimento compensatório (`schema.prisma` do `InventoryMovement`,
  CLAUDE.md, PRODUCT_RULES §27 l.1937 "Inventory corrections use adjustment/reversal behavior"; l.201-203: estorno é
  "an explicit inventory operation with its own reason").

## 4. Estado atual

`POST /internal-consumptions` registra o consumo, com os perfis ADMIN, PURCHASING, PRODUCTION e QUALITY
(`INTERNAL_CONSUMPTION_WRITE_ROLES`) e 403 antes do corpo. Uma transação (`internal-consumption.service.ts:155-263`):

1. só aceita Item `INTERNAL_CONSUMABLE`; lote só quando o item controla lote, elegível (`isLotAvailableForUse`) e nunca de
   cliente;
2. `lockStockScope` trava a linha do lote ou do item com `FOR UPDATE` (`inventory.service.ts:392`);
3. confere o Disponível (On Hand − Reserved);
4. custo por `getConsumedLotCostReference` na data do consumo (REAL → 30D → 90D → último real → `NO_COST`), congelando
   `unitCost` (8 casas), `totalCost` (4 casas), `costSource` e `costDetails`;
5. código `CI-` pela sequence; grava `InternalConsumption` e o movimento `INTERNAL_CONSUMPTION` (sinal −1), 1:1 por
   `inventoryMovementId @unique`.

Datas: dia passado vira o FIM daquele dia comercial em `occurredAt`; `createdAt` é o instante real do registro.

Leitura: histórico em `/estoque/uso-e-consumo`; o extrato mostra o CI- sem link (`OrigemDoMovimento.tsx`); o R-21 agrega só
`internal_consumptions` (`internal-consumption-report.service.ts:92-111`).

**Correção hoje: nenhuma.** Existem o Inventário Físico (sessão ou Contagem rápida) e o ajuste manual (ADMIN, PRODUCTION,
QUALITY; `ADJUSTMENT_IN` recusado para item inativo, `inventory.service.ts:410`). Os dois consertam o saldo, nenhum conserta
o R-21, e os dois registram "diferença de inventário" onde houve "lançamento errado". Nenhuma rota edita ou apaga CI ou
movimento (a única escrita depois do `create` é o `inventoryMovementId`, dentro da própria criação).

## 5. Evidências

**Precedentes de estorno — nenhum estorno de movimento físico confirmado existe:**
- amostra: "Reprovar/cancelar também nunca estorna material" (`samples.service.ts:479-483`);
- Pedido com expedição confirmada: cancelamento recusado (`customer-orders.service.ts:1000-1006`);
- OP em produção não cancela (PRODUCT_RULES l.1821-1823);
- recebimento não tem estorno;
- INV- encerrado não reabre nem estorna (D8 do INVENTORY-PHYSICAL-COUNT-DISCOVERY-01).

**Padrões reutilizáveis (EXISTE HOJE):**
- P1 documento com movimento 1:1, FK no documento com `@unique` (CI, `SampleConsumption`);
- P2 tipo próprio por operação, sinal em `INVENTORY_MOVEMENT_DIRECTION` (`shared/inventory.ts:52`); os `Record<Tipo, …>`
  fazem o typecheck acusar mapa esquecido;
- P3 `lockStockScope` com `FOR UPDATE` (`inventory.service.ts:392`);
- P4 posição retida por INV- aberto: `retencoes` e `PositionHeldByOpenCountError` (`stock-count.service.ts:235, 1186`);
- P5 "o saldo que a tela mostrou": `expectedSystemQuantity` → `SystemQuantityChangedError` (`stock-count.service.ts:1191`);
- P6 correção datada no instante do ato, nunca retroativa (`stock-count.service.ts:1053`);
- P7 anular com motivo sem apagar (`ItemLabelFileVersion`: `voidedAt`, `voidReason`…), perfis QUALITY e ADMIN;
- P8 motivo `z.string().trim().min(3).max(500)`, como nos cancelamentos de Expedição, Faturamento, Pedido e OP;
- P9 custo congelado e relatório que só lê o snapshot (§115, §117);
- P10 arredondamento declarado: `fecharPrecoTecnicoPersistido` (8 casas) e `fecharTotalTecnicoPersistido` (4 casas),
  ambos ROUND_HALF_UP.

**Custo:** a hierarquia lê só `ReceiptLine` (`cost-reference.ts:119-143, 246-305`); `actualUnitCost` muda depois por
`PUT /receipt-lines/:id/acquisition-cost` (`costs.routes.ts:63`).

**Inventário:** o `E` do registro de contagem é `getOnHand` sem filtro de data (`stock-count.service.ts:700`); movimento
durante o inventário é marcado e exige recontar ou confirmar (`stock-count.service.ts:871-918`).

## 6. Findings

- F1 O CI não tem correção nenhuma; o único caminho (inventário/ajuste) acerta o saldo e deixa o R-21 errado para sempre.
- F2 Um INV- (sessão ou Contagem rápida, ambos `COMPLETED`) com registro válido contado depois de `CI.createdAt` já absorveu
  o erro com +q: a fronteira é `createdAt` (entrada no ledger), não `occurredAt` (dia passado grava o FIM daquele dia).
- F3 Recalcular custo no estorno diverge do snapshot: o custo do recebimento muda depois, recebimento retroativo muda as
  médias, e `CI.totalCost` = round4(custo SEM arredondar × qtd) ≠ round4(`unitCost` de 8 casas × qtd).
- F4 Prefixo "EC" já é Estrutura de Custo: o estorno usa "ECI".
- F5 A FK `internal_consumptions.inventoryMovementId` é `ON DELETE CASCADE` (linha 55 da migration): o estorno aponta o CI
  com RESTRICT.
- F6 R-03 (`inventory-reports.service.ts:264-392`) e o Painel (`dashboard.service.ts:187-216, 274-341`) não reconhecem o
  CI; o estorno herdaria a lacuna.

## 7. Gaps

- G1 Não existe estorno de CI (nem de nenhuma saída física confirmada).
- G2 O R-21 não tem noção de líquido.
- G3 R-03 e Painel não reconhecem o CI (achado lateral L1).

## 8. Riscos

| # | Sev | Risco |
|---|---|---|
| R1 | HIGH | Correção em dobro: INV- contado depois do CI já absorveu o erro; um estorno depois soma +q de novo. |
| R2 | HIGH | Estorno sem R-21 líquido: o relatório continua mostrando despesa que não houve. |
| R3 | HIGH | Recalcular custo no estorno diverge do snapshot (F3). |
| R4 | HIGH | Dois estornos concorrentes (duplo clique, duas abas) somam mais que o original. |
| R5 | MED | Arredondamento: sem regra de resto, parciais não fecham em zero. |
| R6 | MED | Reenvio de estorno parcial grava dois estornos, ambos válidos. |
| R7 | MED | Movimento retroativo confunde a reconciliação do próximo inventário (precedente: ajuste do INV- nunca é retroativo). |
| R8 | MED | B1 (`ADJUSTMENT_IN`) mistura "lançamento anulado" com "diferença de inventário", o que a §115 separou. |
| R9 | LOW | FK CASCADE do CI para o movimento (F5). |
| R10 | LOW | Estorno indevido para esconder consumo real: perfil, motivo, autoria e marca visível no R-21 e no extrato. |
| R11 | LOW | Processo da migration: enum novo não usado no mesmo arquivo; sequence manual (o fresh não confere); catálogos do `prod-cleanup` falham fechado. |

Achados laterais, fora do escopo: **L1** (LOW) R-03 e Painel não reconhecem o CI; **L2** (MED) o espelho de R1 na criação —
CI com data passada registrado depois de um INV- que já contou a falta baixa o material duas vezes.

## 9. Alternativas consideradas

- **A — tipo `INTERNAL_CONSUMPTION_REVERSAL` + registro próprio (`internal_consumption_reversals`).** FK RESTRICT para o CI,
  movimento 1:1 `@unique`, soma ≤ original sob `FOR UPDATE`, nada apagado; tipo, origem e código próprios; custo copiado com
  total pró-rata e resto no último; mesmo lote; entrada de +q sem guarda de Disponível, com guarda de inventário (R1); lista
  própria de perfis. Complexidade média (1 tabela, 2 valores de enum, 1 sequence, serviço, rota, R-21 líquido, diálogo).
  Migration SIM.
- **B1 — `ADJUSTMENT_IN` com origem `INTERNAL_CONSUMPTION` e `sourceId` = CI, sem tabela.** Sem FK; quebra "origem CI é
  saída"; soma varrendo o ledger; extrato com "Ajuste de entrada" e a mesma origem da saída; custo recalculado no R-21 (resíduo
  de R5); Painel e R-03 contam como ajuste — contra a §115. Migration NÃO.
- **B2 — tipos genéricos `REVERSAL_IN`/`REVERSAL_OUT` + tabela genérica.** Cada documento (OP, Expedição, Recebimento) tem
  efeitos próprios e ainda precisaria de serviço próprio: genérico só no nome, abstração especulativa. Migration SIM.
- **C — só Inventário Físico.** Saldo certo depois da contagem, mas o CI segue "consumido"; nada liga o ajuste ao CI; R-21
  superestimado para sempre; Compras, quem mais registra CI, não conta. Migration NÃO.

## 10. Recomendação

Alternativa A: estorno total ou parcial, com registro, motivo, autoria e custo copiado do original; entrada própria datada
no instante do estorno; nunca DELETE, nunca editar o CI, nunca retroativo; o R-21 líquido na mesma fatia (R2). Vale só para o
CI — as outras saídas precisam de discovery própria (B2 rejeitada). C continua sendo o caminho da diferença de inventário de
verdade.

**Modelo (PROPOSTO → implementado):** `InternalConsumptionReversal` — `id`, `code` (ECI-, `@unique`),
`originalConsumptionId` (FK RESTRICT, indexada), `quantity` DECIMAL(24,12) > 0 na unidade do CI, `reason` (3–500),
`unitCost` DECIMAL(20,8)?, `totalCost` DECIMAL(14,4)?, `costSource`, `costDetails` (cópias do CI, total pró-rata),
`inventoryMovementId` (NOT NULL, `@unique`, id do estorno gerado antes), `registeredByUserId` (sessão, nunca corpo),
`registeredByNameSnapshot`, `createdAt`. Item, lote e unidade não são copiados: o item não troca unidade nem controle de lote
depois do primeiro movimento (`items.service.ts:97-106, 296-313`). Nada novo no CI: estornado e saldo estornável são SOMA.

**Movimento:** item e lote do CI (inclusive lote nulo); tipo `INTERNAL_CONSUMPTION_REVERSAL`, sinal +1, "Estorno de consumo
interno"; `quantity` = q; `occurredAt` = agora; origem `INTERNAL_CONSUMPTION_REVERSAL`, `sourceId` = id do estorno; `reason`
= motivo; `createdBy` = nome da sessão.

**API:** `POST /internal-consumptions/:id/reversals { quantity, reason, expectedReversedQuantity }` → 201; lista e detalhe do
CI com `reversedQuantity` e `reversibleQuantity`, e o detalhe com `reversals[]`. Operação de domínio explícita.

**Custo:** exatamente o snapshot do CI; o estorno nunca chama a hierarquia. Parcial = round4_half_up(CI.totalCost × q /
CI.quantity); o que zera o saldo = CI.totalCost − soma dos anteriores; `NO_COST` nulo, nunca zero. Estornado por inteiro, a
soma dos estornos é exatamente `CI.totalCost` e o líquido 0,0000. O movimento de estorno nunca entra em média, último custo
real, custo de OP ou CMV. O estorno herda o destino do CI (Centro de Custo futuro vale para os dois).

**Lote:** uso e consumo nasce sem lote. Quando o CI saiu de lote: **L1** (recomendado) sempre o mesmo lote — bloqueado ou
vencido, o On Hand sobe e o Disponível não; a situação do lote nunca muda; o diálogo avisa. L2 (só se elegível) bloqueia
correção verdadeira; L3 (outro lote) quebra o rastreio. "Lote encerrado" não existe (`LotStatus`); lote de cliente é
impossível (o CI já recusa).

**Concorrência — uma transação:** (1) `SELECT … FROM internal_consumptions WHERE id = $1 FOR UPDATE`; (2) `lockStockScope`
do escopo do CI; (3) posição em INV- aberto → recusa com o código; (4) INV- `COMPLETED` com registro válido na mesma
`positionKey` e `countedAt > CI.createdAt` → recusa com o código (posição retirada, INV- cancelado e registro anterior ao CI
não contam); (5) soma dos estornos: `expectedReversedQuantity` diferente → 409; q > saldo → 400; (6) código, movimento,
estorno, commit. Sem deadlock: só o estorno trava linha de CI; o encerramento de INV- trava itens e lotes. Posição que entra
em INV- depois do passo 3: o movimento do estorno vira "movimentação durante o inventário" e o encerramento exige recontar ou
confirmar. A fronteira `CI.createdAt` é conservadora: na dúvida, recusa.

**R-21 (R21-a):** cada linha é um CI com Quantidade original, Estornado, Líquido, Custo total líquido e Situação (—,
Estornado parcialmente, Estornado); período, filtros e busca pelo CI; KPIs e resumos por item e destino pelo líquido; CI
estornado por inteiro continua listado, marcado, fora de Consumos, Sem custo e Itens distintos; linha "N consumos com
estorno". O relatório de um período passado muda quando chega um estorno depois — a cronologia continua no extrato. CSV e PDF
acompanham.

**UX:** histórico de Uso e consumo com "Estornado" e "Situação"; ação "Estornar" só para quem pode e com saldo > 0; diálogo
"Estornar CI-…" com item, lote, data, destino, original, já estornado, saldo, custo e fonte, quantidade (padrão = saldo),
motivo obrigatório, estornos anteriores e avisos (lote bloqueado ou vencido, item inativo); recusa da API inteira. Extrato:
"Estorno de consumo interno", Entrada, origem "ECI-000001 (estorno de CI-000123)". Sem tela nova, sem aprovação.

## 11. Decisões PO

| # | Pergunta | Recomendação | Decisão (2026-09-18) |
|---|---|---|---|
| P1 | Estorno próprio (A) ou só Inventário Físico (C)? | A | **A** — `InternalConsumptionReversal`, tabela `internal_consumption_reversals`, movimento e origem `INTERNAL_CONSUMPTION_REVERSAL`; nunca DELETE, editar CI ou movimento retroativo |
| P2 | Quem estorna? | E1: ADMIN + QUALITY, lista própria | **E1** — `INTERNAL_CONSUMPTION_REVERSAL_ROLES`; PRODUCTION, PURCHASING, COMMERCIAL e VIEWER não estornam; leitura de todo autenticado; 403 antes do corpo |
| P3 | R-21: líquido na data do CI (R21-a) ou negativo no período do estorno (R21-b)? | R21-a | **R21-a** |
| P4 | Recusar se inventariada depois do CI ou em INV- aberto? | Recusar nos dois | **Recusar nos dois**, citando o código do INV-; INV- anterior ao CI e INV- cancelado não bloqueiam; fronteira `CI.createdAt` |
| P5 | Parcial e múltiplos até o saldo? | Sim | Sim (valor padrão) |
| P6 | Item inativo pode ser estornado? | Sim | Sim — anulação de saída histórica, não entrada operacional nova |
| P7 | Lote | L1, mesmo lote sempre | L1, sem mudar a situação do lote, com aviso na tela |
| P8 | Código | ECI-000001 | ECI-000001 |
| P9 | Escopo | Só consumo interno | Só consumo interno |
| P10 | Estorno de estorno / prazo | Não / sem prazo | Não existe ação "Estornar ECI"; sem prazo limite |

Adendos do handoff de implementação: Dashboard sem card novo (pendência separada); R-03 entra na mesma capability (CI e
estorno com tipo, direção, origem e código corretos); movimentos manuais de entrada depois do CI não são tratados como
correção do CI nem bloqueiam — o diálogo pode listá-los se for simples.

## 12. Pendências PO

Nenhuma para esta capability. Registrados para depois, sem posição: L2 (CI retroativo depois de INV- concluído) e o Painel
sem Uso e consumo.

## 13. Escopo recomendado

Uma fatia: migration + API + R-21 líquido + diálogo + extrato + R-03.

## 14. Fora do escopo

Estorno de outras saídas (OP, Expedição, Recebimento, amostra); estorno de estorno; aprovação; prazo; card do Painel; L2;
Centro de Custo.

## 15. Próxima capability

INTERNAL-CONSUMPTION-REVERSAL-01.

## 16. Implementação

NÃO IMPLEMENTADO.

## 17. Histórico de decisões

- 2026-09-18 — discovery READ ONLY entregue no chat sobre `f14b18f9`, `READY_TO_IMPLEMENT: NO` até P1–P4.
- 2026-09-18 — PO decide P1–P4 com as recomendações (A, E1, R21-a, recusar nos dois casos) no handoff de
  INTERNAL-CONSUMPTION-REVERSAL-01; P5–P10 como recomendadas; R-03 incluído na fatia; Painel fica como pendência separada.

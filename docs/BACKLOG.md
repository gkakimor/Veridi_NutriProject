# Backlog

O que está **aberto**, consolidado com o Product Owner em 2026-09-04 após o
Repository Baseline v2, a referência manual de custo, a revisão global do
"Como funciona", o reparo da reconstrução de migrations e o deploy de
`main @ ffee5c6`.

Achado fechado não fica aqui. O que virou regra está em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md); o que cada rodada descobriu está em
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md); onde
cada regra é protegida está em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md);
escopo futuro vive só em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

**Rodada 1 aprovada em 2026-09-04:** #12, #9, #3, #5 resolvidos; #4
resolvido com residual aceito (≈117px em 1280×800).
**Rodada 2 aprovada e publicada em 2026-09-05** (merge `dfb2673`): #8A, #8B e
#8C resolvidos.
**Rodada 3 aprovada e publicada em 2026-09-05** (merge `b89f9a4`): #8D e #8H
resolvidos; #15, #16 e #17 abertos como achados.
**Rodada 4 aprovada e publicada em 2026-09-05**: #15 e #16 resolvidos; #18
aberto como achado, por decisão do PO. #17 segue aberto. **Seguinte, quando o
PO autorizar:** #8E, #8F e #8G.
**Auditoria PREC-01 aprovada e publicada em 2026-09-05**, só documentação, sem
migration e sem mudança de regra: **PREC-01 resolvido**; #19, #20 e #21 abertos
como achados. Relatório em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md); decisões do PO em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57, §58 e §59 e na seção E deste
arquivo. **#18 desbloqueado**, para depois da fundação. **PREC-15 permanece
bloqueado até revisão do PO.**
**Fundação numérica A (2026-09-05):** **#20 RESOLVIDO** (motor canônico em 40
dígitos, nos DOIS construtores) e **PREC-MIG-A RESOLVIDO** — 43 colunas em
`DECIMAL(24,12)` (39 QUANTITY + 1 FACTOR + 3 TECHNICAL_RESULT), migration
`20260925093001_numeric_precision_quantities_24_12`, sem backfill.
**Fundação numérica B (2026-09-05):** **PREC-MIG-B RESOLVIDO** — 3 colunas
UNIT_COST em `DECIMAL(20,8)`, migration
`20260925093002_numeric_precision_unit_cost_20_8`, sem backfill. Na aprovação o
PO confirmou a exclusão de `PurchaseOrderLine.unitPrice` e abriu **PREC-MIG-P**
(UNIT_PRICE de alta precisão, ABERTO / HIGH).
**Fundação numérica C aprovada pelo PO e publicada em 2026-09-06:**
**PREC-MIG-C RESOLVIDO** — 7 colunas PURITY/OVERAGE em `DECIMAL(9,6)`, migration
`20260925093003_numeric_precision_purity_overage_9_6`, sem backfill. Na
aprovação o PO **registrou como regra de produto** a recusa explícita acima de
seis casas: pureza/overage com mais de 6 casas respondem HTTP 400 em vez de
serem aceitos e arredondados em silêncio pelo PostgreSQL. O PO também nomeou
**PREC-P-01** (`PurchaseOrderLine.unitPrice → DECIMAL(20,8)`, DECIDIDO /
PENDENTE) dentro do PREC-MIG-P. #19 segue
**ABERTO / PARCIAL** e PREC-MIG-D **ABERTO / PARCIAL**. **Seguinte:**
**PREC-MIG-P** (HIGH, com PREC-SER-02), depois o D residual.

---

## A. Defeitos abertos

### 19. `Decimal(18,6)` zera quantidade física derivada em microdosagem — ABERTO / PARCIAL

**PREC-MIG-A, B e C RESOLVIDOS; #19 segue ABERTO** enquanto PREC-MIG-D, E e P
não fecharem. O defeito que originou o item está corrigido: as 43 colunas
de quantidade e grandeza técnica inequívoca estão em `DECIMAL(24,12)`, e
`0,000000048` persiste como `0,000000048000` em vez de `0,000000`. Provado
contra o banco real em
`apps/api/src/modules/inventory/precision-round-trip.test.ts`.

Prioridade elevada para **HIGH / URGENTE** por decisão do PO em 2026-09-05:
perda real de informação em Formulação e Produção é inaceitável. Achado da
auditoria PREC-01, com dado real
do banco local. Componente `MP-000147`, `FIXED_BASIS` `0,000048 kg` sobre base
1000, item estocado em kg: produzir de 1 a 10 unidades dá necessidade física de
`4,8e-8` a `4,8e-7 kg`, e `ProductionOrderRequirement.requiredQuantity`
**persiste `0,000000`** — a OP afirma que não precisa do material. A 100
unidades grava `0,000005` contra `0,0000048` reais, erro de +4,2%. Com scale 12
todos os casos são exatos.

O motor de Formulação está correto: ele calcula em `Decimal` sem arredondar. A
perda é do scale da coluna, aplicada na gravação — reintroduzindo exatamente o
"não precisa de material" que `formulation-quantity.ts` foi escrito para evitar.

**Alcance medido:** 1991 componentes de formulação, 142 abaixo de `0,001` na
unidade de estoque, 1 já zerando. Dói em amostra, piloto e lote pequeno.

**Colunas afetadas** (todas `Decimal(18,6)`, quantidade derivada persistida):
`ProductionOrderRequirement.requiredQuantity` e `.theoreticalQuantity`,
`MaterialReservationLine.quantity`, `ProductionConsumption.quantity`,
`InventoryMovement.quantity`, `RecipeWeighing.plannedQuantitySnapshot`,
`SampleConsumption.quantity`.

**Alvo aprovado pelo PO:** QUANTITY e grandeza inequivocamente técnica em
`DECIMAL(24,12)`; fator de conversão idem ([`PRODUCT_RULES.md`](PRODUCT_RULES.md)
§58). O primeiro widening prioriza `requiredQuantity`, `theoreticalQuantity`,
quantidades de Formulação, `SampleConsumption.quantity`,
`InventoryMovement.quantity`, quantidades de estoque e de produção, fatores de
conversão e as demais QUANTITY inequivocamente técnicas. **A lista que vale é a
do inventário** de [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md)
§3.1 — nenhuma lista nova.

Exige migration de widening e, no mesmo passo ou antes, a precisão canônica de
#20. Sem backfill: casa nunca persistida não se reconstrói. Perguntas de domínio
remanescentes em [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §12.

### 20. `decimal.js` roda em 20 dígitos significativos — RESOLVIDO

**RESOLVIDO em 2026-09-05, junto do PREC-MIG-A.** A configuração canônica vive
em `packages/shared/src/decimal-config.ts` — 40 dígitos, `precision` e nada
mais: `rounding` segue `ROUND_HALF_UP`, o mesmo que o PostgreSQL aplica ao
gravar, e os expoentes ficaram como estavam.

**A implementação encontrou o que a auditoria não tinha visto: são DOIS
construtores, não um.** O Prisma empacota a própria cópia do `decimal.js`, e
`Prisma.Decimal !== Decimal` — objetos distintos, com configuração
independente. Como quase todo o cálculo de domínio da API roda em
`Prisma.Decimal`, um `Decimal.set()` só no pacote compartilhado teria deixado a
API inteira em 20 dígitos, e nenhum teste de `@veridi/shared` perceberia.
`apps/api/src/lib/decimal.ts` aplica a mesma configuração ao construtor do
Prisma; os dois são conferidos por comportamento em
`packages/shared/src/decimal-config.test.ts` e `apps/api/src/lib/decimal.test.ts`.

Sem dependência de ordem de import: quem calcula importa o construtor do módulo
canônico, e é o import que configura. Regra durável em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §59.

Achado original da auditoria
PREC-01 (2026-09-05). `Decimal.precision = 20`, default, nunca reconfigurado em
nenhum ponto do repositório. Medido:
`new Decimal("123456789012.123456789012").times(1)` devolve
`123456789012.12345679`.

É um teto de JavaScript **independente da coluna**: ampliar scale sem ampliar
`Decimal.precision` cria coluna que o sistema não consegue preencher. Bloqueia
#19 e foi o motivo de `DECIMAL(30,12)` ser recusado como baseline.

**Decisão do PO (2026-09-05):** elevar para **40 dígitos significativos**, em
**uma configuração canônica** — nada de `Decimal.set()` espalhado por módulo.
Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §59. **Ordem
obrigatória:** antes ou junto do primeiro widening, com teste que prove o dígito
extra.

### 21. Seis serializações de DTO entregam menos casas do que a coluna guarda — MEDIUM

**ABERTO.** Desdobrado pelo PO em 2026-09-05 nos itens PREC-SER-01, PREC-SER-02
e PREC-FMT-01 (seção E). Achado da auditoria PREC-01: `toFixed(N)` com `N`
menor que o scale da coluna. Cinco são exibição; uma grava:
`projects/quote-pricing.service.ts:288` aplica faixa de precificação a linha de
orçamento convertendo preço de 6 casas em 4 — perda da coluna
(`QuoteLine.unitPrice` é `Decimal(14,4)`), não do código, e recuperável por
leitura via `pricingSelectedUnitPriceSnapshot` (14,6).

Junto: a mesma média ponderada de custo sai com 4 casas em
`costs/costs.service.ts` e 6 em `items/item-cost-references.service.ts:162` —
`11,6586` contra `11,658585`, duas telas mostrando números diferentes do mesmo
dado. E `print/documents.tsx:353` imprime `requiredQuantity / numberOfParts` em
float no documento da OP, enquanto a API divide com `splitDecimal`
(`ROUND_DOWN` + resto na última parte): num total não divisível o `X × N`
impresso não fecha, num documento de execução GMP.

Lista completa em [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md)
§5. A correção do `print` é independente de migration e cabe em qualquer rodada.

### 18. Consistência monetária da Ordem de Compra — MEDIUM

**ABERTO — DESBLOQUEADO em 2026-09-05, capability própria, depois da fundação
de precisão.** A auditoria exigida pelo PO está cumprida e a direção está
aprovada: o total documental da OC passa a reconciliar com as linhas exibidas,
`Σ round(total monetário da linha, 2)` em vez de `round(Σ valores brutos)`.
**Não implementar antes de #20 e do primeiro grupo de #19** — mexer na
aritmética monetária enquanto a fundação numérica está em movimento cria duas
mudanças concorrentes no mesmo número.

Achado da Rodada 4. `calcularTotaisOrdemCompra` soma as linhas em precisão
cheia e arredonda só na saída — `round(Σ valores brutos das linhas)` —,
enquanto os documentos comerciais passaram a usar
`Σ round(valor monetário da linha, 2)` ([`PRODUCT_RULES.md`](PRODUCT_RULES.md)
§55). Com preço de quatro casas as duas contas divergem em centavos.

**Princípio de produto.** Se a Ordem de Compra apresenta totais monetários de
linha em duas casas, o total do documento deve, em princípio, reconciliar
exatamente com a soma desses valores apresentados. Alvo conceitual futuro:
`Σ round(quantidade × preço unitário, 2)` antes de formar o total do
documento.

**Limites definidos pelo PO.** Não implementar junto de outra rodada e **não
reabrir #8A** — a regra atual foi publicada como está. Antes de alterar a
matemática é preciso auditar: OCs históricas; recebimentos; custo efetivo;
custo de aquisição; vínculos com fornecedor; persistência histórica; e se
existe razão de domínio para a regra atual. Só então decidir se muda.

**Auditoria PREC-01 (2026-09-05) — o que ficou provado.** A pré-condição que o
PO exigiu está cumprida, e o resultado libera a decisão:

- **Nada da OC é persistido em dinheiro.** `PurchaseOrder` e `Receipt` não têm
  nenhuma coluna de total; o total é sempre derivado na leitura. Não existe
  documento histórico congelado para reconciliar nem backfill possível.
- **O preço unitário preciso é preservado**: `PurchaseOrderLine.unitPrice`,
  `Decimal(14,4)`, nunca arredondado além da própria coluna.
- **O custo de aquisição não vem da OC.** É `ReceiptLine.actualUnitCost`,
  informado por pessoa. `lib/cost-reference.ts` recusa explicitamente o preço da
  OC como fallback: sem custo real histórico o resultado é `NO_COST`, nunca o
  preço da compra.
- **Recebimento parcial** usa `ReceiptLine.receivedQuantity` `Decimal(18,6)`,
  independente do total do documento.
- **Custo efetivo** é `Σ(receivedQuantity × actualUnitCost) ÷ Σ receivedQuantity`
  em `Decimal`, sem arredondamento intermediário.

**Conclusão:** o custo industrial **não** consome o total documental arredondado
da OC em ponto nenhum. A divergência de #18 é exclusivamente de apresentação
documental. Mudar `round(Σ)` para `Σ round()` não contamina custo, CMV nem
precificação — a decisão é do PO, e agora é uma decisão isolada.

### 17. Suíte da API não é determinística sob paralelismo no banco local — LOW técnico

**ABERTO.** Em execuções completas de `pnpm test`, um teste de
`modules/production-orders` falha esporadicamente (visto em
`consumption.test.ts` e em `picking.test.ts`, ambos medindo agregados de
estoque). Isolado e em reexecução da suíte completa, passa. O paralelismo do
Vitest sobre o mesmo banco de desenvolvimento é a origem provável.

Custo real: um gate verde exige reexecutar, e uma falha assim se parece com
regressão de quem está lendo. Rodada posterior — candidato natural a entrar
junto de #10 (manutenção).

**Observado de novo na Fundação A (2026-09-05), com um arquivo novo:**
`modules/finished-goods/finished-goods.test.ts` > "lista apenas lotes origin
PRODUCTION" falhou com `Cannot read properties of undefined (reading 'map')` —
o `listFinishedGoods` devolveu resposta sem `rows`. Isolado passa (5/5) e a
reexecução completa passou (80 arquivos, 1026 testes). Confirma que o item não
é só de `production-orders`: alcança qualquer teste que meça agregado de
estoque sob paralelismo no mesmo banco. **Não corrigido nesta branch**, por
escopo.

---

## B. Melhorias aprovadas

### 8. Cálculo ao vivo nas demais telas — subdividido

Padrão nascido na Formulação: valor derivado aparece enquanto se digita, a
conta vem da **mesma função** que a API usa, `CalcHint` mostra a aritmética,
premissa ausente vira travessão. Hoje no padrão: Faturamento, Formulação, CMV
e a prévia de política de preço.

- **#8A, #8B, #8C — RESOLVIDOS na Rodada 2** (ver G).
- **#8D, #8H — RESOLVIDOS na Rodada 3** (ver G).
- **#8E — LOW — Recebimento, custo efetivo.** Mostrar total e comparação com o
  custo previsto quando aplicável.
- **#8F — LOW — Ficha de Pesagem.** Mostrar a diferença antes da confirmação.
- **#8G — A AUDITAR — Ordem de Produção, quantidade planejada.** Mudar a
  quantidade não atualiza a prévia das necessidades até salvar. Auditar a regra
  histórica/snapshot **antes** de alterar: nenhum cálculo vivo pode mutilar OP
  já congelada.
Também no radar, sem item próprio: Contagem de Estoque e Reservar ↔ Produzir
calculam ao vivo mas ainda sem `CalcHint`; Custo Industrial e impacto de
materiais do Pedido ficam em branco até apertar botão sem dizer que o valor é
do que está salvo. Regra durável de prévia × gravado: `PRODUCT_RULES.md` §54.

---

## C. Decisões aguardando negócio

### 11. Material do cliente — lote do fabricante e validade por configuração do Item — MEDIUM

`receiving/ReceiveCustomerMaterialPage.tsx` aceita confirmar com "Lote do
fabricante" e "Validade" em branco; o recebimento de OC exige os dois quando o
item controla lote e validade. Não existe regra canônica para dizer quando
material fornecido pelo cliente exige lote do fabricante, validade ou
rastreabilidade adicional.

**Decisão de PO:** não assumir que todo Item exige validade. A solução futura
considera regra/configuração por tipo ou por Item — hipótese de modelagem:
"exige lote do fabricante" e "exige validade" —, mas defaults e obrigatoriedade
operacional precisam ser validados com a Veridi. Relacionado ao #7.
**AGUARDANDO VALIDAÇÃO DE NEGÓCIO.**

### 7. Convenções operacionais ainda não formalizadas — AGUARDANDO VALIDAÇÃO COM A VERIDI

Cada uma tem um padrão em uso; nenhuma impede operação. Pauta consolidada para
a homologação — não implementar por suposição; com o feedback da Veridi,
quebrar em requirements independentes:

- regra de geração automática do número de lote;
- limiar/alerta de validade próxima;
- permissões detalhadas por papel;
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção.

Perguntas regulatórias abertas: [`BLOCK_H_VALIDATION.md`](BLOCK_H_VALIDATION.md).

---

## D. Manutenção técnica

### 14. Drift `schema.prisma` × banco/migrations — LOW técnico, risco estrutural

`prisma migrate diff` do banco (novo ou produção, idênticos) para o
`schema.prisma` gera 86 comandos: 0 tabelas, 0 colunas e 0 tipos funcionais
divergentes; 27 chaves estrangeiras que o banco aplica com `ON DELETE
RESTRICT` e o schema declara `SET NULL` (`attachments.lotId`,
`lots.ownerCustomerId`, `production_orders.customerOrderId`,
`billing_lines.lotId`…); ≈32 índices e constraints com divergência nominal.
O banco é o lado mais restritivo.

**Decisão de PO:** não corrigir automaticamente. Cada FK exige decisão de
domínio — bloquear a exclusão, desassociar o relacionamento, ou arquivar em vez
de excluir. Fazer em rodada isolada: **"Schema Integrity Audit"**.

**Regra de segurança já vigente** ([`TECH_BASELINE.md`](TECH_BASELINE.md),
*Migration order*, e `CLAUDE.md`): migration nova não carrega drift incidental —
nem `RESTRICT → SET NULL`, nem renomeação de índice ou constraint, nem criação
ou remoção alheia. Todo SQL gerado é revisado linha a linha; diff gigante do
Prisma não se aprova. **ABERTO.**

### 10. Compactar `archive/DELIVERY_HISTORY.md` — MANUTENÇÃO / LOW

≈5.326 linhas de diário por entrega — contradiz o objetivo do Baseline v2 de
reduzir contexto histórico vivo. Consolidar para ≈200–400 linhas com só data,
capability, release/commit importante, decisão durável e breaking change
relevante. O Git guarda o detalhe. Não misturar com capability de negócio.

---

## E. Fundação de precisão numérica — decomposição aprovada

Aprovada pelo PO em 2026-09-05 sobre
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md). Matriz de tipos em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §58; regra de configuração do motor em
§59; separação armazenamento × apresentação em §57.

**Fundação A entregue em 2026-09-05** (#20 + PREC-MIG-A). O restante segue sem
implementação.

### Migrations de widening

| Item | Escopo | Status |
|---|---|---|
| **PREC-MIG-A** | QUANTITY e grandezas inequivocamente técnicas → `DECIMAL(24,12)`, incluindo fatores de conversão | **RESOLVIDO** — 43 colunas (39 QUANTITY + 1 FACTOR + 3 TECHNICAL_RESULT), migration `20260925093001_numeric_precision_quantities_24_12` |
| **PREC-MIG-B** | UNIT_COST e `ReceiptLine.actualUnitCost` → `DECIMAL(20,8)` | **RESOLVIDO** — 3 colunas, migration `20260925093002_numeric_precision_unit_cost_20_8` |
| **PREC-MIG-C** | Pureza e overage → `DECIMAL(9,6)` | **RESOLVIDO** — 7 colunas, migration `20260925093003_numeric_precision_purity_overage_9_6` |
| **PREC-MIG-D** | Resultados técnicos persistidos → `DECIMAL(24,12)` onde aplicável | **ABERTO / PARCIAL** — 3 campos já entregues no A, ver abaixo |
| **PREC-MIG-E** | Campos que ainda exigem decisão individual | ABERTO — perguntas em [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §12 |
| **PREC-MIG-P** | UNIT_PRICE que precisa preservar alta precisão | **ABERTO / NEXT, HIGH** — contém **PREC-P-01** |
| **PREC-P-01** | `PurchaseOrderLine.unitPrice` → `DECIMAL(20,8)` | **DECIDIDO / PENDENTE** — alvo aprovado pelo PO em 2026-09-05, sem implementação |

**PREC-MIG-B — entregue em 2026-09-05.** `ReceiptLine.actualUnitCost` é a fonte
de custo real e alimenta custo de aquisição, média ponderada, estoque, CMV e
todo custo posterior; arredondamento visual é independente disso. Três colunas
saíram de `Decimal(14,4)` para `DECIMAL(20,8)` — a família UNIT_COST inteira do
inventário:

- `ReceiptLine.actualUnitCost` — custo efetivo de aquisição
- `ItemCostReference.unitCost` — referência manual
- `SupplierItemOffer.unitPrice` — oferta consumida como custo pelo seletor
  (`cost-source-selection.ts` a lê como `unitCost`; vale a categoria do
  inventário, não o nome do campo)

**O que NÃO foi junto, e por quê.** `PurchaseOrderLine.unitPrice` aparece como
"Sim — B" no inventário, mas sua **categoria é UNIT_PRICE** — o Grupo B da
auditoria agrupava custo, tarifa e preço, enquanto o PREC-MIG-B do PO é
UNIT_COST. Onde os dois discordam vale a categoria. **O PO confirmou a exclusão
em 2026-09-05** e abriu o **PREC-MIG-P** para o campo. Pelo mesmo motivo ficaram
fora os preços contratuais (`QuoteLine`, `CustomerOrderLine`, `BillingLine`),
as tarifas `rateValue` (RATE) e os preços técnicos da precificação em `14,6`.
`scripts/numeric-precision-matrix.test.ts` trava isso: o teste falha se alguém
arrastar um `unitPrice` documental junto por semelhança de nome.

**`SupplierItemOffer.unitPrice` fica em B, e isso foi confirmado pelo PO.**
Apesar do nome, no domínio atual o campo participa diretamente da seleção
canônica de custo — `cost-source-selection.ts` o lê como `unitCost`. Vale o uso
real, não o nome.

**PREC-MIG-P — UNIT_PRICE de alta precisão. ABERTO / NEXT, HIGH.** Decisão do PO
de 2026-09-05: um preço unitário de compra pode legitimamente ter mais de quatro
casas — `4,05318764` —, e o banco deve preservar o valor preciso mesmo quando a
tela mostra menos. **PREC-P-01 — `PurchaseOrderLine.unitPrice` → `DECIMAL(20,8)`
— está DECIDIDO e PENDENTE de implementação**; os demais UNIT_PRICE entram na
avaliação da capability.

A separação que a capability precisa respeitar: **preço unitário da OC** é
grandeza técnica de alta precisão; **total monetário da linha e do documento**
segue regra documental própria. São conceitos independentes — um preço de
`4,05318764` pode produzir um total apresentado em duas casas, e isso **não**
autoriza reduzir o preço unitário armazenado. Widening não recalcula OC
histórica: `4,0531` continua matematicamente `4,0531`, apenas representado como
`4,05310000`. Sem backfill, sem recálculo documental. **PREC-SER-02** trata a
serialização desses preços e anda junto desta família.

**PREC-MIG-C — entregue em 2026-09-06.** `99,9995%` não pode ser persistido em
silêncio como `100,000`. A tela pode mostrar menos casas; a persistência preserva
o valor. Sete colunas saíram de `Decimal(6,3)` para `DECIMAL(9,6)` — a família
PERCENTAGE (pureza/overage) inteira do inventário:

- `Item.defaultPurityPercent` — pureza padrão do cadastro
- `FormulationComponent.purityPercentApplied` e `.overagePercent` — o snapshot da
  receita, e os operandos que o motor divide e multiplica
- `ProductionOrderRequirement.purityPercentApplied` e `.overagePercent` —
  congelados na OP
- `FormulationTemplateComponent.purityPercentApplied` e `.overagePercent` — a
  origem da versão gerada de template

Medido contra o PostgreSQL antes da migration: `99.9995::decimal(6,3)` devolvia
`100.000`, e `0.000001` devolvia `0.000`. Agora persistem como `99.999500` e
`0.000001`, e continuam distintos de `100.000000`. A entrada **recusa** acima de
seis casas — em Item, Formulação e template — em vez de deixar o PostgreSQL
arredondar a sétima em silêncio; `99.9999999` viraria `100.000000` mesmo em
`9,6`, então trocar um silêncio por outro não resolveria nada.

**Precisão e faixa continuam separadas.** O schema suporta `999,999999`, e isso
não é autorização de negócio: pureza segue `0 < x <= 100` e overage segue `>= 0`,
como sempre. A fórmula canônica não mudou — `físico = teórico ÷ (pureza/100) ×
(1 + overage/100)` —, `PHYSICAL_DIRECT` continua sem aplicar ajuste nenhum e
`PER_DOSE` sem `dosesPerPackage` continua fail-closed. O que mudou é só a
precisão dos operandos.

**Nenhum resultado ficou estrangulado.** O físico que a pureza produz é gravado
em `ProductionOrderRequirement.requiredQuantity` e `.theoreticalQuantity`, ambos
já em `DECIMAL(24,12)` desde o PREC-MIG-A, e o custo industrial por unidade em
`IndustrialCostCalculation.costPerUnit`, também `24,12`. O residual do
PREC-MIG-D (`14,4` e `14,6`) é composição de custo e de CMV — não recebe o
resultado de pureza/overage, e por isso não limita o benefício desta capability.

**PREC-MIG-D — o que já saiu e o que resta.** Três resultados técnicos que já
estavam em `Decimal(18,6)` viajaram junto do PREC-MIG-A, porque o alvo deles é o
mesmo `DECIMAL(24,12)` e separá-los criaria uma segunda migration sobre as
mesmas tabelas:

- `IndustrialCostCalculation.costPerUnit`
- `PricingTier.costPerUnitSnapshot`
- `ProductionOrderCostSnapshot.costPerProducedUnit`

**Esses três estão ENTREGUES e não devem reaparecer numa migration futura.**
O residual do PREC-MIG-D são os resultados técnicos ainda em `Decimal(14,4)` e
`Decimal(14,6)` — composição do custo industrial, composição do CMV e os totais
de snapshot da precificação —, que o inventário classifica em §3.1.

Nenhuma dessas migrations faz backfill. Widening preserva o valor gravado e o
reescreve com zeros à direita; casa que nunca foi persistida não se reconstrói.
Provado no PREC-MIG-A: 371 valores existentes comparados antes e depois, zero
divergência matemática — só a representação ganhou zeros
(`kg = 1000.000000` virou `1000.000000000000`).

**Três colunas `18,6` ficaram fora do PREC-MIG-A, de propósito.**
`FormulationComponent.legacyTotalQuantity` e `.legacyBatchUnits` são dado
importado do legado sobre o qual ninguém calcula (`NOT_APPLICABLE` no
inventário). `QuoteLine.industrialCostPerUnitSnapshot` viaja com os demais
snapshots de precificação da mesma linha, no **PREC-MIG-B** — o inventário o
classifica assim, e separá-lo quebraria a família por conveniência.
`scripts/numeric-precision-matrix.test.ts` guarda essa lista: uma coluna nova
em `18,6` falha o gate.

### Serialização e formatação

| Item | Escopo | Status |
|---|---|---|
| **PREC-SER-01** | DTOs cuja serialização com `.toFixed()` corta a precisão técnica antes da UI | **ABERTO / PARCIAL A+B+C** — as três famílias já migradas foram auditadas e serializam por `.toString()`/`csvDecimal`, sem corte; o resto segue as dependências de D e P |
| **PREC-SER-02** | Gravação de preço técnico de 6 casas em coluna de 4 quando **não** for snapshot contratual | APROVADO — anda junto do **PREC-MIG-P**, a família UNIT_PRICE |
| **PREC-FMT-01** | Eliminar `Number` nos formatters para grandeza técnica de alta precisão | APROVADO — obrigatório antes de qualquer preset acima de 6 casas |

Ocorrências mapeadas em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §5 e §7.
A correção do float de `print/documents.tsx:353` (#21) é independente de
migration e cabe em qualquer rodada.

### Preferências de exibição — roadmap aprovado, depois da fundação

| Item | Escopo |
|---|---|
| **PREC-UI-01** | Preferência visual por usuário |
| **PREC-UI-02** | Presets Compacta / Padrão / Técnica / Máxima |
| **PREC-UI-03** | Configuração por categoria |
| **PREC-UI-04** | Override temporário de sessão |
| **PREC-UI-05** | Modo de edição revela precisão integral |
| **PREC-UI-06** | Salvar sem alterar preserva casas não exibidas |
| **PREC-UI-07** | Totais documentais seguem o domínio, não o perfil |
| **PREC-UI-08** | Preferência visual nunca grava nem recalcula |

Desenho em [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §11;
invariantes duráveis em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57.
**Não implementar antes da fundação** — PREC-UI-05 e PREC-UI-06 já são o
comportamento atual e precisam ser preservados, não reconstruídos.

---

## F. Observação

### 1. `pnpm test` — `ERR_IPC_CHANNEL_CLOSED` ocasional no encerramento — LOW

Ocorrência histórica e intermitente (`Error: Channel closed`) no fechamento
dos workers do vitest com api e web juntos; nenhuma asserção falha. Sem
reprodução recente, suítes verdes, nenhum indício de regressão de produto.
**Decisão de PO:** não investigar preventivamente sem reprodução. Se
reaparecer, capturar versão do Node, worker/processo, ordem de shutdown, árvore
de processos, frequência e stack completa antes de mexer no runner.

### 2. Base local — dados legados inconsistentes — LOW

Só no banco **local** de desenvolvimento com o corpus legado importado:
348 produtos sem cliente (91 em uso), 54 itens de produto acabado órfãos.
Produção não é afetada — a base está limpa e produto novo exige cliente.
**Decisão de PO:** nenhuma feature nem migration para isso agora; deve sumir no
próximo reset canônico da base local/E2E. **ADIADO / MANUTENÇÃO LOCAL.**

---

## G. Resolvidos recentes (2026-09-04 e 2026-09-05)

- **#15 Integridade comercial Orçamento → Pedido** (2026-09-05, Rodada 4).
  O Pedido gerado de uma proposta aceita congela o subtotal da PROPOSTA:
  `calcularTotaisOrcamento`, a mesma função que montou o documento aceito.
  `quote-to-order.service.ts` somava as linhas em precisão cheia e arredondava
  no fim — com preço de quatro casas, `Σ round(linha)` e `round(Σ linha)`
  divergem em centavos e o Pedido fechava por um valor que a proposta nunca
  mostrou (7 × R$ 12,3450 em duas linhas: R$ 172,84 na proposta, R$ 172,83 no
  Pedido). O mesmo defeito estava no resumo do Faturamento dentro do Pedido,
  que agora passa por `calcularTotaisFaturamento` (R$ 1.927,41, não
  R$ 1.927,42). Preços acordados, quantidades, desconto, plano de pagamento e
  proveniência seguem copiados sem recálculo; nenhum documento histórico foi
  tocado e não houve backfill. Regra durável em
  [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §55.
  `packages/shared/src/quote-math.test.ts`,
  `modules/projects/project-integration.test.ts`,
  `modules/billings/billing-price.test.ts`,
  `web pages/projects/orcamento-previa.test.tsx`.
- **#16 `pricing-options` responde 404 para ausência de precificação**
  (2026-09-05, Rodada 4). `GET /quote-lines/:id/pricing-options` responde
  **200** com `{ "pricing": null }` quando o produto não tem precificação
  vigente — estado esperado do negócio, não recurso ausente —, e a tela
  continua oferecendo preço manual sem erro no console. 404 voltou a
  significar só linha inexistente, e 403 e erro interno continuam distintos.
  Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §56.
  `modules/projects/project-integration.test.ts`,
  `web lib/quote-pricing-options.test.ts`.

- **#8D Faturamento — a consequência do preço antes de confirmar** (2026-09-05).
  Alterar o preço de uma linha mostra, enquanto se digita, o total da linha e o
  total do documento que vão resultar, ao lado do "Total da linha gravado" e do
  "Total do documento gravado". A conta é `calcularTotaisFaturamento` em
  `@veridi/shared` — a mesma que a API usa para emitir (linha em 2 casas,
  documento = soma das linhas impressas), agora um motor só: a tela somava em
  `Number`, a API em `Decimal`. Em rascunho o rodapé é "Valor total (prévia)" e
  o gravado aparece nomeado quando difere. Preço vazio, ilegível ou negativo não
  vira R$ 0,00: fica sem total, é dito, e a confirmação trava. Preço acordado,
  motivo, autor e hora seguem intactos; emitido continua histórico.
  `packages/shared/src/billings.test.ts`,
  `modules/billings/billing-price.test.ts`,
  `web pages/billings/faturamento-previa.test.tsx`.
- **#8H Orçamento — total ao vivo na versão em rascunho** (2026-09-05).
  Quantidade e preço deixaram de ser campos não-controlados: o texto vive na
  tela, e o total da linha e o "Total da proposta (prévia)" acompanham a
  digitação pela mesma conta do documento (`calcularTotaisOrcamento` +
  `buildPaymentSchedule`, ambos em `@veridi/shared` e usados pela API — o plano
  de pagamento saiu de `apps/api` para lá). Com edição pendente, "Total salvo"
  aparece ao lado; a coluna da lista de versões virou "Total salvo". Gravar
  continua sendo o blur do campo — nenhuma requisição por tecla. Valor ausente
  ou ilegível não vira zero e é dito; versão enviada ou aceita não recalcula.
  `packages/shared/src/quote-math.test.ts`, `modules/projects/projects.test.ts`,
  `web pages/projects/orcamento-previa.test.tsx`.
- **#8A Ordem de Compra — total vivo** (2026-09-05). Linha, rodapé e documento
  passam pela mesma função (`calcularTotaisOrdemCompra`, Decimal, 2 casas só
  na saída — usada também pela API). Em edição o rodapé é "Total (prévia)";
  o gravado aparece só quando difere, rotulado, com "salve o rascunho para
  atualizar"; valor ilegível fica fora e é contado, nunca vira zero.
  `web pages/purchase-orders/oc-total-previa.test.tsx`, `packages/shared/src/purchase-orders.test.ts`.
- **#8B Expedição — já expedido, expedindo agora, restante** (2026-09-05).
  Por produto, ao vivo: "Já expedido (antes desta)" é histórico, "Expedindo
  agora (prévia)" soma as linhas em edição, "Restante após esta expedição" é
  a diferença — `previaDeExpedicaoDoProduto` em `@veridi/shared`. Acima do
  reservado ou do que falta expedir: erro dito e confirmação travada, nunca
  saldo negativo. Toda quantidade passa por `formatQuantity`; o "Total" cru
  entre produtos saiu. Confirmar grava o que a prévia mostrou e só então o
  estoque cai (provado na API). `web pages/shipments/expedicao-previa.test.tsx`,
  `modules/shipments/shipments.test.ts`, `packages/shared/src/shipments.test.ts`.
- **#8C Precificação — prévia da faixa antes de gravar** (2026-09-05). O
  custo da quantidade vem de `POST /pricing-versions/:id/tiers/preview`
  (mesma validação e mesmo caminho da criação, sem gravar); preço, comissão,
  contribuição e markup saem de `computePrice`, agora em `@veridi/shared` e
  usado pela API — um motor só. Operando faltante não vira R$ 0,00; margem +
  comissão ≥ 100% é recusada antes de gravar; o `CalcHint` acompanha a prévia
  e reconcilia. `web pages/pricing/faixa-previa.test.tsx`,
  `modules/pricing/pricing.test.ts`, `packages/shared/src/pricing-math.test.ts`.

- **#12 Estimativa de custo da Formulação** — usa `selectItemCostSource`, a
  mesma seleção do cálculo de custo e do CMV: 30d → 90d → última compra →
  oferta válida → referência manual → desconhecido; oferta ambígua fica em
  "seleção necessária" sem cair para a manual; material do cliente é "não
  aplicável" mesmo com compra ou referência no item; `referenceDate` explícita
  (a rota decide "hoje"). A tela mostra a origem de cada componente e o que
  fazer quando falta. Provado em `modules/costs/formulation-cost-estimate.test.ts`
  (A–L, incluindo Formulação × motor do CMV com a mesma fonte e o mesmo custo
  unitário). Nenhum segundo seletor.
- **#9 `CalcHint` conferido** — "CMV por unidade" explicava "÷ lote de
  referência"; o motor divide pela quantidade SIMULADA (`perUnit = total /
  quantity`, provado em `product-cmv.test.ts`). Explicação corrigida e
  conferência ligada com `numero` nos operandos; "Preço sugerido" (P = C ÷
  (1 − margem − comissão), `computePrice`) conferido no diálogo de política e
  na tabela de precificação. Divergência provocada acende o alerta; o valor
  autoritativo continua vindo do domínio.
- **#3 Validação inline da Formulação** — cada campo inválido recebe
  `aria-invalid` e mensagem por `aria-describedby` que nomeia componente e
  campo ("MP-000003 — Quantidade deve ser maior que zero."); salvar e ativar
  levam foco e rolagem ao primeiro erro, abrindo o painel de ajustes quando o
  erro mora lá; todos ficam marcados; a próxima tentativa vai ao seguinte;
  digitar nunca rola; recusa do servidor cai no campo certo.
  `pages/formulations/validacao-inline.test.tsx`.
- **#5 Nomenclatura dos modos** — "Quantidade física informada" e "Calcular
  quantidade física", com as descrições decididas pelo PO na tela e na ajuda;
  enum interno intacto, sem migration; zero texto antigo visível.
- **#4 Densidade da tabela de componentes — RESOLVIDO COM RESIDUAL ACEITO.**
  Medido com oito componentes: 1681px antes em todas as larguras; depois,
  1045px em 1280×800, 1088px em 1440×900 e 1548px em 1920×1080 (áreas úteis
  928/1088/1548). Sete colunas em vez de dez, larguras mínimas por coluna,
  cabeçalho que quebra linha; zero célula truncada, nenhuma regressão
  funcional. Decisão de PO (2026-09-04): em 1280×800 permanece
  aproximadamente 117px de rolagem horizontal; em 1440×900 e superiores a
  tabela cabe integralmente. Residual aceito pelo PO; reabrir somente se
  validação operacional demonstrar impacto.

- **#7a "Dashboard" → "Painel"** — publicado: menu, título e interface visível
  sem "Dashboard".
- **#13 Reconstrução de banco vazio** — cadeia de migrations reconstrói banco
  vazio; `pnpm validate:migrations:fresh` verde; `scripts/migration-order.test.ts`
  em `pnpm test`; produção com `migrate status` em dia. A migration histórica
  antiga permanece registrada, de propósito, nos bancos que a executaram —
  nenhuma limpeza manual de `_prisma_migrations` é necessária. Detalhe em
  [`TECH_BASELINE.md`](TECH_BASELINE.md), *Migration order*.

## H. Roadmap

Escopo futuro não fica aqui. **Produto próprio Veridi** (Product sem cliente
obrigatório, estoque próprio de PA, venda do mesmo PA a vários clientes) vive
em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md); `Product.customerId`
permanece obrigatório no escopo atual.

---

## Ordem de execução definida pelo PO (2026-09-04)

1. **Rodada 1 — aprovada:** #12 + #9 + #3 + #5 resolvidos; #4 resolvido com
   residual aceito em 1280×800.
2. **Rodada 2 — aprovada e publicada:** #8A + #8B + #8C resolvidos.
3. **Rodada 3 — aprovada e publicada:** #8D + #8H resolvidos.
4. **Rodada 4 — aprovada e publicada:** #15 + #16 resolvidos; #18 registrado;
   #8E, #8F e #8G quando o PO autorizar.
5. **Auditoria PREC-01 — aprovada e publicada em 2026-09-05**, só documentação.
   #19, #20 e #21 registrados; a auditoria exigida por #18 está cumprida e #18
   desbloqueado; decomposição PREC-MIG/SER/FMT/UI aprovada na seção E.
6. **Fundação de precisão A — entregue em 2026-09-05:** #20 (motor canônico em
   40 dígitos) + **PREC-MIG-A** (QUANTITY e fatores técnicos em
   `DECIMAL(24,12)`), com preservação ponta a ponta e migration sem backfill.
7. **Fundação de precisão B — entregue em 2026-09-05:** **PREC-MIG-B**
   (UNIT_COST em `DECIMAL(20,8)`), com o custo real de 8 casas preservado do
   banco até o seletor canônico e a média ponderada.
8. **PRÓXIMA CAPABILITY:** **PREC-MIG-P** (HIGH, com
   PREC-SER-02), D residual, PREC-SER-01, PREC-FMT-01, #18 e PREC-MIG-E
   conforme as respostas de domínio.
8. **Validação com a Veridi:** #7 + #11.
9. **Manutenção:** #10 e #17. #1 e #2 permanecem observação/adiados.
10. **Rodada técnica isolada:** #14 (Schema Integrity Audit).
11. **Roadmap:** preferências de exibição (PREC-UI-01 a 08) e produto próprio
    Veridi.

**Precisão numérica — ordem obrigatória.** #20 antes ou junto de #19: ampliar
scale sem ampliar `Decimal.precision` cria coluna que o sistema não consegue
preencher. PREC-SER e PREC-FMT depois do widening, para que a serialização já
espelhe o scale novo. PREC-UI só depois da fundação inteira. A parte do `print`
de #21 é independente e cabe em qualquer rodada. **#18 não entra junto de
nenhuma delas** — duas mudanças concorrentes no mesmo número não se auditam.

## Próximo gate

A validação com a Veridi continua gate para as regras que dependem do processo
real do cliente (#7, #11). Ela **não** impede os itens internos já decididos
pelo PO (agora #8A–#8D, #8H, #15 e #16) quando o PO autorizar a próxima
capability.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

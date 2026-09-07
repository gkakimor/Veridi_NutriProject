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
**PREC-P-01** (`PurchaseOrderLine.unitPrice → DECIMAL(20,8)`) dentro do
PREC-MIG-P.
**Fundação numérica P aprovada pelo PO e publicada em 2026-09-06:**
**PREC-P-01 RESOLVIDO** — UMA coluna, `PurchaseOrderLine.unitPrice` em
`DECIMAL(20,8)`, migration `20260925093004_numeric_precision_unit_price_20_8`,
sem backfill. Na aprovação o PO **ratificou o escopo mínimo como decisão
correta**: nenhum outro preço entra sem decisão própria, e uma migration com um
campo certo vale mais que uma com dez semanticamente duvidosos.
**PREC-MIG-P ficou PARCIAL:** o inventário da família UNIT_PRICE classificou dez
colunas e só uma tinha decisão segura; as quatro técnicas da precificação viraram
**PREC-P-02 a PREC-P-05**.
**Precificação técnica em alta precisão — PREC-P-TECH, aprovada pelo PO e
publicada em produção em 2026-09-06** (merge `b358fd8`, deploy Railway verde;
migration aplicada UMA vez pelo `preDeploy`, `finished`, sem rollback, zero
pendentes; as quatro colunas técnicas em `numeric(20,8)` e as quatro comerciais
ainda em `numeric(14,4)`, conferidas em leitura pura):
**PREC-P-02, P-03, P-04 RESOLVIDOS** (4 colunas em `DECIMAL(20,8)`, migration
`20260925093005_numeric_precision_pricing_technical_20_8`, sem backfill) e
**PREC-P-05 RESOLVIDO POR DECISÃO DE MANTER** `14,4`. Com isso **PREC-MIG-P** e
**PREC-SER-02** ficam **RESOLVIDOS**. O PO registrou como regra durável que
`preço técnico → preço comercial` é uma **fronteira deliberada de fechamento em
quatro casas** ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §60), e estendeu a recusa
de §58 ao lado comercial: preço de documento acima de 4 casas responde HTTP 400.
Na aprovação o PO exigiu **um hardening antes do merge — PREC-ROUND-P01,
RESOLVIDO**: `ROUND_HALF_UP` declarado nas duas fronteiras, sem depender do
default do `decimal.js` (§60 A/B/C).
**Reconciliação monetária da OC — #18, resolvida em 2026-09-06:** o rodapé
passou a ser a soma das linhas impressas (`40,79`, não `40,78`), regra durável
em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §61, sem migration e sem histórico
recalculado.
**PREC-FMT-01 RESOLVIDO em 2026-09-06 — e com ele o #19.** A formatação deixou
de passar por `Number`: `9007199254740993,12` aparecia como
`9.007.199.254.740.994,00` porque o `double` já tinha perdido o dígito antes de
a formatação começar. `lib/decimal-format.ts` formata sobre os dígitos, com
`ROUND_HALF_UP`, e o contrato visual é exatamente o de antes — medido caso a
caso contra o `Intl` e provado por 826 testes web. Regra durável:
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §65. **A cadeia inteira — schema,
persistência, serialização e apresentação — está fechada.**
**PREC-SER-01 RESOLVIDO em 2026-09-06:** o último `.toFixed(6)` técnico saiu da
API — custo unitário de material passou a servir as oito casas da sua coluna, e
a varredura global provou que não há mais nenhum caminho reduzindo precisão de
forma incompatível com a sua categoria.
**PREC-MIG-E RESOLVIDO em 2026-09-06** (PREC-E-01 e PREC-E-02): uma coluna em
`DECIMAL(24,12)`, migration `20260925093007_numeric_precision_quote_industrial_cost_24_12`,
e a categoria **TECHNICAL_TOTAL** formalizada em `14,4` com fronteira explícita
(§63). F-2 e F-3 viraram §64. **A matriz de §58 está aplicada ao schema inteiro.**
**PREC-MIG-D RESOLVIDO e PUBLICADO em 2026-09-06** (PREC-D-01, D-02 e D-03),
merge `8a40b52`, deploy Railway verde — o `preDeploy` aplicou
`20260925093006_numeric_precision_technical_results_24_12` em produção. As três
colunas `14,6` de resultado técnico em `DECIMAL(24,12)`, sem backfill, com a
TERCEIRA fronteira de fechamento — 12 casas, `ROUND_HALF_UP` declarado — como
regra durável ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §62). **PREC-MIG-E: a
classificação semântica das 16 colunas está concluída (§12.3 da auditoria) e a
proposta aguarda o PO — nenhuma migration foi criada.**

---

## A. Defeitos abertos

### 19. `Decimal(18,6)` zera quantidade física derivada em microdosagem — RESOLVIDO

**RESOLVIDO em 2026-09-06.** Uma necessidade de `0,000000048 kg` era gravada
como `0,000000` e sumia da Ordem de Produção — microdosagem em dose pequena
zerava a linha inteira, sem erro visível. Hoje persiste como
`0,000000048000`, provado contra o banco em
`apps/api/src/modules/inventory/precision-round-trip.test.ts`.

O item só fechou quando a cadeia inteira ficou coberta, e cada capability
respondeu por um trecho dela: **#20** ampliou o motor decimal para 40 dígitos;
**PREC-MIG-A a E** aplicaram a matriz de
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §58 ao schema inteiro, com quatro
fronteiras de fechamento nomeadas (§60, §62, §63) e a assimetria entre elas
declarada (§64); **PREC-SER-01** tirou o último corte da serialização; e
**PREC-FMT-01** tirou o float da formatação (§65). Nenhuma migration fez
backfill: casa nunca persistida não se reconstrói.

Detalhe por capability na seção E; inventário e achados em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §12.

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

### 21. Seis serializações de DTO entregam menos casas do que a coluna guarda — RESOLVIDO

**RESOLVIDO / PUBLICADO em 2026-09-06** (merge `0be565c`, deploy Railway verde;
`prisma migrate deploy` respondeu "No pending migrations to apply" — nenhuma
migration nova, como esperado). Desdobrado pelo PO em 2026-09-05 em
PREC-SER-01, PREC-SER-02 e PREC-FMT-01 (seção E), todos fechados; o resíduo
final era o documento impresso.

`print/documents.tsx:353` dividia `requiredQuantity / numberOfParts` em float e
imprimia `X × N` — duas afirmações erradas. A do float era a menor: a grave era
"N partes iguais", que a produção nunca executa. `splitDecimal` trunca as N-1
primeiras em seis casas, `ROUND_DOWN`, e dá o resto à última, para a soma fechar
com o total. Com 2 kg em 3 partes o motor planeja 0,666666 / 0,666666 / 0,666668
e o papel anunciava 0,666667 nas três — um valor que parte nenhuma seria pesada,
somando 2,000001. A Folha de Receita, que é onde a pesagem acontece, mostrava os
números certos: dois documentos GMP da mesma ordem discordavam.

O motor subiu para `@veridi/shared`; a API delega e o impresso reusa. Regra
durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §67.

### 18. Consistência monetária da Ordem de Compra — RESOLVIDO / PUBLICADO

**RESOLVIDO e PUBLICADO em 2026-09-06** (merge `34a5424`, deploy Railway verde;
`prisma migrate deploy` respondeu "No pending migrations to apply" — nenhuma
migration nova, como esperado), depois da fundação de precisão, em capability
própria como o PO exigiu. O total documental da OC passou a reconciliar com as
linhas exibidas: `Σ round(quantidade × preço, 2)` em vez de
`round(Σ valores brutos, 2)`. Regra durável em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) **§61**.

**Acceptance:** `10 × 4,05318764`, `1 × 0,125` e `5 × 0,025` imprimem
`40,53 + 0,13 + 0,13`; o rodapé fechava `40,78` e passa a fechar **`40,79`**,
que é o que quem confere a página obtém somando a coluna.

**Cinco frentes, e o que cada uma fechou:**

| | Frente | Estado |
|---|---|---|
| **#18-A** | A regra: `lineTotal = round(qty × preço, 2)`, `orderTotal = Σ lineTotal`, em `calcularTotaisOrdemCompra` | RESOLVIDO |
| **#18-B** | `ROUND_HALF_UP` declarado na chamada, não herdado do default do `decimal.js` — mesma disciplina de §60 | RESOLVIDO |
| **#18-C** | UMA conta para todas as superfícies: documento, prévia da tela, relatório de Compras e OC vinculada dentro do Pedido. Duas somavam por conta própria | RESOLVIDO |
| **#18-D** | O operando intacto: preço em `DECIMAL(20,8)` e quantidade em `DECIMAL(24,12)` entram inteiros na multiplicação; o fechamento é só da linha | RESOLVIDO |
| **#18-E** | Total documental **não** alimenta custo técnico — `actualUnitCost`, média ponderada, seletor canônico, CMV e precificação intocados | RESOLVIDO |

**Sem migration e sem histórico recalculado.** A OC não persiste dinheiro
nenhum: `PurchaseOrder` e `PurchaseOrderLine` não têm coluna de total, e o
valor é derivado na leitura. Não existe documento congelado para reconciliar —
a leitura de toda OC, nova ou antiga, passa a bater com a própria página.

**Consequência histórica ratificada pelo PO na aprovação:** uma OC antiga que
mostrava `R$ 40,78` pode passar a mostrar `R$ 40,79`. É intencional e **não é
mutação de dado histórico** — zero `UPDATE`, zero snapshot recalculado, zero
backfill; o total nunca esteve gravado. Registrado em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §61.

**#15 intocado.** `calcularTotaisOrcamento` e `calcularTotaisFaturamento` não
foram tocados; a OC tem função própria. O que mudou foi a OC alcançar a mesma
FORMA de fechamento dos documentos comerciais, não passar a usar a função
deles.

**Como o achado nasceu.** Rodada 4: `calcularTotaisOrdemCompra` somava as
linhas em precisão cheia e arredondava só na saída — `round(Σ valores brutos)`
—, enquanto os documentos comerciais já usavam
`Σ round(valor monetário da linha, 2)` ([`PRODUCT_RULES.md`](PRODUCT_RULES.md)
§55). O PO exigiu capability própria, depois da fundação de precisão, e uma
auditoria antes de mexer na aritmética.

**Auditoria PREC-01 (2026-09-05) — o que ficou provado**, e que sustentou a
correção:

- **Nada da OC é persistido em dinheiro.** `PurchaseOrder` e `Receipt` não têm
  nenhuma coluna de total; o total é sempre derivado na leitura. Não existe
  documento histórico congelado para reconciliar nem backfill possível.
- **O preço unitário preciso é preservado**: `PurchaseOrderLine.unitPrice`,
  hoje `DECIMAL(20,8)` (PREC-P-01), nunca arredondado além da própria coluna.
- **O custo de aquisição não vem da OC.** É `ReceiptLine.actualUnitCost`,
  informado por pessoa. `lib/cost-reference.ts` recusa explicitamente o preço da
  OC como fallback: sem custo real histórico o resultado é `NO_COST`, nunca o
  preço da compra.
- **Recebimento parcial** usa `ReceiptLine.receivedQuantity` `Decimal(18,6)`,
  independente do total do documento.
- **Custo efetivo** é `Σ(receivedQuantity × actualUnitCost) ÷ Σ receivedQuantity`
  em `Decimal`, sem arredondamento intermediário.

**Conclusão da auditoria:** o custo industrial **não** consome o total
documental arredondado da OC em ponto nenhum. A divergência era exclusivamente
de apresentação documental, e trocar `round(Σ)` por `Σ round()` não contamina
custo, CMV nem precificação. A correção de 2026-09-06 confirmou isso em teste:
sem recebimento, o item continua `NO_COST` mesmo com a OC precificada.

**O PREC-MIG-P (2026-09-06) caracterizou o defeito antes de corrigi-lo**, e o
cenário ficou congelado em
`apps/api/src/modules/purchase-orders/unit-price-precision.test.ts` exigindo o
comportamento antigo — para que a correção fosse uma mudança visível e
deliberada, não efeito colateral. Esta capability virou aquele teste para o
comportamento novo, no mesmo arquivo e com a diferença explicada.

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

**Fundações A, B, C, P e D entregues** (#20 + PREC-MIG-A/B/C, PREC-P-01,
PREC-P-TECH e PREC-D-01/02/03). Faltam o PREC-MIG-E, o PREC-SER-01 e o
PREC-FMT-01.

### Migrations de widening

| Item | Escopo | Status |
|---|---|---|
| **PREC-MIG-A** | QUANTITY e grandezas inequivocamente técnicas → `DECIMAL(24,12)`, incluindo fatores de conversão | **RESOLVIDO** — 43 colunas (39 QUANTITY + 1 FACTOR + 3 TECHNICAL_RESULT), migration `20260925093001_numeric_precision_quantities_24_12` |
| **PREC-MIG-B** | UNIT_COST e `ReceiptLine.actualUnitCost` → `DECIMAL(20,8)` | **RESOLVIDO** — 3 colunas, migration `20260925093002_numeric_precision_unit_cost_20_8` |
| **PREC-MIG-C** | Pureza e overage → `DECIMAL(9,6)` | **RESOLVIDO** — 7 colunas, migration `20260925093003_numeric_precision_purity_overage_9_6` |
| **PREC-MIG-D** | Resultados técnicos persistidos → `DECIMAL(24,12)` onde aplicável | **RESOLVIDO** — 3 campos entregues no A + 3 no D, migration `20260925093006_numeric_precision_technical_results_24_12`. `14,6` deixou de existir no schema |
| **PREC-MIG-E** | Campos que ainda exigem decisão individual | **RESOLVIDO** — 16 colunas classificadas e decididas pelo PO em 2026-09-06: 1 migração (`20260925093007_numeric_precision_quote_industrial_cost_24_12`) e 15 MANTER como TECHNICAL_TOTAL. `18,6` só resta nos dois `legacy*` |
| **PREC-E-01** | `QuoteLine.industrialCostPerUnitSnapshot` `18,6` → `DECIMAL(24,12)` | **RESOLVIDO** — 1 coluna, sem backfill. Congelamento passa por `fecharResultadoTecnicoPersistido` |
| **PREC-E-02** | Fronteira de fechamento nos 6 totais de `PricingTier` | **RESOLVIDO** — escala mantida em `14,4`, categoria TECHNICAL_TOTAL formalizada (§63) e fechamento explícito em `fecharTotalTecnicoPersistido`. Zero migration |
| **PREC-ROUND-E01** | `ROUND_HALF_UP` explícito nas fronteiras novas do E | **RESOLVIDO** — `lib/technical-total.ts`, com teste que sobrevive à troca do `Decimal.rounding` global |
| **PREC-D-01** | `PricingTier.commissionPerUnitSnapshot` `14,6` → `DECIMAL(24,12)` | **RESOLVIDO** — PREC-MIG-D |
| **PREC-D-02** | `PricingTier.contributionPerUnitSnapshot` `14,6` → `DECIMAL(24,12)` | **RESOLVIDO** — PREC-MIG-D |
| **PREC-D-03** | `QuoteLine.contributionPerUnitSnapshot` `14,6` → `DECIMAL(24,12)` | **RESOLVIDO** — PREC-MIG-D. Cópia congelada no ENVIO da proposta |
| **PREC-ROUND-D01** | `ROUND_HALF_UP` explícito na fronteira de persistência do resultado técnico | **RESOLVIDO** — `lib/technical-result.ts`, regra em §62 |
| **PREC-MIG-P** | UNIT_PRICE que precisa preservar alta precisão | **RESOLVIDO** — PREC-P-01 e PREC-P-TECH entregues; nenhum UNIT_PRICE pendente |
| **PREC-P-01** | `PurchaseOrderLine.unitPrice` → `DECIMAL(20,8)` | **RESOLVIDO** — 1 coluna, migration `20260925093004_numeric_precision_unit_price_20_8` |
| **PREC-P-02** | `PricingTier.manualUnitPrice` → `DECIMAL(20,8)` | **RESOLVIDO** — PREC-P-TECH. Acima de 8 casas a API recusa, na criação e na edição da faixa |
| **PREC-P-03** | `PricingTier.suggestedPriceSnapshot` e `.selectedPriceSnapshot` → `DECIMAL(20,8)` | **RESOLVIDO** — PREC-P-TECH. A redução de 40 dígitos para 8 passou a acontecer no domínio, antes do `update`; o banco deixou de ser a primeira camada de arredondamento |
| **PREC-P-04** | `QuoteLine.pricingSelectedUnitPriceSnapshot` → `DECIMAL(20,8)` | **RESOLVIDO** — PREC-P-TECH. Proveniência técnica com 8 casas ao lado do preço comercial de 4, na mesma linha e de propósito |
| **PREC-P-05** | `QuoteLine.unitPrice` (`14,4`) | **RESOLVIDO POR DECISÃO DE MANTER** — o PO ratificou `14,4` em 2026-09-06: é o preço do documento comercial, §58 e §60. Entrada acima de 4 casas passou a ser recusada |
| **PREC-P-TECH** | Os 4 preços técnicos da precificação → `DECIMAL(20,8)` + fronteira explícita de fechamento comercial | **RESOLVIDO** — 4 colunas, migration `20260925093005_numeric_precision_pricing_technical_20_8` |
| **PREC-ROUND-P01** | `ROUND_HALF_UP` explícito nas duas fronteiras de precisão, sem depender do default do `decimal.js` | **RESOLVIDO** — hardening exigido pelo PO na aprovação; `technical-price.ts` e `commercial-price.ts`, regra em §60 A/B/C |

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

**PREC-MIG-P — UNIT_PRICE de alta precisão. RESOLVIDO.** Decisão do PO de
2026-09-05: um preço unitário de compra pode legitimamente ter mais de quatro
casas — `4,05318764` —, e o banco deve preservar o valor preciso mesmo quando a
tela mostra menos. **PREC-P-01 entregue em 2026-09-06**, uma coluna:
`PurchaseOrderLine.unitPrice` em `DECIMAL(20,8)`, migration
`20260925093004_numeric_precision_unit_price_20_8`, sem backfill. Medido contra
o PostgreSQL antes de migrar: `4.05318764::decimal(14,4)` devolvia `4.0532`.
Agora persiste inteiro, e acima de oito casas a fronteira **recusa** — criação e
edição da OC — em vez de deixar o banco arredondar a nona.

A serialização foi junto, na fatia que a família exigia (**PREC-SER-02
PARCIAL**): o DTO da OC servia `toFixed(4)` e a tela devolve ao servidor o que
recebe, então abrir e salvar sem editar bastava para gravar o valor cortado. O
mesmo preço servido como referência no Recebimento também subiu para oito casas
— ali **não era só apresentação**: o atalho "Usar preço da OC" copia esse valor
para `ReceiptLine.actualUnitCost`, que é `DECIMAL(20,8)`.

**Auditoria read-only de 2026-09-06, depois da publicação.** O mapa de perda da
cadeia inteira — motor, faixa, orçamento, pedido, faturamento e impressão — está
em [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §10.2, com o
primeiro ponto onde oito casas viram seis e onde seis viram quatro.

**Lacuna de §58 — FECHADA no PREC-P-TECH.** As quatro fronteiras de entrada de
preço que aceitavam qualquer número de casas ganharam teto, nos dois sentidos da
fronteira: `manualUnitPrice` recusa acima de **8** casas; `QuoteLine.unitPrice`,
o preço faturado em lote e o override de faturamento recusam acima de **4**. A
mudança é visível de propósito — um valor mais longo que a coluna passa a falhar
onde antes passava calado.

**O inventário completo da família está em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §10.1**, com as dez
colunas de preço classificadas por uso real. Na Fundação P só uma tinha decisão
segura; os quatro preços técnicos da precificação viraram **PREC-P-02 a
PREC-P-05** porque a cadeia `PricingTier.selectedPriceSnapshot →
QuoteLine.pricingSelectedUnitPriceSnapshot → QuoteLine.unitPrice` congela dentro
de documento comercial e move-se inteira ou não se move.

**PREC-P-TECH — entregue em 2026-09-06.** O PO decidiu, e a cadeia moveu-se
inteira: quatro colunas de `Decimal(14,6)` para `DECIMAL(20,8)`, migration
`20260925093005_numeric_precision_pricing_technical_20_8`, sem backfill.
`PricingTier.manualUnitPrice`, `.suggestedPriceSnapshot`,
`.selectedPriceSnapshot` e `QuoteLine.pricingSelectedUnitPriceSnapshot`.

O que a migration sozinha não resolveria veio junto:

- **a fronteira técnica → comercial virou regra durável** —
  [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §60. O fechamento de 8 para 4 casas
  acontece em `fecharPrecoUnitarioComercial`, com nome, rounding mode do produto
  e teste, no vínculo da faixa com a linha do Orçamento. Não por scale de
  coluna, não por formatter, não por `Number`, não incidentalmente;
- **o banco deixou de ser a primeira camada de arredondamento** — a ativação
  reduz o resultado de 40 dígitos do motor para oito casas antes do `update`;
- **serialização técnica em 8 casas** — DTO da faixa, prévia, prévia de rebase,
  proveniência do Orçamento, CMV do produto, relatório de precificação e prévia
  de política de preço;
- **os quatro validators sem teto**, acima.

`QuoteLine.unitPrice` **permanece** em `14,4`, por decisão. Uma linha com
`pricingSelectedUnitPriceSnapshot = 4,05318764` e `unitPrice = 4,0532` está
certa: são duas perguntas diferentes, e as duas têm resposta própria.

**Perda registrada aqui, CORRIGIDA no PREC-MIG-D:**
`PricingTier.commissionPerUnitSnapshot`, `.contributionPerUnitSnapshot` e
`QuoteLine.contributionPerUnitSnapshot` ficaram em `Decimal(14,6)` até
2026-09-06, cortadas pelo PostgreSQL na sétima casa. Saem do mesmo motor, mas a
categoria é TECHNICAL_RESULT, e por isso o alvo foi `DECIMAL(24,12)` e não
`20,8` — §62.

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
`IndustrialCostCalculation.costPerUnit`, também `24,12`. O residual que sobrou
para o PREC-MIG-E (`14,4` e `18,6`) é composição de custo e de CMV — não recebe
o resultado de pureza/overage, e por isso não limita o benefício desta
capability.

**PREC-MIG-D — ENTREGUE em 2026-09-06, em duas partes.** Três resultados
técnicos que já estavam em `Decimal(18,6)` viajaram junto do PREC-MIG-A, porque
o alvo deles é o mesmo `DECIMAL(24,12)` e separá-los criaria uma segunda
migration sobre as mesmas tabelas:

- `IndustrialCostCalculation.costPerUnit`
- `PricingTier.costPerUnitSnapshot`
- `ProductionOrderCostSnapshot.costPerProducedUnit`

**Esses três estão ENTREGUES no A e NÃO foram remigrados.** As três colunas
`14,6` que o PREC-P-TECH deixou para trás de propósito subiram agora, migration
`20260925093006_numeric_precision_technical_results_24_12`, sem backfill:

- `PricingTier.commissionPerUnitSnapshot` — `preço selecionado × comissão%`
- `PricingTier.contributionPerUnitSnapshot` — `preço − comissão − custo`
- `QuoteLine.contributionPerUnitSnapshot` — a mesma contribuição, congelada no
  ENVIO da proposta; cópia da faixa através do DTO de proveniência, não
  recálculo

Medido contra o PostgreSQL antes de migrar: `'0.2026593333333333'::decimal(14,6)`
devolvia `0.202659` e `::decimal(24,12)` devolve `0.202659333333`. **Seis casas.**
Quem cortava era o banco, no `UPDATE` da ativação, sem `.toFixed()` no código.

O que a migration sozinha não resolveria veio junto:

- **a fronteira de persistência do resultado técnico virou regra durável** —
  [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §62, a TERCEIRA fronteira depois das
  duas de §60. `fecharResultadoTecnicoPersistido` (`lib/technical-result.ts`)
  fecha em doze casas com `ROUND_HALF_UP` **declarado na chamada**;
- **o banco deixou de ser a primeira camada de arredondamento** nos três pontos
  de persistência: os dois da ativação (`pricing.service.ts`) e o congelamento
  da proveniência (`quote-pricing.service.ts`);
- **serialização técnica em 12 casas** — DTO da faixa, prévia da faixa,
  proveniência do Orçamento, relatório de precificação, prévia de política de
  preço e prévia de rebase. A prévia fecha pela MESMA fronteira da ativação, e
  o teste exige que os dois números sejam iguais;
- **a matriz perdeu a precisão `14,6`** — `numeric-precision-matrix.test.ts`
  falha se ela reaparecer.

**Precisão de armazenamento não virou precisão de tela.** A tabela de faixas
continua mostrando `R$ 0,65` — `formatUnitCost`, apresentação (§57). Comissão e
contribuição por unidade são resultado DERIVADO: ninguém as digita, e nenhum
caminho da tela as devolve ao servidor. A ativação manda só as confirmações.

**Nada comercial se moveu.** `QuoteLine.unitPrice` continua em `14,4`, o total
da linha e o subtotal continuam saindo de §55 sobre o preço comercial, e #15 e
#18 estão intocados. Resultado técnico é leitura econômica, nunca operando de
total.

**O residual foi para o PREC-MIG-E, não para o D.** O inventário do PREC-MIG-D
classificou 107 colunas `Decimal` do schema e encontrou **três** TECHNICAL_RESULT
residuais inequívocos — exatamente os três que o PO já tinha classificado.
Ficaram de fora, como `NEEDS_PO_DECISION`:

- **os seis `PricingTier.*Snapshot` de TOTAIS** (`costTotal`, `costPer1000`,
  `knownSubtotal`, `commissionTotal`, `grossRevenue`, `contributionTotal`), em
  `14,4`;
- **`IndustrialCostCalculation.*`** (`directIndustrialCost`, `overheadCost`,
  `totalIndustrialCost`, `knownSubtotal`, `costPer1000`) e
  **`ProductionOrderCostSnapshot.*`** (`actualMaterialCostKnown`,
  `standardAppliedCostKnown`, `knownSubtotal`, `totalIndustrialCost`), em `14,4`
  — composição do custo industrial e do CMV;
- **`QuoteLine.industrialCostPerUnitSnapshot`**, em `18,6` — **prioridade alta
  no E**. É resultado técnico POR UNIDADE, e a sua origem
  (`PricingTier.costPerUnitSnapshot`) já está em `24,12`: o congelamento copia
  doze casas para uma coluna de seis. Mas o inventário o registra viajando com o
  PREC-MIG-B, que fechou como UNIT_COST — alvo conflitante é decisão do PO, não
  do implementador;
- **as quatro `rateValue`** — categoria RATE: tarifa é entrada, não resultado.

O motivo comum é o mesmo: a auditoria recomendou `20,8` para eles dentro de um
PREC-MIG-B que o PO fechou como UNIT_COST, e o alvo ficou **órfão**. Escolher
entre `20,8` e `24,12` é decisão de categoria, e o handoff do PREC-MIG-D proíbe
usar D como balde de resto.

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

**PREC-MIG-E — ENTREGUE em 2026-09-06.** A classificação semântica das 16
colunas (abaixo) foi aprovada pelo PO, e a capability entregou **uma** migration
e **uma** categoria durável nova:

- **PREC-E-01** — `QuoteLine.industrialCostPerUnitSnapshot` de `Decimal(18,6)`
  para `DECIMAL(24,12)`, migration
  `20260925093007_numeric_precision_quote_industrial_cost_24_12`, sem backfill.
  Medido contra o PostgreSQL antes de migrar: `(1000.00/300)::numeric(24,12)`
  vale `3.333333333333` e o mesmo em `numeric(18,6)` vale `3.333333` — seis
  casas, cortadas pelo banco no congelamento da proveniência. O `update` passou
  a fechar por `fecharResultadoTecnicoPersistido` (§62);
- **PREC-E-02** — os seis totais de `PricingTier` **mantêm** `DECIMAL(14,4)`, e
  o fechamento passou a ser do domínio: `fecharTotalTecnicoPersistido`, quatro
  casas, `ROUND_HALF_UP` declarado. Zero migration, zero mudança de schema. A
  categoria **TECHNICAL_TOTAL** virou regra durável
  ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §63), com o princípio que a sustenta:
  a escala de uma coluna acompanha o papel do valor e o alcance real do dado,
  não a escala da coluna vizinha. Nenhum consumidor desses seis campos recebe
  mais de duas casas;
- **F-2 e F-3 viraram §64** — fronteiras diferentes não se reproduzem entre si,
  e isso é a regra, não defeito. Com o limite explícito: a assimetria vive
  DENTRO da fronteira, e a divergência **visível** continua proibida.

São agora quatro fronteiras nomeadas, uma por categoria: doze casas para
resultado técnico (§62), oito para preço técnico (§60 A), quatro para total
técnico (§63) e quatro para o fechamento comercial (§60 B).

**As nove colunas de `IndustrialCostCalculation` e `ProductionOrderCostSnapshot`
ficaram intocadas**, e não por dúvida: o motor já fecha esses valores em duas
casas antes de gravar, então a coluna de quatro recebe um número de duas e não
há corte a corrigir. Quatro delas não são lidas de volta — registradas como
`CURRENTLY_REDUNDANT`, **não** como candidatas a remoção. Apagar coluna é outra
decisão.

**A classificação que embasou tudo isso:**
As 16 colunas que o inventário do D deixou como `NEEDS_PO_DECISION` foram
classificadas pelo PAPEL do valor, campo a campo, em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §12.3. O resultado
separa os três grupos que pareciam iguais:

- **`QuoteLine.industrialCostPerUnitSnapshot` (`18,6`) — o único que pediu
  migration.** É TECHNICAL_RESULT: custo industrial POR UNIDADE, resultado de
  `total ÷ quantidade da faixa`, cópia de `PricingTier.costPerUnitSnapshot`, que
  está em `DECIMAL(24,12)` desde o PREC-MIG-A. O congelamento da proveniência
  serializava doze casas e a coluna guardava seis: o PostgreSQL cortava a
  sétima. **ENTREGUE como PREC-E-01**;
- **os 9 de `IndustrialCostCalculation` e `ProductionOrderCostSnapshot`
  (`14,4`) — MANTER, sem discussão.** O motor já fecha esses valores em DUAS
  casas (`money()`) antes de gravar; a coluna de quatro recebe um número de
  duas. Widening não recuperaria nada, porque o banco nunca chegou a arredondar.
  Quatro delas (`directIndustrialCost`, `overheadCost` e as quatro do CMV) nem
  sequer são lidas de volta: o DTO vem do JSON do snapshot;
- **os 6 totais de `PricingTier` (`14,4`) — MANTER a escala, CORRIGIR a
  fronteira.** Aqui o banco **é** a primeira camada de arredondamento: a
  ativação grava `entry.cost.total` e os outros cinco direto do motor, em 40
  dígitos, e o `INSERT` corta a quinta casa. Mas nenhum consumidor recebe mais
  de duas casas — o DTO da faixa serve todos por `money()`. O que falta é
  fechamento explícito no domínio, §62, não escala — **PREC-E-02**.

Dois achados registrados sem ação: o total persistido do CALC não reproduz o
custo por unidade persistido (F-2), e há assimetria deliberada entre
`contributionPerUnitSnapshot` em doze casas e `contributionTotalSnapshot` em
quatro (F-3). Os dois são §57 funcionando, e precisam estar escritos para não
voltarem como defeito.

### Serialização e formatação

| Item | Escopo | Status |
|---|---|---|
| **PREC-SER-01** | DTOs cuja serialização com `.toFixed()` corta a precisão técnica antes da UI | **RESOLVIDO** — 2026-09-06. `unitMoney` (6 casas) eliminado; os quatro pontos de custo unitário de material passaram a `custoUnitario` (8). Varredura global: zero `.toFixed(6)` na API, e todo `.toFixed(4)`/`(2)` restante é o scale da própria categoria |
| **PREC-SER-02** | Gravação de preço técnico de 6 casas em coluna de 4 quando **não** for snapshot contratual | **RESOLVIDO** — PREC-P-01 (`purchase-orders.service.ts`, `receiving.service.ts`) e PREC-P-TECH (`pricing.service.ts`, `quote-pricing.service.ts`, `cost-reports.service.ts`, `product-cmv.service.ts`, `pricing-policies.service.ts`). A família UNIT_PRICE inteira está coberta |
| **PREC-FMT-01** | Eliminar `Number` nos formatters para grandeza técnica de alta precisão | **RESOLVIDO** — 2026-09-06. `lib/decimal-format.ts` formata por texto; `formatBRL`, `formatUnitCost`, `formatUnitPriceBRL`, `formatPercent` e `formatQuantity` não passam mais por float, e o contrato visual não mudou (826 testes web verdes). Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §65 |
| **PREC-CMP-01** | Comparação de quantidade `Decimal` via JavaScript `Number` em política/faixa | **RESOLVIDO** — 2026-09-06. `pricing-policies.service.ts` passou a `Decimal.equals`; o defeito foi reproduzido no serviço real (a política declarava duas faixas e a versão nascia com uma) antes de corrigido. Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §66 |
| **PREC-CMP-02** | Comparação de faixa ignora a unidade de medida | **RESOLVIDO / PUBLICADO em 2026-09-07** (merge `d7b150f`, deploy Railway verde; `prisma migrate deploy` respondeu "No pending migrations to apply"). A identidade da faixa passou a ser a quantidade FÍSICA normalizada na unidade do Item de produto acabado: `1 kg` e `1000 g` são a mesma faixa, `500 g` e `500 kg` são duas. Uma função canônica serve aplicação de política, criação manual e edição; a faixa nasce na unidade do produto e o template preserva a sua. Conversão oficial, `Decimal` de ponta a ponta, zero migration. Regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §68 |

**PREC-SER-01 — FECHADO em 2026-09-06.** O último residual era
`unitMoney` (`toFixed(6)`) em `industrial-cost-calculation/calculation.service.ts`,
usado em quatro pontos, todos custo unitário de MATERIAL: o custo resolvido pelo
seletor canônico, a fonte automática de um override, a referência manual e o
custo do lote consumido no CMV. As três fontes — `ReceiptLine.actualUnitCost`,
`ItemCostReference.unitCost` e a oferta lida como custo — são `DECIMAL(20,8)`
desde o PREC-MIG-B, e o que chega ali ainda pode ter passado por média
ponderada ou conversão de unidade, duas divisões.

**Não era só apresentação.** Esse DTO é o `result` gravado no snapshot do CALC:
o corte de duas casas ficava **congelado no documento histórico**, não na tela.
A função foi removida e os quatro pontos passaram a `custoUnitario` — oito
casas, o helper canônico da família, que já servia todos os outros caminhos de
UNIT_COST. Zero mudança de fórmula, de schema ou de persistência.

**Matriz de serialização, revalidada por varredura global:**

| Categoria | Storage | API | Display | Helper canônico |
|---|---|---|---|---|
| QUANTITY / FACTOR | `24,12` | íntegro | conforme formatter | `.toString()` |
| TECHNICAL_RESULT | `24,12` | 12 casas | 2 a 6 | `resultadoTecnico` |
| UNIT_COST | `20,8` | 8 casas | 2 a 6 | `custoUnitario` |
| UNIT_PRICE técnico | `20,8` | 8 casas | 2 a 4 | `precoUnitario` |
| TECHNICAL_TOTAL | `14,4` | 2 ou 4 casas | 2 | `money` local / `toFixed(4)` |
| UNIT_PRICE comercial | `14,4` | 4 casas | 2 a 4 | `toFixed(4)` / `csvUnitPrice` |
| COMMERCIAL_TOTAL | `14,2` | 2 casas | 2 | `toFixed(2)` |
| PERCENT | `7,4` | 4 casas | 2 a 4 | `toFixed(4)` |
| RATE | `14,4` | íntegro | 2 | `.toString()` |

**Zero `.toFixed(6)` na API.** Os três em `scripts/` são texto de diagnóstico do
corpus do legado e o `overagePercent` do importador — este último em `9,6`, que
é o scale da coluna. Todo `.toFixed(4)` restante é percentual, preço comercial
ou total técnico; todo `.toFixed(2)` é total comercial fechado. Nenhum
`parseFloat`, e o único `toNumber()` da API é `batchCountSnapshot`, coluna
`Int`.

**PREC-FMT-01 continua ABERTO e separado.** `formatUnitCost` e `formatBRL`
seguem usando `Number` para apresentação; a auditoria confirmou que **nenhum**
caminho da tela recalcula negócio a partir disso — `CalcHint` refaz a conta
apenas para conferir a explicação contra o valor que o servidor mandou, com
tolerância derivada das casas exibidas.

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
8. **Fundação de precisão C — entregue em 2026-09-06:** **PREC-MIG-C**
   (PURITY/OVERAGE em `DECIMAL(9,6)`), com a recusa acima do scale registrada
   como regra de produto em §58.
9. **Fundação de precisão P — entregue em 2026-09-06:** **PREC-P-01**
   (`PurchaseOrderLine.unitPrice` em `DECIMAL(20,8)`) mais a fatia de
   **PREC-SER-02** dos campos migrados. **PREC-MIG-P ficou PARCIAL**: PREC-P-02 a
   PREC-P-05 eram NEEDS_PO_DECISION.
10. **Precificação técnica em alta precisão — PREC-P-TECH, entregue em
    2026-09-06:** **PREC-P-02, P-03 e P-04** (os quatro preços técnicos em
    `DECIMAL(20,8)`) e **PREC-P-05 resolvido por decisão de MANTER** `14,4`. A
    fronteira `técnico → comercial` virou regra durável (§60), a redução para
    oito casas passou a acontecer no domínio e as quatro entradas de preço
    ganharam teto de casas. **PREC-MIG-P e PREC-SER-02 RESOLVIDOS.**
11. **#18 — reconciliação monetária da Ordem de Compra, entregue em
    2026-09-06:** o total documental passou a ser `Σ round(quantidade × preço,
    2)`, com `ROUND_HALF_UP` declarado, uma conta só para todas as superfícies e
    o operando intocado. Sem migration, sem histórico recalculado, §61.
12. **PREC-MIG-D, entregue em 2026-09-06:** as três colunas `14,6` de resultado
    técnico em `DECIMAL(24,12)`, com a terceira fronteira de fechamento (12
    casas, `ROUND_HALF_UP` declarado) como regra durável, §62. `14,6` saiu do
    schema. **PRÓXIMA CAPABILITY: PREC-MIG-E** — 16 colunas sem alvo decidido —,
    depois PREC-SER-01 e PREC-FMT-01.
13. **Validação com a Veridi:** #7 + #11.
14. **Manutenção:** #10 e #17. #1 e #2 permanecem observação/adiados.
15. **Rodada técnica isolada:** #14 (Schema Integrity Audit).
16. **Roadmap:** preferências de exibição (PREC-UI-01 a 08) e produto próprio
    Veridi.

**Precisão numérica — ordem obrigatória.** #20 antes ou junto de #19: ampliar
scale sem ampliar `Decimal.precision` cria coluna que o sistema não consegue
preencher. PREC-SER e PREC-FMT depois do widening, para que a serialização já
espelhe o scale novo. PREC-UI só depois da fundação inteira. A parte do `print`
de #21 é independente e cabe em qualquer rodada. **#18 não entrou junto de
nenhuma delas**, de propósito — duas mudanças concorrentes no mesmo número não
se auditam; foi capability própria, depois da fundação inteira.

## Próximo gate

A validação com a Veridi continua gate para as regras que dependem do processo
real do cliente (#7, #11). Ela **não** impede os itens internos já decididos
pelo PO (agora #8A–#8D, #8H, #15 e #16) quando o PO autorizar a próxima
capability.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

# Histórico do backlog auditado

> **Arquivo histórico. Não precisa ser carregado para trabalho cotidiano.
> Consultar somente para investigar decisão/finding anterior.**

Findings das auditorias operacionais VAL-LEG-01, VAL-LEG-02 e VAL-LEG-03, do
hardening pré-cliente e do polimento visual final — com causa, correção e
release associada. O finding é o que justifica a regra: o texto fica aqui, a
regra durável fica em [PRODUCT_RULES.md](../PRODUCT_RULES.md).

Pendências realmente abertas hoje estão em [BACKLOG.md](../BACKLOG.md).

---

# Findings from the VAL-LEG-01 operational audit

Case 01 of the operational audit was run in production against the published
UI, using legacy Veridi data, on release `24de17a`. Two findings were
promoted out of this list and fixed (`d76afe7`): the per-dose formulation
CRITICAL and the customer typeahead HIGH. What follows is what stayed open.

None of these are in MVP scope. They are here because a real operator hit
each one while trying to take a real product from customer to cost.

## Item x Supplier is a two-step registration — MEDIUM · RESOLVIDO

The grid shows Qualification, Preferred, Price and MOQ. The creation form
offers none of them: it takes item, supplier, supplier code and notes. A
relation is born `Pendente` with no price, and all four fields only exist in
the detail modal afterwards.

Consequence measured: registering four materials produced four relations with
no commercial reference at all, so `resolveMaterialCost` had nothing to fall
back on. Whoever loads suppliers in bulk ends up with a supplier base that
cannot price anything.

Not a bug — the detail modal does the job, and offers are correctly
immutable. The cost is that the fast path produces incomplete records.

**Resolvido** em `fff3b61` (*fix: complete supplier relationship creation*): a
criação passou a aceitar homologação, preferencial e a oferta inicial com
preço, unidade e MOQ na mesma ação. Os quatro campos continuam opcionais —
relação sem oferta segue sendo registro legítimo.

## "New version" of a cost structure drops the energy resource — MEDIUM · RESOLVIDO

Creating a new `IndustrialCostVersion` from an active one carries the
reference base, the resource usages and the energy calculation mode, but not
`energyResourceId` — the resource that turns derived kWh into money.

The new version is therefore reported as `Completa`, and only the calculation
reveals the gap: energy comes out `—` and quality drops to `PARTIAL`. Found
during the hotfix deploy itself; it cost an extra structure version
(`EC-000002` became a discard in practice).

The screen explains it well once it happens — *"Nenhum recurso de energia foi
escolhido para valorizar o consumo derivado dos equipamentos"* — so this is
about the copy being incomplete, not about the message.

**Resolvido**: a nova versão passou a copiar `energyResourceId` junto com o
modo de energia. A tarifa continua sendo resolvida pela data do cálculo; o que
se copia é a escolha de QUAL recurso tarifa a energia. Exercitado no
VAL-LEG-03, onde o TEC aplicado trouxe `REC-000003` e 12 kWh derivados.

## Legacy address arrives as one line — MEDIUM (migration) · RESOLVIDO

`clientes.csv` stores "Rua Vicente Jose de Almeida, n 158, bairro Cupece" in
a single field. The customer form wants Logradouro, Numero and Bairro apart.
Every migrated customer needs a manual split.

This is an import policy question, not a screen defect: whether the importer
parses, or whether the form accepts a single free-form line for migrated
records.

**Resolvido** em `377a5d9` (*feat: validate legacy address and expiry
migration*): o importador decompõe conservadoramente em
`scripts/veridi-data/legacy-address.ts` — logradouro só com tipo conhecido,
número só quando rotulado ou puramente numérico, bairro só quando rotulado. O
que não dá para afirmar fica `null` e gera `ADDRESS_PARSE_REVIEW_REQUIRED`, com
a string original preservada nas notas de migração. Regra durável em
`PRODUCT_RULES.md` §38; política e números do corpus em `VERIDI_MIGRATION.md`.

## Legacy expiry dates are all in the past — MEDIUM (migration) · RESOLVIDO

Every `validade` in the legacy purchase history is 2023 or earlier. Received
literally in 2026 they are expired on arrival, so no lot can be released and
nothing can be produced. The audit had to substitute synthetic future dates
and label them.

Again a policy decision: refuse expired legacy lots, import them as blocked,
or require an explicit override per lot.

**Resolvido** em `377a5d9`: importação histórica preserva a validade original —
lote vencido segue vencido, e nenhuma data é deslocada para o futuro. O saldo
inicial aceita o lote, mas nunca como `AVAILABLE`: `opening-stock.ts` recusa
com `EXPIRED_OPENING_LOT` e exige `AWAITING_RELEASE` ou `BLOCKED`. Data futura
só existe em simulação, entrada pelo operador e rotulada como sintética. Regra
durável em `PRODUCT_RULES.md` §38.

## Visual observations from the audit screenshots

Reviewed from the captures taken during the run, not from a dedicated
accessibility pass.

- **RESOLVIDO — Stock position does not say why available is zero.**
  `MP-000003` showed Físico 5 and Disponível 0 with no marker on the row that
  differed. *Correção:* the row now states the reason — VAL-LEG-02 read
  "0.2 kg aguardando liberação da Qualidade" straight from the grid.
- **RESOLVIDO — "Salvar cálculo" sits next to "Calcular custo" as the visually
  primary action.** *Correção:* "Calcular custo" is the accent action,
  "Salvar cálculo" is secondary and goes through a confirmation that names the
  reference date and the total before freezing the document.
- **RESOLVIDO — Commercial notes are a single-line input holding
  sentence-length text.** In `Item x Fornecedor` the stored note rendered as
  "Preço LEGADO R$ 272/kg; pedido mínimo 1. Fonte: precos_for…" with no way to
  read the rest in place. *Impacto:* text the operator was asked to write came
  back unreadable. *Correção:* the relation's note became a textarea in an
  earlier round; the surviving half was the **offer** note — captured by both
  forms, stored, and rendered nowhere at all. The offers table gained an
  "Observação" column that wraps the full text instead of truncating it.
  *Release:* `fix/final-visual-polish`.
- **RESOLVIDO — "Inativar relação" is styled as plain text between two
  bordered buttons.** The least reversible action on the panel had the least
  visual weight, while "Marcar como preferencial" was the filled one.
  *Impacto:* a state change that removes a supplier from sourcing sat one slip
  away from "Salvar". *Correção:* the destructive variant (`btn--danger`) and a
  confirmation dialog arrived in an earlier round; this one finished the
  placement half — the action left the middle of the routine group, and
  "preferencial" stopped being the filled primary beside it. Reactivation stays
  discreet, and no copy promises deletion. *Release:*
  `fix/final-visual-polish`.
- **RESOLVIDO — Two "Fechar" affordances on the same detail modal** — one
  top-right, one bottom-right. *Impacto:* read as two different exits.
  *Correção:* already a single control by the time this round reproduced it —
  the header button is one target labelled "✕ Fechar" and the footer offers
  "Cancelar". What remained was an accessibility defect in that same control:
  `aria-label="Fechar sem salvar"` replaced the accessible name, so voice
  control saying "Fechar" hit nothing. The visible name is now the accessible
  name and the warning moved to `title`. *Release:* `fix/final-visual-polish`.
- **RESOLVIDO (variante) — "Inativar recurso" had routine weight and no
  confirmation.** Found while checking the same family in neighbouring
  screens. *Impacto:* worse than the original — one click deactivated an
  industrial resource, and every cost structure using it gains a BLOCKING
  pendency and can no longer be activated. *Correção:* destructive variant plus
  a confirmation that states that consequence and that reactivation is
  possible. *Release:* `fix/final-visual-polish`.
- **RESOLVIDO — Leftover test data is visible in the production stock list** —
  `PA-000003 Test` and `PA-000004 Test 2`. *Correção:* both were inactivated
  through the official flow during the post-VAL-LEG-01 checkpoint. Data
  hygiene, not code.

## Closed by the pre-client hardening round

Findings from the three deep cases, kept here with what they were and how
they were closed. History is not deleted — the finding is what justifies the
rule.

- **HIGH — Fulfilment Plan ignored owner scope on customer material.**
  Found in VAL-LEG-03. The plan showed 2.5 kg available to IGEIA's order when
  0.5 kg of that belonged to another customer; the OP correctly showed 2.
  Closed by resolving plan availability through the same `requirementOwnerScope`
  the OP and the reservation already use, with a test that asserts plan and OP
  agree.
- **MEDIUM — Draft billing total disagreed with its own line.** Found in
  VAL-LEG-02, reproduced in VAL-LEG-03 (R$ 1.677,27 on the line, R$ 1.677,00
  in the footer). Closed by making both read the server value.
- **MEDIUM — Extra consumption audit was persisted and invisible.** Found in
  VAL-LEG-02. Closed by showing reason, author and time on the extra line.
- **MEDIUM — Shortage had no route to purchasing before the OP existed.**
  Found in VAL-LEG-02. Closed by reusing the supplier candidate engine at the
  plan stage.
- **MEDIUM — Customer lot read as "no cost informed".** Found in VAL-LEG-03,
  together with a "Definir custo" action that should not exist for customer
  material. Closed in the screen and in the service.
- **MEDIUM — Traceability showed customer lots with an empty supplier.**
  Found in VAL-LEG-03. Closed by naming the owner.
- **MEDIUM — `unitsPerShippingBox` blocked unrelated edits.** Found in
  VAL-LEG-02. Root cause was `z.coerce.number()` resolving `""` to `0` before
  the empty-string branch. Closed in `optionalPositiveInt`.
- **LOW — Consumption above the reservation was only refused by the server.**
  Found in VAL-LEG-02. Closed by stating the limit before submit; the server
  remains the authority.
- **LOW — The cost page offered a reference quantity that applying a template
  ignored.** Found in VAL-LEG-03. The template remains the source of the base;
  the copy now says so instead of implying otherwise.

---

# Saídos do BACKLOG em 2026-09-15 (BACKLOG-RECONCILIATION-01)

Texto movido como estava, com os links ajustados para esta pasta. Capability fechada, absorvida ou substituída não
fica no BACKLOG. Resolvidos por estado posterior nesta reconciliação: SUPPLIER-ADDRESS-01 (merge b8d744b,
2026-09-11), HELP-FORMULACAO-WORDCAP-01 (merge ff1da7c, 2026-09-12), TEST-USERS-LEGACY-RESIDUE-01 (o `veridi_dev`
foi recriado do zero em DEV-REALDATA-BASELINE-RESET-01, 2026-09-14), E2E-CORPUS-MASS-01 (absorvido por
E2E-BASELINE-REDESIGN-WAVE-04) e CUSTOMER-LIST-DEFAULT-E2E-01 (absorvido pela WAVE 5 do golden path). O resto já
estava marcado fechado ou absorvido no próprio texto. Os achados ainda abertos que moravam nestes trechos foram
copiados para as tabelas de LOW e UX da seção A do BACKLOG.

## Preâmbulo e fila viva (2026-09-09 a 2026-09-15)

**Zero CRITICAL. Zero BLOCKER.** A fundação de precisão numérica está completa
no ARMAZENAMENTO — schema, persistência, serialização e comparação de domínio —,
e `schema.prisma` está em sincronia com as migrations. A auditoria de 2026-09-07
mostrou que a **exibição** ainda não acompanhou: o corte de seis casas da tela
nasceu quando o banco guardava seis, e hoje ele guarda doze.

O primeiro sintoma dessa defasagem — o campo com teto que recusava o próprio
número impresso — foi corrigido em FIX-01 (2026-09-07): campo com limite agora
resolve o que foi digitado contra o limite por `quantity-limit.ts`, e digitar o
valor exibido significa "usar todo o limite". O FIX-01b (2026-09-08) fechou os
dois resíduos que o próprio FIX-01 encontrou: o apontamento de produção, que
recalculava o restante por `Number`, e o complemento do Plano de Atendimento,
que ia no payload calculado em ponto flutuante. O que sobra da defasagem é
exibição sem entrada (W7) — F-07-1 saiu no FIX-06. O P0 de custo da Formulação foi fechado no
FIX-02 (2026-09-08): quantidade física canônica na estimativa e um único
"Equivalente estoque" entre rascunho e versão ativa.

Reconciliada em 2026-09-09 com o walkthrough real da Veridi. O detalhe de cada
item fica na sua seção; aqui fica só a ORDEM, porque ela é a pergunta que se
faz primeiro e estava espalhada por cinco lugares. Saíram da fila em
2026-09-10, resolvidos: QUOTE-DRAFT-STATE-01; QUOTE-SEND-DIRTY-01,
QUOTE-SEND-LINE-DRAFT-01 e QUOTE-LINE-NOOP-BLUR-01, promovidos a P0 pelo PO
por integridade comercial; QUOTE-INT-FIELDS-01, pela mesma razão, em P1;
PROJECT-INT-FIELDS-01, o mesmo defeito no cadastro do Projeto, promovido a P0;
FORM-UOM-01, a unidade controlada no Modelo de Formulação; e
TEMPLATE-APPLY-BASE-UOM-01, promovido a P0 — integridade física da Formulação.
Saíram em 2026-09-11: CUSTOMER-TAX-PROFILE-01, PRICING-TEMPLATE-FLEX-01,
QUOTE-DUPLICATE-01 e CUSTOMER-COMMERCIAL-STATUS-01, com as regras duráveis em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §83, §84, §85 e §86. No mesmo dia, sem
código: CUSTOMER-ACTIVITY-SCOPE-01, respondido pelo PO (§86), e
COST-BASELINE-01, absorvido pela fundação de custo que já existe — o que
faltava era dado real, não código ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md),
"Próxima prioridade"). E COST-RESOURCE-MULTIPLIER-01, com as decisões do PO:
quantidade de recursos equivalentes na linha de recurso (§87).

| # | Item | Seção | Por que nesta posição |
|---|---|---|---|
| **P1-1** | SUPPLIER-ADDRESS-01 | G | Reusa a fundação de endereço do Cliente, já com o comportamento de §80 |
| ~~P2-1~~ | ~~OPS-CALENDAR-01~~ | B · #9 | **ABSORVIDO** por PLANNING-CALENDAR-01, entregue em 2026-09-12. Saiu da fila |
| depois | COST-VAR-02 · PLAN-DATE-01 · UX-HELP-03 · COM-CONTRACT-01 | — | Nenhum deles muda de prioridade por causa desta reunião. COST-VAR-02 continua esperando as sete decisões do PO e dado real em produção |

Achados de PRICING-TEMPLATE-FLEX-01 (seção A, na entrada do item):
~~PRICING-MODEL-VIEW-01~~ **fechado em 2026-09-14** — o PDF de Precificação conta o Modelo (custo p/ preço,
custo do cálculo à parte, regras sem valor de modo desligado); o resto — R-19, R-20 e "Precificação vigente" do
CMV — virou ~~PRICING-MODEL-VIEW-REPORTS-01~~, **fechado em 2026-09-14** por REPORT-ROBUSTNESS-WAVE-01 (resta
R20-SENT-PRICING-BASIS-SNAPSHOT-01, decisão de schema, sem posição na fila);
~~PRICING-MODEL-DIFF-01~~ e ~~PRICING-ACTIVATE-CONFIRM-01~~ **fechados em 2026-09-14** por
COST-PRICING-CLARITY-WAVE-01. Achados de QUOTE-DUPLICATE-01, sem posição na fila: QUOTE-NEW-VERSION-PATHS-01 e
QUOTE-DUPLICATE-ORIGIN-01. Achados de CUSTOMER-COMMERCIAL-STATUS-01, idem:
CUSTOMER-LIST-DEFAULT-E2E-01 e CUSTOMER-FACTS-LOAD-01. Achado de
COST-RESOURCE-MULTIPLIER-01: ~~COST-RESOURCE-EDIT-01~~ **fechado em 2026-09-14** por
COST-PRICING-CLARITY-WAVE-01 — a linha de recurso se edita no lugar (tempo e quantidade, mesma linha).
Achados de COST-PRICING-CLARITY-WAVE-01, sem posição na fila: ~~QUOTE-SEND-CONFIRM-QUALITY-01~~ **fechado em
2026-09-14** — a faixa ativa congela a qualidade do custo que formou o preço (`pricingCostQualitySnapshot`, sem
backfill) e o envio pede confirmação por `pricingCostQuality ?? costQuality`. E
**QUOTE-SUGGESTION-390-01 (UX, P3)** — em 390px a frase "Existe uma precificação vigente…" da linha do
Orçamento fica cortada dentro da tabela rolável (já cortava o preço; a explicação de F-05-1 alonga a frase).
Achados de QUOTE-WORKSPACE-NAVIGATION-01 (2026-09-14, §92): ~~QUOTES-HUB-01~~ **fechado em 2026-09-14** (§93) —
Comercial → Orçamentos, a lista geral das versões (`GET /quote-versions`), que só NAVEGA para
`/comercial/orcamentos/:id` (`rotaDoOrcamento`) e tem item de menu próprio. ~~E2E-QUOTE-PAGE-FLOW-01~~ **fechado em
2026-09-15** por E2E-BASELINE-REDESIGN-WAVE-03 — as suítes do Orçamento andam pelo fluxo atual (ficha → versão em
`/comercial/orcamentos/:id` → aprovação na ficha → Pedido no Fechamento da versão aceita):
`condicoes-do-orcamento-sobrevivem-a-linha`, `prazo-invalido-nao-apaga`, `preco-herdado-sobrevive-ao-tab`,
`resumo-comercial-do-projeto`, `projeto-aprovado-vende-de-novo` e `formacao-de-preco-do-novo-orcamento`, mais
`envio-exige-condicoes-e-linhas-salvas` (as duas do envio fundidas) e `orcamentos-hub-e-pagina-da-versao` (a lista
geral) — bateria `wave-03` verde em clone novo e sujo. Sobram no caminho antigo, fora do escopo da WAVE 3:
`desconto-do-pedido-chega-ao-faturamento` (grupo C) e o golden path (`private-label-golden-path`, que para em
`pedido`); `guia-capturas.mjs` segue fora do gate (decisão H).
~~QUOTE-PAGE-NAV-ACTIVE-01~~ **fechado em 2026-09-14** com QUOTES-HUB-01 — Orçamentos fica ativo na lista e na página
de cada versão, e a aba diz qual versão está aberta ("ORC-000444 · V1 · Veridi Nutrition").
Achado de QUOTES-HUB-01, sem posição na fila: ~~LISTS-LOADING-DATES-GESTURE-01~~ **fechado em 2026-09-14** — teste
desatualizado, não tela: o gesto "datas" de `web pages/listas-consulta-em-curso.test.tsx` não esperava a pausa de 300 ms
que o `DateRangeFilter` ganhou em LISTS-FILTER-INPUT-UX-01; agora espera e confere as duas pontas, e as quatro listas com
período ganharam o caso com consulta em curso (página, URL, sessão, resposta atrasada). Achado dele, sem posição na
fila: **LISTS-CUSTOM-PERIOD-PAGE-RESET-01 (P3, UX)** — "Personalizado" clicado fora da página 1 (Faturamento,
Recebimentos, OC, Produto Acabado) volta para a página 1 do MESMO recorte e consulta uma vez (a partir da página 1, 0):
semear grava `period`/datas na URL, e `useListFilters.set` sempre volta à página 1. Existe desde FILTER-FOUNDATION-01.
Decidir se abrir o Personalizado é trocar filtro; se não for, a página só pode ficar com a tela sabendo que o recorte
resolvido não mudou (o `set` não resolve período).
Achados de FORMULATION-ADJUSTMENTS-UX-01, idem: **FORMULATION-PRINT-ADJUSTMENTS-01
(para a branch de PDF)** — nenhum impresso lê o modo da quantidade, a pureza,
o overage ou o físico por unidade; a tela passou a mostrar os ajustes resumidos
na linha e "Equivalente estoque" separado de "Físico / unidade". Decidir se o
papel acompanha. Nada de impresso foi tocado nesta rodada. **FORMULATION-TEMPLATE-BASIS-EDIT-01 (P3)** — a tela do Modelo preserva
a base de cada componente ao salvar, mas não oferece seletor para mudá-la.
~~FORMULATION-TEMPLATE-PURITY-RANGE-01~~ **fechado em 2026-09-13** por INPUT-DATE-CONTRACT-WAVE-01 —
a pureza do componente do Modelo usa a mesma regra da Formulação (0 < x ≤ 100, seis casas,
vazio/null = desconhecida). Achados de NAVIGATION-SIDEBAR-01,
idem: NAV-PAGE-TITLES-01 e QUALITY-DOC-WRITE-01 **fechados em 2026-09-11** —
títulos, trilhas e ajuda com os nomes do menu; registrar e ativar revisão de
documento controlado passou a ser da Qualidade e do ADMIN.
**NAV-TWO-SEARCHES-01 (P3, UX)** — convivem "Buscar ou escanear lote" no topo
e "Buscar telas…" na coluna; unificar é assunto da busca global de registros,
fora desta fase. **NAV-TEMPLATE-WORDING-01 (P3, UX, decisão do PO)** — as
telas se chamam Modelos de Formulação e Modelos de Estrutura de Custo, mas
botões, campos e diálogos seguem dizendo "template" ("Novo template", "Usar
template", "Nome do template"); a ajuda das estruturas faz a ponte ("modelo —
o template —"). Trocar a palavra da entidade é outra rodada.
**HELP-FORMULACAO-WORDCAP-01 (P3, teste vermelho na main)** — o painel da
Formulação (`formulacao.comoFunciona`) tem 801 palavras contra o teto de 800
da classe L desde a última mudança do painel (2a27b31); com "Tela: Produtos
Acabados" foi a 802, e `help-editorial.test.ts` falha. Cortar duas palavras
do painel é decisão de conteúdo da Formulação, fora da passada de nomes.

Discovery sem posição na fila: SUPPLIER-OFFER-OVERLAP-01 — que desde
2026-09-09 carrega junto a sobreposição de `IndustrialResourceRate`, mesma
pergunta nos dois lados do custo, uma resposta só —, SUPPLIER-MODE-01,
ASSET-01, COM-CONTRACT-01 e INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01 — este com a
intenção do PO já aprovada (seção G). Brainstorm: tributos e custo de aquisição
(seção F). FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01 (Painel Gerencial) tem
documento próprio em [`discovery/`](../discovery/README.md), com cinco decisões de PO
abertas; o defeito que ele achou no valor faturado atual é
BILLED-VALUE-CANONICAL-01 (seção A).

## Seção A — narrativas e entradas fechadas

**Zero BLOCKER e zero P0.** Da auditoria de produto sobram três LOW e a fila de
UX; o que reabriu P0 e P1 veio de outro lugar — o **walkthrough real da Veridi
de 2026-09-09**, reconciliado aqui no mesmo dia. Os dois P0
(ORDER-CUSTOMER-PRODUCT-01 e COST-BASIS-UX-01) **fecharam no mesmo
2026-09-09**; cinco P1 entraram por
observação de uso, não por varredura de código: é a diferença entre o que o
sistema faz errado e o que ele faz de um jeito que ninguém entende. A mesma leva trouxe uma decisão de produto
nova — CUSTOMER-COMMERCIAL-STATUS-01 — e um discovery de contrato.

F-02-2 e F-02-1 fechados no FIX-02, F-08-2 no FIX-03, F-06-1 + F-06-2 no FIX-04,
F-09-1 + F-07-2 no FIX-05 e F-03-1 + F-07-1 no FIX-06 (2026-09-08). PROD-ERR-01
não veio da auditoria — nasceu da leitura de código do FIX-05b — e está
**RESOLVIDO**.

**COM-CORE fechado em 2026-09-09.** Projeto aprovado passou a receber novos
orçamentos (§69), aceita que já virou Pedido deixou de ser superada (§70) e a
validade da proposta passou a valer (§71). Zero migration. **Próximo item de
produto: COM-PRICE** — herança de preço entre ciclos (reajuste percentual,
"manter condição anterior", proveniência da herança), que o COM-CORE
deliberadamente não fez.

**MIG-ORDER-01 fechado em 2026-09-09.** A ponta da cadeia de migrations
(`20260925093008`) está **à frente do relógio real**, então `prisma migrate dev`
carimbava a pasta nova com uma data que ordena ANTES de migrations das quais ela
depende — foi assim que a migration do COM-PRICE quebrou a reconstrução de banco
vazio com `relation "quote_lines" does not exist` e precisou ser renumerada à
mão. A convenção existia em `TECH_BASELINE.md` desde 2026-09-05 e dependia de
alguém lembrar dela. Agora existe um caminho oficial — `pnpm migration:create` —
que escreve a migration sem aplicar, renumera para o menor prefixo livre depois
da ponta e prova o resultado. Zero migration, zero schema, zero renomeação de
histórico.

**MIG-ORDER-01b fechado em 2026-09-09.** O `01` deu o caminho de criação, mas
`pnpm db:migrate` continuava sendo `prisma migrate dev`, que aplica **e** cria:
um `--name`, ou uma edição pendente em `schema.prisma`, e nascia uma pasta com
o carimbo do relógio. A barreira era documental. Agora é técnica —
`pnpm db:migrate` é `prisma migrate deploy` embrulhado
(`scripts/apply-migrations.mjs`), recusa qualquer argumento antes de o Prisma
vê-lo, e `migrate deploy` sequer conhece `--name`. Schema alterado sem
migration passou a ser **avisado**, nunca criado. Zero migration, zero schema.
**Próximo item de produto: BILL-DISCOUNT-01** — o desconto global do
Pedido (`agreedDiscountPercent`/`agreedTotalAmount`) nunca chega ao Faturamento:
`calcularTotaisFaturamento` é `Σ(quantidade × preço)` e nenhum Billing o aplica.
Um Pedido de 30.000 com 10% acordado fatura 30.000, não 27.000 — hoje, já com
uma expedição total única. É pré-requisito econômico do COM-04, que multiplica o
buraco por cada entrega.

**BILL-DISCOUNT-01 e 01b fechados em 2026-09-09.** O desconto global do Pedido
morria na Origem comercial: `billings.service.ts` nunca lia
`agreedDiscountPercent`, e um pedido de R$ 200,00 com 10% acordado faturava
R$ 200,00. A investigação (01) disparou STOP GATE — não havia regra de rateio,
e `PRODUCT_RULES.md` §34 proibia espalhar o desconto nas linhas. O PO decidiu a
opção D e a implementação (01b) apropriou o desconto no CABEÇALHO do
Faturamento: cada documento apropria a sua parcela de forma cumulativa, e o
documento que FECHA as quantidades do Pedido absorve o saldo. `agreedUnitPrice`
segue verdadeiro — nenhuma linha ganhou preço líquido. **F-C entrou na mesma
reconciliação**: partir uma linha em vários documentos já perdia centavos por
arredondamento mesmo com desconto zero, e o `commercialAdjustmentAmount` do
fechamento cobre as duas fontes. Invariante durável: pedido inteiramente
faturado por documentos ativos soma EXATAMENTE `agreedTotalAmount`. Uma
migration estrutural (58), zero backfill — DEV e PROD não tinham faturamento
nenhum.

**SYS-TZ-01 fechado em 2026-09-09** (§72): `America/Sao_Paulo` virou o fuso
operacional oficial, com uma definição em `packages/shared`. O resíduo que
ficou — TZ-LOTE-01 — **também está fechado**.

**COM-PRICE fechado em 2026-09-09** (§74): a formação de preço do orçamento
novo passou a ser uma DECISÃO por linha — manter a condição acordada,
reajustá-la, usar a precificação atual ou digitar — com proveniência gravada.
A auditoria confirmou o que o PO suspeitava: `createQuoteVersion` já copiava
`unitPrice` da versão anterior, em silêncio e sem origem.

**COM-04 fechado em 2026-09-09** (§75): entregas programadas viraram documento.
A investigação disparou STOP GATE em três pontos que o spike não resolvia —
cancelamento após atendimento parcial, mecanismo de histórico da reprogramação e
o achado 2 (cobertura total do Plano). O PO decidiu **1(a) / 2(c) / 3(a)**:
cancelar uma entrega parcialmente atendida é permitido e preserva o que saiu;
reprogramar é cancelar e criar substituta com `replacesDeliveryId`; e o Plano de
Atendimento fica intocado. Duas tabelas, uma coluna anulável em
`shipment_lines`, uma migration estrutural (59).

**COM-04b fechado em 2026-09-09** (§75): a quantidade expedida passou a
ATRAVESSAR entregas programadas. O vínculo só existia quando a linha cabia
INTEIRA numa promessa — expedir 500 contra entregas de 400 e 600 não cabia em
nenhuma, ficava sem vínculo, e o cronograma jurava que nada tinha sido entregue.
Agora 400 vão para a primeira e 100 para a segunda, em duas linhas do mesmo lote
e da mesma reserva. Separação aberta pela ENTREGA não atravessa: ela representa
aquela promessa, e passar do que ela pedia é recusa. A origem virou coluna
(`Shipment.originDeliveryId`, migration 60) porque deduzi-la dos vínculos
confundiria os dois fluxos. Entrega com separação em RASCUNHO deixou de aceitar
cancelamento e reprogramação. PLAN-DATE-01 está registrado abaixo e não é
sequência automática — o próximo item de produto passou a ser o P0 da fila viva,
definido pelo walkthrough de 2026-09-09.

**COST-SOURCE-01 fechado em 2026-09-09** (§76): a oferta de fornecedor virou
fonte operacional de custo. Oferta NOVA exige "válida a partir de" (a coluna
segue anulável — as 602 importadas continuam sendo histórico legítimo, sem
backfill e sem data inferida); a vigência passou a ser dia civil nas duas
bordas, o que habilita CMV com `referenceDate` futura antecipando um aumento
já cotado; e `ItemCostReference.currencyCode` passou a ser filtrado — uma
referência em dólar entrava no custo como se fosse real. Ambiguidade entre
fornecedores continua sendo ausência de custo, e a tela passou a dizer por quê.
Sem migration: o índice parcial único do preferencial já existia.

**TZ-LOTE-01 fechado em 2026-09-08** (§73). O PO decidiu a leitura (a): a
validade do lote é DATA CIVIL INCLUSIVA — o lote vale o dia inteiro e vence às
00:00 do dia seguinte em São Paulo. `isLotExpired` passou a responder pelo
mesmo `venceuEm` da validade comercial, e com ele os call sites que comparavam
por fora: liberação da Qualidade, painel de atenção, KPI do painel e relatório
de validade (inclusive `daysToExpiry`, agora em dias civis). Zero migration,
zero dado reescrito — os mesmos lotes passaram a ser lidos corretamente.

### P0 — antes de qualquer outra capability (os dois fechados em 2026-09-09)

#### ORDER-CUSTOMER-PRODUCT-01 — Pedido aceita produto de outro cliente até a Produção — **RESOLVIDO em 2026-09-09**

Vindo do walkthrough real (2026-09-09). Auditado no código em 2026-09-09, e o
sintoma relatado era **mais grave** do que "acusa mismatch tarde":

- a tela do Pedido chama `listProducts({ active: true, lifecycle: "APPROVED",
  pageSize: 50 })` — `CustomerOrderPage.tsx:399,430` — **sem `customerId`**,
  embora a API já aceite esse filtro (`products.service.ts:210`). O seletor
  oferece produto de qualquer cliente;
- o Cliente não é pré-requisito do Produto na tela: as duas escolhas são
  independentes;
- `customer-orders.service.ts` **não compara** `product.customerId` com
  `order.customerId` — nem ao montar a linha, nem no `confirm`, que valida
  cliente ativo, produto ativo, produto operacional e item de produto acabado,
  e nada mais;
- a única recusa existente é `CustomerMismatchError`, levantada por
  `resolveOrderCustomerId` em `production-orders.service.ts` — isto é, no
  Plano de Atendimento / Ordem de Produção.

Consequência: um Pedido **CONFIRMADO** pode carregar a combinação impossível, e
ela só aparece quando alguém tenta produzir. Confirmar é o ponto em que o
documento vira compromisso; deixar passar ali é deixar passar.

Regra desejada pelo PO: **Cliente obrigatório antes de Produto**, produto
filtrado no SERVIDOR pelo cliente do Pedido, e o backend recusando a combinação
no seu próprio limite — filtro de tela não é regra. A recusa a jusante continua
existindo; ela deixa de ser a primeira.

**Resolvido em 2026-09-09.** A comparação virou uma só —
`lib/product-customer-ownership.ts`, que também passou a hospedar o
`CustomerMismatchError` que `production-orders` reexporta — e é chamada em cada
porta de entrada de linha: criar Pedido, salvar linhas do rascunho, trocar o
cliente do rascunho, confirmar o Pedido e gerar Pedido a partir de proposta
aceita. Sempre `400 customer_mismatch`, nunca 500. `resolveOrderCustomerId`
continua onde estava, agora como defesa em profundidade. Na tela, o seletor de
Produto só abre depois do Cliente, o catálogo é consultado no servidor com
`customerId` (busca e paginação inclusive), trocar de cliente com produto no
Pedido é bloqueado com o motivo — nunca apagando linha — e a resposta atrasada
do cliente anterior não aparece no seletor do novo. Pedido herdado inconsistente
continua abrindo, com aviso, e não confirma. Zero migration, zero dado
corrigido. Legado auditado: DEV com 2 linhas inconsistentes (PED-003984
CANCELADO e PED-026585 CONFIRMADO, ambos sem expedição, OP, reserva ou
faturamento); PROD sem nenhum Pedido.

**F-02-2 foi fechado no FIX-02 (2026-09-08)**: a estimativa passou a
chamar `computeFormulationRequirements`, o mesmo motor da OP e do cálculo
industrial, em vez de converter a unidade da quantidade declarada e parar aí.
Em `CAFEÍNA PT 60 CAPS THE KING` o material foi de R$ 0,15 para R$ 9,10 —
exatamente as 60 doses que faltavam. Sem doses por embalagem a estimativa falha
fechada, com o motivo na tela. Nada havia sido persistido por esse caminho.

#### COST-BASIS-UX-01 — "custo por 1.000" ao lado de uma base de 300 — **RESOLVIDO em 2026-09-09**

Fechado em 2026-09-09. Regra durável em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md),
**§78**.

**A auditoria do motor veio primeiro, e absolveu a matemática.** A prova rodou o
motor real (`costForOutputQuantity`, pela rota de CMV) sobre uma estrutura de
base 300 que reúne todas as formas de escala do domínio — material proporcional,
mão de obra fixa por lote, equipamento com potência, energia derivada, premissa
fixa por lote, premissa por unidade, premissa por 1.000 e caixa de expedição
inteira — em 200, 300, 500 e 1.000, com conta independente em Decimal:

| Quantidade | Lotes | Caixas | Total | Por unidade | Equivalente por 1.000 |
|---|---|---|---|---|---|
| 200 un | 1 | 2 | R$ 183,00 | R$ 0,915 | R$ 915,00 |
| 300 un | 1 | 3 | R$ 201,00 | R$ 0,67 | R$ 670,00 |
| 500 un | 2 | 5 | R$ 384,00 | R$ 0,768 | R$ 768,00 |
| 1.000 un | 4 | 9 | R$ 767,00 | R$ 0,767 | R$ 767,00 |

`perUnit = total ÷ quantidade` e `per1000 = perUnit × 1.000` em todos os casos,
e o total é sempre o da quantidade pedida. **Classificação A — matemática
correta, defeito exclusivamente de UX.** Zero recálculo, zero snapshot alterado,
zero migration, zero dado PROD tocado.

**A prova semântica que faltava.** O equivalente por 1.000 da execução de 300 é
R$ 670,00; o cálculo REAL de 1.000 sobre a mesma base é R$ 767,00 — quatro
lotes, 14% acima. Os dois números são corretos e não são a mesma coisa, e era
apresentá-los com o mesmo peso que produzia a dúvida.

**O que mudou é hierarquia e copy.** A quantidade calculada passou a acompanhar
o total ("Custo industrial total para 300 un", "CMV total para 300 un"), e o
"por 1.000" virou **"Equivalente por 1.000 un"**, secundário, com a ressalva de
que não representa um novo cálculo de produção. Texto único em `@veridi/shared`
(`COST_PER_1000_LABEL`, `COST_PER_1000_EXPLANATION`).

**Seis superfícies, não cinco.** Além de `CostBreakdown.tsx`,
`ProductCmvPage.tsx` e dos três impressos (`CmvPrintPage`,
`CostCalculationPrintPage`, `PricingPrintPage`), a varredura por `per1000`
achou o relatório R-18 (`CostReports.tsx` e o CSV de exportação), que mostrava
"Custo total" e "Custo/1.000" lado a lado **sem nenhuma quantidade na linha**.
Ganhou a coluna "Quantidade calculada" — `IndustrialCostCalculationSummaryDTO` e
`IndustrialCostByProductRowDTO` passaram a carregar a base, que já estava
persistida.

**Finding aberto — vocabulário da base.** O mesmo conceito tem três nomes na
interface: "Base de produção" (campo de entrada), "Base de referência" (leitura)
e "Base de produção sugerida" (template). Registrado, não varrido: sweep de
nomenclatura sem necessidade não é parte desta capability.

### P1 — próximas correções

#### QUOTE-DRAFT-STATE-01 — condições não salvas do Orçamento somem ao mexer numa linha — **RESOLVIDO em 2026-09-10**

**A correção.** O formulário separa o GRAVADO (`base`) do DIGITADO (`campos`), e
a leitura nova da proposta é decidida pela identidade da versão (`quote.id`) e
pelo valor de cada campo — nunca pela identidade do objeto: mesma versão com
alteração local preserva o digitado e acompanha o servidor no que ninguém tocou;
sem alteração, acompanha o servidor; outra versão, ou versão que deixou de ser
rascunho, mostra o gravado dela. As nove condições passam por um caminho só
(`pages/projects/quote-conditions-draft.ts`), "Alterações não salvas" compara
VALOR (`7,5` digitado e `7.5000` gravado não são pendência) e salvar faz do
gravado a base nova. A leitura é absorvida durante o render: com efeito, a E2E
viu a V1 enviada desenhada com o rascunho da V2. "Descartar alterações" passou
a levar junto a simulação dos valores descartados. Sem auto-salvar, sem
`localStorage`, sem store global, zero backend. Achados que ela abriu:
QUOTE-SEND-DIRTY-01 (resolvido no mesmo dia, abaixo), QUOTE-INT-FIELDS-01
(promovido a P1), QUOTE-VERSION-SWITCH-DIRTY-01 e PROJECT-RELOAD-ERROR-01 (P3).

Finding de PROJECT-COMMERCIAL-SUMMARY-01 (2026-09-10), encontrado ao escrever o
E2E: o roteiro só passou depois que a validade foi digitada **depois** de a
linha assentar. Não é bug de domínio financeiro — é perda silenciosa de entrada
válida, e o ERP tem de proteger o trabalho em andamento em vez de exigir que o
operador aprenda a salvar antes de adicionar produto.

**O percurso.** Na proposta em rascunho a pessoa digita a validade (ou o
desconto, ou o prazo), **não** clica em "Salvar condições" e adiciona ou altera
uma linha. A mutação da linha recarrega o Projeto inteiro; o formulário de
condições é remontado a partir do dado que voltou do servidor, e o que estava
digitado desaparece sem aviso. Pior: "Salvar condições" fica desabilitado logo
depois, porque o formulário se considera limpo — a tela informa "nada a salvar"
sobre um valor que a pessoa acabou de escrever.

**A causa, localizada.** `QuoteConditionsForm.tsx:104-116`:

```
const original = useMemo(() => camposDe(quote), [quote]);
useEffect(() => { setCampos(original); ... }, [original]);
```

`quote` é um objeto NOVO a cada recarga, então `original` muda de identidade
mesmo quando o conteúdo gravado é idêntico, e o efeito descarta o rascunho de
tela. O comentário ao lado assume "recarregar ou trocar de versão descarta" —
mas não distingue **a mesma versão recarregada** de **outra versão escolhida**,
e só o segundo caso justifica descartar.

**São nove campos, não um.** Todos saem do mesmo `Campos` e morrem pelo mesmo
efeito: `validUntil`, `leadTimeDays`, `commercialNotes`, `discountPercent`,
`paymentMethod`, `downPaymentPercent`, `installmentCount`,
`installmentIntervalDays`, `monthlyInterestPercent`. Corrigir só a validade
deixaria os outros oito com o mesmo defeito.

**Auto-salvar não é a solução assumida.** Gravar as condições por conta própria
ao adicionar um produto produziria efeito comercial que ninguém pediu. A
preferência é preservar o estado sujo enquanto a versão aberta for a MESMA;
trocar de versão de verdade é outra decisão — avisar, salvar ou descartar —, e
essa fica para o discovery da implementação, sem ampliar o item.

**Prova que a correção precisa passar:** abrir um rascunho, digitar a validade,
não salvar, adicionar uma linha, e a validade continuar no campo, com o botão
ainda refletindo que há alteração pendente; salvar e o servidor receber o valor
digitado.

#### QUOTE-SEND-DIRTY-01 — enviar com condição alterada e não salva — **RESOLVIDO em 2026-09-10**

Achado de QUOTE-DRAFT-STATE-01, promovido a **P0** pelo PO: a tela podia mostrar
a condição B enquanto o envio congelava a A, porque o envio usa o que está
gravado — e isso está certo. O que mudou é a interação: com qualquer uma das
nove condições alterada e não salva, "Enviar ao cliente" fica indisponível, com
o motivo escrito ao lado e ligado ao botão ("Salve as alterações das condições
antes de enviar o orçamento. O envio usa somente as condições já salvas."). Sem
auto-salvar, sem "enviar mesmo assim", sem bypass. A pendência é a MESMA de
"Alterações não salvas" — `condicoesAlteradas`, comparação de valor —, avisada
pelo formulário ao pai antes da pintura; o envio confere de novo no clique e na
confirmação. Salvar libera o envio na mesma tela; salvar que falha mantém o
bloqueio. Servidor, snapshot e transição de status intocados. Regra durável:
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §48. O mesmo risco na LINHA cujo
salvamento falhou foi registrado sem ampliar, e fechado no mesmo dia:
QUOTE-SEND-LINE-DRAFT-01, abaixo.

#### QUOTE-SEND-LINE-DRAFT-01 — enviar com linha que a tela mostra e o servidor não tem — **RESOLVIDO em 2026-09-10**

Achado de QUOTE-SEND-DIRTY-01, promovido a **P0** pelo PO. Quantidade, preço e
unidade da linha gravam ao sair do campo; quando o salvamento falhava, o campo
continuava com o digitado — certo: a pessoa vê o que tentou informar —, o
servidor ficava com o valor antigo e o envio congelava o antigo. Agora uma
linha pendente segura o orçamento inteiro: "Enviar ao cliente" fica
indisponível desde a primeira tecla diferente do gravado, durante o salvamento
e depois da falha, até o gravado alcançar a tela ("Salve as alterações dos
produtos antes de enviar o orçamento."). Pendência é VALOR contra o gravado,
com `Decimal` — o campo focado com o valor gravado não segura nada. A unidade
entrou pela mesma causa: o campo era não-controlado, e o texto de uma falha
ficava invisível para a tela. Condição e linha pendentes somam numa espera só
("Salve as alterações do orçamento antes de enviar."). Sem auto-salvar, sem
descartar o digitado, sem backend. Achado aberto no caminho, e fechado no
mesmo dia: QUOTE-LINE-NOOP-BLUR-01, abaixo.

#### QUOTE-LINE-NOOP-BLUR-01 — passar pelo campo sem mudar nada apagava o preço herdado — **RESOLVIDO em 2026-09-10**

Achado de QUOTE-SEND-LINE-DRAFT-01, promovido a **P0** pelo PO e reproduzido
pela interface antes da correção: um Tab pela quantidade de uma linha herdada
mandava `{"quotedQuantity":"1000"}`, e `updateQuoteLine` soltava o preço, a
origem e o vínculo com o acordo — a limpeza de §74 olhava a PRESENÇA da chave
no pedido, não o valor. Em cascata, o Tab pelo preço já vazio gravava
`unitPrice: null` com origem `MANUAL`. Duas camadas: a tela não manda o que
não mudou (a mesma `digitadoIgualAoGravado` da pendência de envio), e o
servidor compara cada campo com o gravado, em `Decimal`, antes de travar,
limpar ou gravar — pedido inteiramente igual nem faz UPDATE. Mudança REAL de
quantidade ou de unidade continua soltando o preço herdado ou reajustado, e o
preço informado junto com ela continua ganhando da limpeza. A trava da faixa
(`PRICING_TIER`) passou a recusar só o que muda.

#### QUOTE-INT-FIELDS-01 — prazo, parcelas e intervalo aceitavam texto e apagavam o gravado — **RESOLVIDO em 2026-09-10**

Achado de QUOTE-DRAFT-STATE-01, promovido a P1 pelo PO pela mesma prioridade de
integridade e reproduzido antes da correção em três níveis. Pela interface, o
pedido de "Salvar condições" saiu com `"leadTimeDays":null` e a segunda aba
mostrou o prazo apagado; no componente, 29 de 33 casos falhavam; na API, o
texto já era recusado com 400 — o defeito nunca chegava lá, porque
`Number("abc")` virava `NaN` em `paraEnvio` e o JSON escrevia `null`.

Agora os três inteiros passam por `lerInteiroOpcional` (`lib/integer-input.ts`),
de resultado discriminado — vazio, válido ou inválido, nunca `NaN`: só dígitos,
com espaço nas pontas e zero à esquerda. Inválido fica no campo como digitado,
com o erro ao lado (`aria-invalid` + `aria-describedby`), conta como alteração
pendente e prende salvar, simular e, pela pendência, o envio — sem requisição
nenhuma. Vazio continua "não informado" e salva `null`. Os limites saíram de
uma fonte só, `LIMITES_INTEIROS_DAS_CONDICOES` em `@veridi/shared`, usada pela
tela e pelo schema da API com os mesmos valores e mensagens de antes. À vista,
parcelas e intervalo não aparecem nem valem: o texto escondido neles não trava
e segue como `null` — o servidor grava à vista sem parcelas de qualquer jeito.
Percentuais, conta do plano e proteções de envio intocados. Regra durável:
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §48. Achados registrados sem corrigir:
PROJECT-INT-FIELDS-01 — o mesmo defeito no formulário do Projeto, promovido a P0
e resolvido no mesmo dia, abaixo —, e API-INT-COERCION-01,
QUOTE-PERCENT-FIELDS-01 e QUOTE-CASH-HIDDEN-DIRTY-01 (P3).

#### PROJECT-INT-FIELDS-01 — doses e vida útil do Projeto aceitavam texto e apagavam o gravado — **RESOLVIDO em 2026-09-10**

Achado de QUOTE-INT-FIELDS-01, registrado em P2 e promovido a **P0** pelo PO —
integridade de cadastro. Reproduzido antes da correção: pela interface, `abc`
sobre doses 60 saiu no PATCH como `"dosesPerPackage":null`, `30abc` sobre vida
útil 24 como `"shelfLifeMonths":null`, e a segunda aba mostrou os dois apagados
(11 falhas na E2E); no componente, 20 de 27 casos falhavam; a API já recusava o
texto com 400, na criação e na edição.

`ProjectFormModal` passou a ler os dois pela mesma `lerInteiroOpcional` do
Orçamento — sem parser novo. Inválido fica no campo como digitado, com o erro
ao lado (`aria-invalid` + `aria-describedby`), e prende "Criar projeto" e
"Salvar alterações" sem requisição nenhuma; vazio continua "não informado" e
vai como `null`. O limite é o da API, inteiro maior que zero sem teto
(`optionalPositiveInt`) — sem constante compartilhada, porque não há teto
numérico repetido entre as duas pontas. Backend, semântica das doses e da vida
útil (cópia para o Produto na aprovação, validade sugerida) e Orçamento
intocados. Regra durável: [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §48.

#### FORM-UOM-01 — unidade de medida era texto livre no Modelo de Formulação — **RESOLVIDO em 2026-09-10**

Unidade é conceito ESTRUTURAL — alimenta conversão, necessidade, custo e
produção —, e o Modelo a deixava digitar à mão, na base e no componente,
enquanto a Formulação real já escolhia do catálogo pela dimensão do Item.

**Reproduzido antes da correção, e a auditoria corrigiu o registro abaixo.** A
tela mandava texto livre: um rascunho salvo com base `abc` e componente
`quilo` saiu como `{"outputUnitCode":"abc","components":[{"unitCode":"quilo"}]}`.
Na API, porém, o COMPONENTE já era fail-closed — `validateComponents` roda
`isUomCompatible` contra o Item antes de gravar, e `abc`, `KG`, `quilo` e
unidade de outra dimensão já voltavam 400; a linha "Backend" da tabela olhou só
o schema. O buraco era outro: a BASE fora do catálogo estourava a chave
estrangeira e voltava **500** com a mensagem crua do Prisma, e **ativar**
promovia componente legado com unidade inválida, sem a reconferência que a
ativação da Formulação faz.

**A correção.** Tela: base e componente viraram `<select>` do catálogo
`UnitOfMeasure`, carregado uma vez. A base oferece o catálogo inteiro — o
Modelo não tem Item de saída, e a unidade da base é a dimensão da própria
matriz —; o componente, só a dimensão do seu Item, pela mesma
`unidadesDaDimensao` que a Formulação passou a usar (`lib/uom-options.ts`). Sem
Item, sem unidade; escolhido o Item, entra a unidade de estoque dele; trocar de
Item mantém a unidade que serve ao novo e troca a que não serve — quantidade
nunca é convertida. Unidade gravada fora da lista aparece como "Unidade
inválida ou legada: X", ligada ao campo, e prende o salvar até alguém escolher.
API: base fora do catálogo é 400 com nome (`UomNotFoundError`), antes de
consumir código da sequência; ativar reconfere cada componente e recusa o
legado; a API nunca escolhe unidade por quem chama. Auditoria somente leitura:
DEV 13 componentes e PROD 7, todos em `kg` sobre Item de massa — nenhum fora do
catálogo, nenhum incompatível. Sem migration; a FK do componente virou
recomendação (FORM-UOM-FK-01). Regra durável:
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §35.

**O registro de antes da implementação**, mantido como estava:

| | Formulação (versão real) | Modelo de Formulação |
|---|---|---|
| Unidade da base | derivada do Item de saída, exibida, não digitável | `<input type="text">` livre (`FormulationTemplateDetailPage.tsx:463`) |
| Unidade do componente | `<select>` filtrado pela DIMENSÃO do Item (`unitOptionsForRow`, `FormulationVersionPage.tsx:738-742`) | `<input type="text">` livre (`:532`) |
| Backend | `isUomCompatible(component.unitCode, item.unitCode, units)` em três pontos de `formulations.service.ts` | `z.string().trim().min(1).max(20)` — não confere catálogo nem dimensão |
| Banco | — | `FormulationTemplateVersion.outputUnitCode` **tem** FK para `UnitOfMeasure`; `FormulationTemplateComponent.unitCode` é `String` **sem** FK |

Ou seja: hoje o componente de um Modelo aceita `KG`, `kgs`, `quilo` ou `abc`, e
nada recusa antes do banco. A unidade da base é salva por uma FK, então texto
inválido é recusado — mas pelo erro do banco, não por uma regra que explique.

**A regra proposta:** unidade vem do cadastro oficial de UOM, nunca de texto
livre, no Modelo **e** na Formulação; e a lista oferecida é filtrada pelo que o
motor sabe converter — massa oferece `kg`/`g`/`mg`, e um item de contagem como
uma caixa de papelão não passa a aceitar `kg` só porque `kg` existe no catálogo.
Não nasce catálogo novo: `UnitOfMeasure` e `isUomCompatible` já são a fundação,
e a Formulação já as usa.

**A API precisa ficar fail-closed junto.** Dropdown é conveniência; a recusa é
regra. Hoje a schema do Modelo aceita qualquer string de até 20 caracteres, e
um cliente que não seja a tela grava o que quiser.

**Migration: AUDITAR, não assumir.** As colunas já guardam código de UOM, e o
`outputUnitCode` já é FK — o que falta é a FK do `unitCode` do componente. Se a
implementação concluir que precisa criá-la, é **STOP GATE**: dado legado com
unidade fora do catálogo travaria a migration, e essa é uma decisão de domínio,
não um detalhe técnico.


#### TEMPLATE-APPLY-BASE-UOM-01 — aplicar Modelo reinterpretava a base em outra unidade — **RESOLVIDO em 2026-09-10**

Achado de FORM-UOM-01, promovido a **P0** pelo PO — integridade física da
Formulação. A Formulação lê a base na unidade do seu Item acabado
(`outputUnitCode`, retrato do Item na criação da versão), e aplicar copiava só
o NÚMERO da base do Modelo. Reproduzido antes da correção: 1 kg num Produto em
g nascia "1" — um grama —, 1 L num Produto em mL nascia "1", e 1 kg num Produto
em `un` nascia "1 un", com 201. Treze de dezesseis casos falhavam.

**A regra agora.** Mesma unidade copia. Mesma dimensão converte pelo fator do
catálogo (`convertUomDecimal`, em Decimal; os fatores do seed conferidos em
teste): 1 kg → 1000 g, 1000 g → 1 kg, 1 L → 1000 mL, 0,001 kg → 1 g. Dimensão
diferente — massa, contagem, volume — recusa com 409 e "A unidade da base do
Modelo (kg) não é compatível com a unidade do Produto (un).", sem criar nem
preencher nada. Os componentes não mudam: por base, descrevem a proporção
física da base, e 100 g por 1 kg são 100 g por 1000 g. O que conta por UNIDADE
ACABADA — componente por dose ou por unidade, dose por embalagem — não
atravessa a troca de unidade sem mudar de tamanho, e recusa também, com
motivo; converter esses números é decisão futura. Base que passaria de 12
casas na conversão recusa. A regra vale no rascunho vazio que o Modelo
preenche e na versão que nasce, dentro da transação. Sem migration: a
Formulação já guarda a unidade da base. Regra durável:
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §35.

#### INDUSTRIAL-RATE-VALIDITY-01 — vigência de tarifa industrial — **RESOLVIDO em 2026-09-09**

Regra durável em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md), **§79**.

**A suspeita original não se confirmou, e a auditoria já tinha dito isso.** Com
tarifa A (`effectiveAt` 01/01/2026) e B (`effectiveAt` 01/09/2026), agosto
sempre respondeu A e setembro sempre respondeu B. O caso está travado em teste
(`rate-validity.test.ts`, caso G, e o cálculo real em `rate-validity-api.test.ts`)
para não regredir. Snapshots seguem intocados.

**O defeito REAL era a borda do dia, e foi corrigido.** `isRateCurrent`
comparava instantes crus: o marcador de "válida até hoje" é `00:00:00.000`, e
qualquer relógio depois disso já declarava a tarifa histórica — ela morria
durante o próprio dia impresso nela. A comparação passou a ser entre DIAS
CIVIS, inclusiva nas duas bordas, com o mesmo `diaDaColunaDeData` que §71 e §73
já usam. Reprodução antes da correção: o caso F reprovava com
`expected false to be true`.

**O relógio saiu das decisões de vigência.** `toResourceDTO` não aceita mais
"hoje" implícito — a data de referência é obrigatória —, e os read models
(detalhe, listagem, pendências da estrutura, DTO de uso, congelamento na
ativação) perguntam pelo **dia comercial** (`marcadorDeHojeComercial`), não pelo
relógio do processo, que em Railway é UTC. Tarifa registrada sem vigência
informada passou a nascer como MARCADOR de dia civil, e não como o instante do
clique: a coluna deixou de misturar duas codificações.

**Auditoria de dados, somente leitura.** PROD: 9 recursos, 10 tarifas, **zero**
com `validUntil` e **zero** com `effectiveAt` fora do marcador de dia — o
defeito era latente lá, e nenhuma linha muda de interpretação com a correção.
DEV: 125 tarifas, 22 com `effectiveAt` gravado como instante de madrugada (o
padrão antigo), todas de fixture de suíte. Zero backfill, zero dado alterado.

**A interface nunca ofereceu "válida até".** `validUntil` só é LIDO na coluna
do histórico; não existe campo para escrevê-lo. Por isso a borda corrigida só
era alcançável por API ou carga — e por isso o E2E prova a borda de INÍCIO, que
é a que a tela consegue criar, com as bordas de fim provadas de forma
determinística em teste de API.

**Sobreposição continua em DISCOVERY, reconciliada com
SUPPLIER-OFFER-OVERLAP-01.** Criar B não encerra A: as duas ficam sem
`validUntil`, o histórico marca **as duas** como "Vigente" e só o resumo do topo
diz qual o motor usa. O banco permite (nenhuma constraint), o service permite
(nenhuma validação), o desempate é determinístico (`effectiveAt` mais recente,
depois `createdAt`) — e **PROD já tem 1 recurso nesse estado**. As opções —
encerrar a anterior, bloquear, alertar, ou permitir com prioridade explícita —
não foram escolhidas aqui: são a mesma pergunta nos dois lados do custo e
precisam de uma resposta só. O estado atual está travado em teste, para que a
mudança de política seja deliberada.

**F-03-1 e F-07-1 foram fechados no FIX-06 (2026-09-08).** O bloco de
custo da Formulação dependia de `version?.components.length` para recarregar:
mudar a quantidade de um componente e salvar não muda o tamanho da lista, então
a tela seguia mostrando o custo anterior até um F5. Agora quem salva pede a
estimativa nova ao servidor — nada é recalculado no navegador — e, enquanto
houver edição pendente, o bloco se identifica como o do último salvamento
(§54). Na Sugestão de Compra, cinco células imprimiam a string da API direto no
JSX; passaram por `formatQuantity`, o mesmo das colunas vizinhas. O dado cru não
mudou: a correção é de exibição.

**PROD-ERR-01 foi fechado em 2026-09-08.** `mapDomainError` de
`production-orders.routes.ts` ganhou a mesma linha que os dois irmãos já tinham
— `400 customer_mismatch`, mensagem do domínio intacta, corpo só com
`{ error, message }`. Nenhum service, nenhuma regra e nenhuma tela mudaram.

**F-08-2 foi fechado no FIX-03 (2026-09-08).** Atingia **164 dos 214 produtos
aprovados (77 %)**: a tela carregava 50 produtos por código e procurava o produto
da OP dentro dessa página, onde `undefined` virava "inválido" — e o campo Produto
abria em branco. A ordem passou a ser resolvida por identidade, pelo DTO que ela
já traz; nenhum endpoint novo, nenhuma requisição a mais.

**F-06-1 e F-06-2 foram fechados no FIX-04 (2026-09-08).** O saldo em aberto já
estava escrito acima do campo e a tela não o usava: digitar 80 contra 50 só era
recusado pelo servidor, depois do diálogo de irreversibilidade, e o alerta ficava
na tela depois de a quantidade ser corrigida. O veredito por linha passou a ser
DERIVADO — erro que mora em estado é erro que sobrevive à correção. O servidor
continua recusando igual.

**F-09-1 e F-07-2 foram fechados no FIX-05 (2026-09-08).** `getReservationStatus`
resolvia `getAvailableByItems` e parava aí: a tela do Pedido sabia que o
disponível era zero e não sabia por quê, enquanto a Posição de Estoque já
escrevia "aguardando liberação da Qualidade" na própria linha pelo irmão
`getUnavailabilityByItems`. Os dois passaram a sair da mesma resolução, em lote,
e a tela do Pedido repete a frase do Estoque em vez de montar a sua. A ação
continua bloqueada — o que mudou é que ela diz o motivo, a quantidade que falta
e o caminho até a posição do item. Nenhum endpoint novo, nenhuma requisição a
mais. F-07-2 saiu junto por ser o mesmo G3 pelo outro lado: a coluna da OP passou
a se chamar "Disponível para esta OP", com a ⓘ explicando por que a Posição de
Estoque mostra menos. **Cálculo intocado nas duas pontas.**

**Os dois achados abertos pelo FIX-05 foram fechados no FIX-05b (2026-09-08).**
Ordem de Produção CANCELADA deixou de prender o Pedido — a contagem passou a usar
um conjunto explícito de estados que prendem, com COMPLETED dentro dele de
propósito —, e a ação de cancelar passou a existir na tela para pedido em
atendimento, que é onde a regra do domínio sempre valeu. `CustomerMismatchError`
deixou de escapar de `apply-fulfillment-plan` como 500: virou
`400 customer_mismatch`, o mesmo par que o módulo de Projetos já usava. Nenhuma
OP é apagada; a cancelada continua no histórico.

**F-03-1 viola §54** ao pé da letra: "é proibido mostrar dois números de
momentos diferentes sem dizer qual é qual".

#### QUOTE-DUPLICATE-01 — "duplicar como nova versão" — GATE DE PREÇO RESOLVIDO

**Fechado em 2026-09-11 — regra durável em `PRODUCT_RULES.md` §85.** Cada
versão que não é rascunho oferece "Duplicar como nova versão", com a escolha de
preço obrigatória e sem padrão; zero migration. O registro abaixo fica como
histórico.

**Achados da entrega (novos, sem posição na fila):**
- **QUOTE-NEW-VERSION-PATHS-01 — P2.** Dois caminhos criam versão com efeitos
  diferentes: "Criar nova versão"/"Novo orçamento" parte da mais recente, herda
  sozinho o preço do caso seguro de §74 e substitui a enviada; "Duplicar como
  nova versão" parte da escolhida, pergunta o preço e não substitui nada. O PO
  decide se os dois convergem.
- **QUOTE-DUPLICATE-ORIGIN-01 — P3.** A versão nova não guarda de qual nasceu:
  a linha com preço mantido diz no motivo; com "revisar", nada fica. Uma coluna
  de origem exigiria migration, evitada nesta entrega.

Vindo do walkthrough real (2026-09-09). A auditoria de código mostra que **a
maior parte disto já existe**, e que um dos comportamentos pedidos foi
deliberadamente REMOVIDO por COM-PRICE (§74). Registrado como reconciliação, não
como build.

`createQuoteVersion` (`quotes.service.ts:271`) já cria a versão nova em `DRAFT`
e já copia, da versão anterior: moeda, observações comerciais, condições de
pagamento, prazo de entrega, desconto, método de pagamento, entrada, número e
intervalo de parcelas, juros — e as linhas com produto, quantidade, unidade e
ordem. Não copia status, não recalcula CMV, não rebaseia precificação (cada
proposta confirma a própria base econômica) e sugere a validade quando a
condição inteira é herdada.

O que o pedido traz de NOVO, e vale trabalho:

- **duplicar uma versão ESCOLHIDA.** Hoje a fonte é sempre
  `project.quoteVersions[0]` — a de maior `versionNumber`. Com V5 existindo não
  há como partir da V3;
- **a ação não se chama duplicar.** A entrada é "nova versão", e a pessoa que
  quer V4 a partir da V3 não encontra o caminho;
- **rascunho aberto intercepta.** Havendo `DRAFT`, a função devolve esse
  rascunho em vez de criar — correto para não multiplicar negociação paralela,
  mas é o que alguém pedindo "duplicar" leria como ação ignorada.

**O conflito era o preço.** O handoff original pedia "copiar preços". §74
decidiu o contrário: preço só nasce preenchido no único caso seguro — condição
ACEITA do mesmo projeto e produto, ainda vigente, mesma quantidade física — e
aí com proveniência (`INHERITED_AGREEMENT`). Copiar `unitPrice` em silêncio era
exatamente o defeito que COM-PRICE corrigiu.

### GATE RESOLVIDO — decisão do PO em 2026-09-10

**Não há herança silenciosa de preço, e passa a haver escolha explícita.** As
duas coisas ao mesmo tempo: §74 continua de pé porque o silêncio acabou, não
porque a cópia foi proibida.

A ação abre uma confirmação que mostra a versão de ORIGEM e o estado real dela
("V3 · Enviado"), e oferece duas opções:

- **Manter os preços da V3** — copia `unitPrice` exatamente da versão escolhida;
- **Revisar os preços** — a versão nova nasce sem `unitPrice` nas linhas que
  exigem decisão, seguindo o comportamento canônico de hoje.

**Nenhuma vem pré-marcada, e a confirmação não avança sem escolha.** Um default
seria a herança silenciosa de volta, com um passo a mais.

**Origem SENT ou REJECTED é REFERÊNCIA, não acordo.** A copy não pode chamar
aquilo de "preço acordado": proposta enviada e não aceita é o que a Veridi
ofereceu, não o que o cliente aceitou. Copiar continua permitido — depois da
escolha. Origem ACCEPTED pode ser descrita como o preço da condição aceita, e
mesmo assim a versão nova nasce `DRAFT` e o preço segue editável: duplicar não
transforma nada em acordo.

**Fora deste corte:** nenhuma terceira opção de "atualizar para o preço atual".
Rebase e reprecificação continuam ação separada e explícita, e nada de
recalcular CMV, precificação ou preço sugerido por causa da duplicação.
Snapshot de custo histórico não é copiado como se fosse cálculo corrente — a
versão nova congela o que for dela no envio, pelo mecanismo que já existe.

**O que sempre copia** continua sendo o que `createQuoteVersion` já copia:
produtos, quantidades, unidades, ordem, observações, condições de pagamento,
desconto e prazo. A origem não é alterada — lida junto com §70, que já decidiu
que aceitar uma versão nova supera as aceitas em aberto, e essa mudança de
status na anterior é legítima e separada desta ação.

#### PRICING-TEMPLATE-FLEX-01 — Modelo de Precificação flexível e custos opcionais — P1-1 (decisão do PO, 2026-09-10)

**Fechado em 2026-09-11 — regra durável em `PRODUCT_RULES.md` §84.** O Modelo
(a Política TPP) diz custo industrial, impostos estimados, gestão externa e
perfis tributários indicados; uma migration aditiva, defaults = comportamento
anterior. A direção original fica abaixo como registro.

**Achados da entrega (novos, sem posição na fila):**
- ~~PRICING-MODEL-VIEW-01~~ — **fechado em 2026-09-14** (PRICING-MODEL-VIEW-01): o PDF de Precificação conta a
  mesma história da tela — seção do Modelo (padrão em uma linha; flexível com custo industrial, impostos e
  gestão externa, sem valor de modo desligado), "Custo p/ preço/un" na tabela de faixas, "Custo do cálculo" na
  de custo e aviso de custo incompleto pelo custo que formou o preço. O Orçamento não mostra CMV nem margem
  (nada a mudar); relatórios e CMV seguem no item abaixo.
- ~~PRICING-MODEL-VIEW-REPORTS-01~~ — **fechado em 2026-09-14** (REPORT-ROBUSTNESS-WAVE-01): R-19, R-20 e a
  "Precificação vigente" do CMV dizem o Modelo com as palavras do PDF e mostram "Custo do cálculo" e "Custo p/ preço"
  lado a lado; a linha enviada do R-20 diz "Não congelado no envio" — o snapshot que falta está em
  R20-SENT-PRICING-BASIS-SNAPSHOT-01. Texto original: R-19 (Precificação por produto: "Custo/un" do `costPerUnitSnapshot`
  ao lado de margem, markup e contribuição), R-20 (Orçamento × Precificação: custo industrial/un e margem da
  linha) e "Precificação vigente" da tela de CMV (margem da faixa ao lado do CMV simulado) repetem o que o PDF
  fazia: com Modelo não padrão a margem saiu do custo p/ preço, o número ao lado é o do cálculo e nada diz o
  Modelo. A faixa ativa tem `pricingCostPerUnitSnapshot`; a linha enviada do Orçamento não congela o custo p/
  preço — alinhar o R-20 pede snapshot novo (decisão de schema).
- ~~PRICING-MODEL-DIFF-01~~ — **fechado em 2026-09-14** (COST-PRICING-CLARITY-WAVE-01): o diff compara
  modos, o valor que cada modo lê e a gestão externa. Perfis tributários ficam fora de propósito — só
  sugerem o Modelo, não mudam número (§84).
- ~~PRICING-ACTIVATE-CONFIRM-01~~ — **fechado em 2026-09-14** (COST-PRICING-CLARITY-WAVE-01): a faixa
  serve `pricingCostQuality` e a tela pergunta por ela, a mesma que o servidor pesa.

O Modelo de Precificação
passava a aceitar parâmetros opcionais, sem obrigar a Veridi a controlar no ERP
custos que hoje o financeiro externo gerencia. Componentes auditados: custo de
materiais, custo industrial, impostos estimados, custos administrativos e
financeiros, comissão e margem.

**Direção do PO:**
- **custo industrial:** não considerar; percentual sobre uma base
  explicitamente definida; R$ por unidade; R$ total. Nunca "10%" sem dizer
  10% de quê;
- **impostos:** não considerar; % sobre um preço ou base comercial definido;
  R$ por unidade; R$ total. O Perfil tributário do Cliente
  (`Customer.taxProfile`, §83 — CUSTOMER-TAX-PROFILE-01, fechado) pode sugerir
  o Modelo, nunca determina o imposto;
- **gestão externa:** o Modelo precisa representar custos adicionais que o
  ERP não gerencia;
- **"não considerar" não é zero:** valor efetivamente zero e parâmetro fora
  deste cálculo são estados distintos, e zero não pode ser a única
  representação do segundo;
- **desabilitar não apaga:** a linha de custo desligada guarda a configuração
  para ser religada — a modelar;
- **sem motor fiscal:** percentuais e regras vêm da Veridi e do financeiro; o
  ERP não vira motor tributário automático.

#### CUSTOMER-COMMERCIAL-STATUS-01 — situação comercial viva do Cliente

**Fechado em 2026-09-11 — regra durável em `PRODUCT_RULES.md` §86.** Os dois
gates foram resolvidos pelo PO na execução: **converte** quem teve Projeto
aprovado OU Pedido confirmado, com semântica histórica (`confirmedAt` vale
mesmo depois de cancelado; rascunho e cancelado antes da confirmação não
contam); **Projeto aberto** é aguardando ou amostra — stand-by e cancelado
abrem a janela de 15 dias civis. Derivado na leitura, zero migration. O registro
abaixo fica como histórico.

**Achados da entrega (novos, sem posição na fila):**
- **CUSTOMER-LIST-DEFAULT-E2E-01 — P3.** A lista de Clientes abre em "Clientes
  ativos"; o recém-criado (Prospect) chega pelo contexto. E2E e golden path que
  procuram Cliente pela lista sem contexto podem precisar de "Todos" — não
  verificado nesta rodada (FAST, sem E2E). **Parcial em 2026-09-15
  (E2E-BASELINE-REDESIGN-WAVE-01-02):** confirmado nas E2E —
  `perfil-tributario-do-cliente` caía na edição; ela e `troca-de-cep-do-cliente`
  reabrem o cliente pelo id (`?ids=`), e as três que esperavam a lista por regex
  terminando em `/cadastros/clientes` esperam pelo caminho. Segue aberto para o
  golden path (reescrita D).
- **CUSTOMER-FACTS-LOAD-01 — watch.** Listagem e exportação carregam, para cada
  Cliente da página, os Projetos com o histórico de status e os Pedidos
  confirmados. Número de consultas constante; volume de linhas cresce com a
  história. Medir quando o corpus real voltar.

Decisão de produto de 2026-09-09, vinda do walkthrough real.

**Uma entidade só.** Prospect e Cliente NÃO se separam em cadastros diferentes:
continua existindo `Customer`, e a situação comercial é uma LEITURA dele. Criar
um cadastro de Prospect obrigaria a migrar o registro na conversão, e migrar
registro perde história — o mesmo motivo pelo qual Pedido não é um Orçamento
reescrito.

**Estado DERIVADO, não campo mantido à mão.** A situação sai da história
comercial e das datas; ninguém atualiza um campo. Um `select` que alguém precisa
lembrar de mexer envelhece calado, e um cliente marcado "ativo" há dois anos não
é informação — é um rótulo. **Não criar job** só para virar uma coluna de
`PROSPECT` para `INACTIVE` à meia-noite antes de provar que a persistência é
necessária: derivar na leitura é mais barato e não pode ficar dessincronizado.

**Três situações**, com o rótulo de tela em pt-BR:

| Estado | UI | Significado |
|---|---|---|
| `PROSPECT` | Prospect | Relacionamento comercial em formação, sem conversão |
| `ACTIVE` | Cliente ativo | Já estabeleceu relacionamento comercial efetivo |
| `INACTIVE` | Inativo | Sem oportunidade aberta e fora da janela |

**Não confundir com `Customer.active`.** O booleano que já existe no schema é
operacional — diz se o cadastro pode ser usado em documento novo — e é decidido
por gente. A situação comercial é derivada e responde outra pergunta. Os dois
coexistem e nenhum substitui o outro. Mesma cautela com a palavra "prospect" na
casa: `PRODUCT_RULES.md` §53 e o schema usam **prospectivo** para CUSTO (o que se
espera pagar, contra o custo real). Nada a ver.

**As regras decididas:**

- **nascimento** — `Customer` novo, sem evidência de relacionamento anterior:
  Prospect;
- **janela de 15 dias** — nunca houve conversão, não existe Projeto
  comercialmente aberto, e passaram mais de 15 dias desde a última atividade
  comercial relevante: Inativo. **15 dias é decisão de PO de hoje**; avaliar no
  discovery se vira constante ou configuração. **Não criar configuração nesta
  rodada**;
- **sem Projeto** — criado em D0, nenhum `Project`: Prospect de D0 a D+15,
  Inativo depois. A inclusão exata da data-limite usa a semântica de **dia
  civil** do projeto (§71, §73, `lib/business-day.ts`), nunca um instante
  fabricado;
- **Projeto em andamento** — havendo pelo menos um Projeto comercialmente
  aberto, o cliente sem conversão **continua Prospect**. Não vira Inativo só
  porque `Customer.createdAt` passou de 15 dias;
- **Projeto cancelado** — a última atividade relevante passa a ser o
  encerramento; 15 dias de Prospect e depois Inativo, se nada novo surgir;
- **conversão** — teve em QUALQUER momento um Projeto aprovado: **Cliente
  ativo**, e isso é histórico. **Não regride** por falta de atividade recente;
- **reativação sem botão** — Inativo com Projeto novo aberto volta a Prospect
  sozinho; convertendo depois, Cliente ativo. Não existe ação "Reativar
  cliente": a atividade comercial conduz a situação.

**`ACTIVE` não significa recência.** Cliente ativo é quem já estabeleceu
relacionamento efetivo, não quem comprou nos últimos N dias. Medir compra
recente, cliente dormente e risco de churn é OUTRA dimensão, e misturá-la aqui
produziria um estado que responde duas perguntas e mente nas duas.

**O status devolve o MOTIVO.** Read model, não frase persistida: "Projeto X em
andamento", "Sem oportunidade aberta há mais de 15 dias", "Primeiro
relacionamento aprovado em 18/03/2025". Um estado derivado que não explica de
onde veio é indistinguível de um campo errado.

**GATE antes de implementar — o que prova conversão.** A regra mínima do PO é
"Projeto aprovado", e o schema mostra que ela é INCOMPLETA:
`CustomerOrder.customerId` é obrigatório, `sourceQuoteVersionId` é **opcional** e
não existe `projectId` em `CustomerOrder`. Logo um Pedido confirmado, expedido e
faturado pode existir sem Projeto nenhum e sem Orçamento — em DEV, 13 de 42
linhas de Pedido não têm origem em orçamento. Com a regra mínima, **quem já
comprou direto seria classificado Inativo em 15 dias.** Auditar e levar ao PO:
Orçamento ACEITO, `CustomerOrder` `CONFIRMED` em diante, e qualquer outro caminho
que o domínio já permita. Decisão de PO quando a capability for executada, não
agora.

**Segunda pergunta do discovery:** quais `ProjectStatus` contam como
"comercialmente aberto". Os valores reais são `WAITING`, `SAMPLE`, `APPROVED`,
`CANCELLED` e `STAND_BY` — e `STAND_BY` é justamente o ambíguo. As datas para
derivar já existem: `Project.approvedAt`, `Project.cancelledAt` e
`ProjectStatusHistory.changedAt`.

**Escopo de UX, a implementar com a capability:** filtro na listagem de Clientes
— Clientes ativos · Prospects · Inativos · Todos —, com **Clientes ativos** como
padrão. Na Consulta do Cliente: situação, motivo, "cliente desde" quando
derivável, e resumo de Projetos. **Não é CRM**: sem funil, sem etapa, sem
atividade agendada.

**Fronteira com Projeto.** Situação do `Customer` e situação do `Project` não se
misturam. Um Cliente ativo pode ter ao mesmo tempo Projeto aprovado, Projeto em
desenvolvimento e Projeto cancelado, e **Projeto novo de cliente antigo não o
devolve a Prospect**.

**Contrato não dirige situação** — ver COM-CONTRACT-01. Cliente pode ser ativo
sem contrato cadastrado; os conceitos são independentes.

### BILLED-VALUE-CANONICAL-01 — "Valor faturado" do Painel, do R-15 e do R-14 não era o valor dos documentos — **RESOLVIDO em 2026-09-15**

**Fechado em 2026-09-15**, depois da decisão D1 do PO em
[FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01](../discovery/FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md):
`Billing.totalAmount` é a autoridade do valor faturado. Regra durável em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §30;
proteção em [`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md). Sem migration e sem backfill.

Painel ("Valor faturado"), R-15 (linha, total do filtro, CSV e o PDF, que lê o CSV) e R-14 passaram a ler
`apps/api/src/modules/billings/billed-value.ts`: `valorDoFaturamento` para um documento e `resumirValorFaturado` para
um recorte de emitidos — `SUM` do `totalAmount` congelado no banco, com as linhas carregadas só para os documentos sem
valor congelado. Emitido legado sem total congelado (a migration `20260925093009_billing_commercial_reconciliation`
criou as colunas sem preencher o passado) vale a soma das linhas arredondadas, o mesmo que o documento mostra; sem
preço completo o documento não tem valor e o total não sai. Rascunho não entra em total; no R-14 vale o número do
resumo do Pedido. Prova em `valor-faturado-canonico.test.ts` — documento, resumo do Pedido, R-14, R-15, CSV e Painel com
o mesmo número sem desconto, com desconto, com ajuste de fechamento, com linha arredondada, com vários documentos,
incompleto e legado — e em `r15-resumo-agregado.test.ts`; 9 mutações derrubadas.

Registro original (BACKLOG, seção A, 2026-09-15):

Achado de FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01 (F1), sem correção. **Severidade HIGH** — dinheiro exibido a
todos os perfis. Posição 1 da fila viva; pré-requisito de qualquer Painel Gerencial.

O documento de Faturamento, a lista, o resumo do Pedido e a Visão do Cliente mostravam `Billing.totalAmount`: congelado
na emissão, com desconto apropriado e ajuste de fechamento, e com cada linha arredondada antes da soma (§34, §55). Três
superfícies somavam por conta própria `quantidade × preço` de todas as linhas, sem desconto e sem arredondar a linha:
Painel, "Valor faturado" (`modules/dashboard/dashboard.service.ts:60-72`); R-15, valor por documento, total do filtro,
CSV e PDF (`modules/reports/billing-reports.service.ts:78-92`); R-14, valor de cada faturamento
(`modules/reports/commercial-reports.service.ts:409-426`). Pedido de R$ 1.000,00 com 10% de desconto, faturado num
documento: o documento valia R$ 900,00; Painel, R-15 e R-14 diziam R$ 1.000,00. Duas linhas de `1 × 0,1250`: o
documento somava R$ 0,26; Painel e R-15 diziam R$ 0,25. O teste do Painel só cobria documento sem desconto, e o
comentário de `web pages/customer-consultation/SummaryTab.tsx` dizia que o total do Faturamento não era persistido
(corrigido na mesma entrega).

### MANAGEMENT-DASHBOARD-V1-01 — Painel Gerencial, versão 1 — **ENTREGUE em 2026-09-15**

**Fechado em 2026-09-15**, depois das decisões D2–D5 do PO em
[FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01](../discovery/FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md) (agora
`IMPLEMENTADO`), sobre BILLED-VALUE-CANONICAL-01. Regras duráveis em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §94;
proteção em [`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md). Sem migration.

Gestão → Painel Gerencial (`/gestao/painel-gerencial`) sobre `GET /management-dashboard`, só ADMIN e COMMERCIAL, com a
recusa no servidor: resultado do período com a comparação equivalente, posição atual (A expedir e A faturar pelo preço
acordado antes do desconto), tendência do Faturado, rankings de clientes e produtos, próximos compromissos, "Valores
incompletos" sem subtotal e "Como funciona". O faturado lê `billings/billed-value.ts`. Ficam abertos, sem posição, G2,
G5 e o G4 residual (lista de Pedidos por data de confirmação) — ver a seção "Painel Gerencial — status" do BACKLOG.

Registro original (BACKLOG, fila viva, 2026-09-15): posição 4 — "Decisões de FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01 →
MANAGEMENT-DASHBOARD-V1-01 (Painel Gerencial)", discovery `EM_ANALISE` com D2–D5 abertas; próxima ação "PO fecha D2–D5;
implementar a versão 1"; dependência BILLED-VALUE-CANONICAL-01 entregue.

### CUSTOMER-STATUS-PERMISSIONS-01 · CUSTOMER-STATUS-DRAFT-WARNING-01 — follow-ups da situação cadastral — **FECHADOS em 2026-09-16**

Absorvidos por CUSTOMER-STATUS-HARDENING-01 (P1, pré-homologação). Regra durável em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §95; estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md); proteção em
[`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md). Sem migration.

Decisão do PO: só ADMIN e COMMERCIAL bloqueiam, desbloqueiam, inativam e reativam; os demais perfis consultam situação,
motivo e histórico. A API recusa com 403 antes de olhar o corpo, e a lista de Clientes não oferece a ação a quem não
pode. O aviso de cliente bloqueado ou inativo aparece no Orçamento, no Projeto e no Pedido que ainda podem avançar, a
partir da situação ATUAL que a própria leitura do documento traz — nada gravado no documento, guardas de venda
intactas, nenhum documento alterado ou cancelado.

Registro original (BACKLOG, "Abertos fora da fila", 2026-09-15): "Follow-ups de CUSTOMER-STATUS-LIFECYCLE-01 (§95),
sem posição: quem pode bloquear, desbloquear, inativar e reativar (hoje qualquer sessão autenticada, o mesmo da
inativação de antes) e o aviso na tela do rascunho cujo cliente foi bloqueado depois da abertura (hoje a recusa aparece
no enviar/confirmar)".

### FORMULATION-TEMPLATE-WORKBENCH-01 — a bancada no Modelo de Formulação — **FECHADO em 2026-09-16**

Decididas em 2026-09-16, sobre `FORMULATION-TEMPLATE-WORKBENCH-DISCOVERY-01`, e já **em vigor** na fatia 1:

- **D-1 · forma é premissa técnica da receita.** O Modelo guarda `dosageForm` e o que cada forma usa: cápsulas
  por dose na cápsula; dose e conteúdo da embalagem no pó. Nenhum enum novo.
- **D-2 · apresentação comercial é DEFAULT, não vínculo.** O Modelo pode guardar `presentationType`, conteúdo e
  unidade; a Formulação nasce com eles e segue editável enquanto rascunho. Mudar o Modelo depois não alcança
  formulação nenhuma.
- **D-3 · composição e embalagem, sem schema novo.** A seção sai do TIPO REAL do Item
  (`SECAO_DO_TIPO_DE_ITEM`, `packages/shared`): matéria-prima é composição, embalagem é embalagem. O Modelo
  continua usando Item REAL — nenhuma categoria genérica, nenhum placeholder, nenhum `PackagingSpec`.
- **D-4 · perda prevista no Modelo.** `expectedLossPercent Decimal(9,6)?`, `null` = NÃO INFORMADA (nunca 0%
  presumido), copiada como default ao aplicar. Continua interna: nunca altera quantidade comercial.
- **D-5 · pureza padrão do Item, congelada na versão.** Escolher a matéria-prima traz
  `Item.defaultPurityPercent` como ponto de partida da linha; salvar congela o valor; aplicar copia o que a
  matriz declarou. A aplicação **não** relê o cadastro do Item — Modelo precisa ser reproduzível.
- **D-8 · vocabulário.** Na tela, MODELO e MODELO DE FORMULAÇÃO. Classes, tabelas e rotas continuam
  `Template` — nenhum rename estrutural foi feito (o achado de palavra na UI segue em NAV-TEMPLATE-WORDING-01).
- **D-9 · reserva.** A experiência alvo do Modelo é a mesma da Formulação, com Reserva (%) como coluna.
  `overagePercent` continua interno. O painel antigo "O que a quantidade informada significa" não volta.

**Aprovado conceitualmente, ainda NÃO implementado:**

- **D-6 · itens problemáticos ao aplicar** (item inativo, produto acabado, unidade incompatível): avisar antes
  de aplicar e ainda assim permitir gerar rascunho para correção, com a ativação continuando fail-closed. O
  pré-check e o diálogo são da **fatia 3**; hoje a recusa continua aparecendo na ativação, como sempre foi.

**O que a fatia 1 deliberadamente NÃO fez:** a cirurgia visual em `FormulationVersionPage.tsx` (tabela
compartilhada, W1..W8) — é a **fatia 2**, e a Formulação está em homologação final com o comportamento visual
preservado *integralmente*. O Modelo também não ganhou custo, preço, margem, markup, fornecedor com preço nem
PDF próprio: a matriz guarda premissa técnica, e a Ficha Técnica do Modelo fica para depois, sobre o mesmo read
model.

**Decididas em 2026-09-16, sobre a homologação da fatia 2, e já em vigor:**

- **D-10 · barra de ações fixa.** As ações principais das telas longas ficam numa barra fixa no rodapé,
  visível enquanto se trabalha, nas duas bancadas. Na Formulação: ← Voltar e Salvar como template à esquerda;
  Salvar rascunho e Ativar versão à direita. No Modelo: ← Voltar à esquerda; Salvar rascunho e Ativar versão à
  direita. Uma superfície só — nada duplicado no topo. "Salvar como template" mudou de lugar, não de contrato.
- **D-11 · totais da dose na tabela.** Alvo total por dose, massa total por dose e massa por cápsula fecham a
  TABELA de matéria-prima, no rodapé da coluna que cada um soma. O resumo da receita continua trazendo os
  mesmos números.

**O que a fatia 2 fez:** a bancada saiu de `FormulationVersionPage.tsx` e virou
`apps/web/src/pages/formulation-workbench/` — grade, linha, premissas da forma, premissas de produção, resumo,
prévia do cálculo e catálogo de itens, usados pelas DUAS telas, sem nenhum booleano de domínio dentro deles. O
Modelo passou a ter composição × embalagem pelo tipo do Item, pureza e reserva como colunas, prévia pelo motor
compartilhado e ordenação dentro da seção; o painel "O que a quantidade informada significa" saiu de vez. A
Formulação manteve o comportamento homologado — a extração foi provada antes de o Modelo ser plugado.

**O que a fatia 2 deliberadamente NÃO fez:** o pré-check de itens problemáticos e o diálogo do D-6, o diff das
novas premissas, o acabamento do `UseTemplateDialog`, a padronização textual de MODELO na UI
(NAV-TEMPLATE-WORDING-01 — o botão continua "Salvar como template") e a Ficha Técnica do Modelo. Tudo isso é a
**fatia 3**.

**Fechamento (fatia 3, 2026-09-16).** O D-6 saiu do papel: a ativação do Modelo relê o cadastro do Item e recusa
nomeando cada item; a versão do Modelo traz `componentIssues` (o contrato da Formulação); o diálogo "Usar modelo da
biblioteca" avisa antes e ainda gera o rascunho, com a ativação da Formulação fechada até a correção. Salvar como
Modelo virou uma escrita só, com a receita copiada fiel; o diff explica premissas e ordem; o seletor oferece só item
ativo do tipo da seção e mostra o histórico com a marca "Inativo"; a tela diz MODELO em toda superfície (absorve
NAV-TEMPLATE-WORDING-01). A Ficha Técnica do Modelo ficou para FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01. Regras em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §96–§97; estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md); proteção em
[`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md). Fatias 2 e 3 sem migration.

Registro original (BACKLOG, fila viva, 2026-09-16): posição 2, P0 — "FATIA 2 ENTREGUE", próxima ação "Fatia 3 —
aplicar/salvar, pré-check de itens problemáticos, diff das premissas, acabamento do `UseTemplateDialog` e Ficha Técnica
do Modelo", dependência "FORMULATION-WORKBENCH-01 homologado". A narrativa acima é a seção de decisões como estava na
fila, antes do fechamento.


## Seção A — linhas fechadas das tabelas

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| ~~F-04-1~~ | **Fechado em 2026-09-14** por COST-PRICING-CLARITY-WAVE-01: "A soma da margem e da comissão deve ser menor que 100%" (e a variante com impostos) na API, no motor do shared e na prévia — cálculo intacto | — | — |
| ~~F-05-1~~ | **Fechado em 2026-09-14** por COST-PRICING-CLARITY-WAVE-01: Precificação e Orçamento explicam que o preço técnico tem mais casas e o acordado segue a precisão comercial, e que os centavos de diferença são arredondamento — números intactos | — | — |
| ~~F-11-1~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): o `EntityLink` de cadastro em lista com modal leva `voltar`, e o aviso de lista reduzida oferece "← Voltar para …"; link de menu e de documento sem mudança | — | — |
| ~~PROJECT-RELOAD-ERROR-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): só o 404 (`NotFoundApiError`) vira "Projeto não encontrado"; rede ou 500 mantém a ficha carregada com alerta de recarga e "Tentar novamente", e a leitura boa limpa o alerta — `web projects/projeto-recarga-com-erro.test.tsx` | — | — |
| ~~FORM-ERROR-VISIBILITY-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01: no Pedido e na OC, erro de ação traz o alerta único do topo à vista e dá foco a ele (em 390px ficava a −331/−387 px de quem clicou); com o diálogo de cancelamento aberto, o erro aparece dentro dele — `web customer-orders/pedido-confirmar-grava-antes.test.tsx`, `web purchase-orders/oc-confirmar-grava-antes.test.tsx` | — | — |
| ~~API-INT-COERCION-01~~ | **Fechado em 2026-09-13** por INPUT-DATE-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): inteiro de escrita é lido como decimal inteiro canônico (`lib/integer-schema.ts`) em `projects.schemas.ts`, `lib/industrial-schema.ts` e no `dosesPerPackage` do Modelo (que usava `z.coerce.number()`); `"1e2"`, `"0x1E"`, `"+1"`, `"1.0"`, `"Infinity"` e `true` são 400; faixa, opcional e nulo intocados. A caracterização em `projeto-inteiros-api.test.ts` passou a esperar 400 | — | — |
| ~~QUOTE-PERCENT-FIELDS-01~~ | **Fechado em 2026-09-13** por PTBR-NUMERIC-INPUT-ROLLOUT-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): os três percentuais das condições são `PercentField`, o erro tem `id` e `aria-describedby` no campo, e à vista entrada e juros escondidos não travam "Salvar condições" nem vão à API (`paraEnvio` só lê o percentual em vigor) — `web projects/condicoes-percentuais.test.tsx` | — | — |
| ~~FORMULATION-DOSES-INPUT-01~~ | **Fechado em 2026-09-13** por PTBR-NUMERIC-INPUT-ROLLOUT-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): "Doses por embalagem" é `IntegerField`, e prévia, validação e envio usam a leitura estrita de inteiro — `1e2` não entra, colar `1.234` dá 1234, vazio vai `null`, o inteiro segue como texto como antes; API-INT-COERCION-01 continua valendo para outros clientes da API | — | — |
| ~~PTBR-NUMERIC-INPUT-ROLLOUT-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`UI_BRAND.md`](../UI_BRAND.md), "Campos numéricos e valores pt-BR"): 85 inputs crus em 37 telas e componentes viraram `IntegerField`/`DecimalField`/`MoneyField`/`PercentField` com o `scale` da coluna (`web lib/numeric-scales.ts`), carga por `toPtBrEditText`, borda por `parsePtBrNumber`, pendência pelo valor e payload canônico; os três `type="number"` saíram; `parseDecimalInput`/`AJUDA_DECIMAL` aposentados; guarda estrutural virou proibição com allowlist justificada (CEP). QUOTE-PERCENT-FIELDS-01 e FORMULATION-DOSES-INPUT-01 fechados junto | — | — |
| ~~PTBR-NUMERIC-DISPLAY-AUDIT-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`UI_BRAND.md`](../UI_BRAND.md), "Campos numéricos e valores pt-BR"): `formatQuantity` agrupa milhar como o campo fora do foco (o round-trip do teto tira os pontos antes de ler); ficha e lista do recurso industrial, Estrutura de Custos, templates de custo, consumo extra, Pedido (Plano de Atendimento, colunas de reserva, expedido, somas do Faturamento por `Decimal`), Orçamento fora de edição, ofertas de fornecedor, relatórios, explicação da Formulação, contagens das listas e PDFs formatados; CSV da API mantido (vírgula decimal sem milhar, contrato de planilha); guarda `web components/leitura-numerica-guarda.test.ts` | — | — |
| ~~ORDER-LINE-390-OVERLAP-01~~ | **Fechado em 2026-09-14** por SMALL-MOBILE-UX-WAVE-03 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): com linhas editáveis, abaixo de 640px a linha do Pedido empilha em grade — Produto na largura toda, Quantidade/unidade/remover embaixo; tocar a Quantidade foca o campo e não abre Produto (smoke 390 com toque real); desktop igual — `web customer-orders/produto-do-cliente-do-pedido.test.tsx` | — | — |
| ~~TEMPLATE-ROW-DROP-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): linha com item sem quantidade ou quantidade sem item prende "Salvar rascunho", com a mensagem na linha, `aria-invalid`/`aria-describedby` e foco no campo que falta; só a linha em branco fica fora do payload — `web formulation-templates/modelo-linha-incompleta.test.tsx` | — | — |
| ~~LISTS-LOADING-STALE-DATA-02~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): as 16 listas restantes com `useListQuery`/`useFilteredPage`/`ListStatusRow`; `useScopedList` sobre a mesma consulta, com a página do cliente e sem vazio junto da falha; Quadro de Produção com a resposta da chave atual; Calendário de Produção sem o defeito (chave fixa, uma carga por montagem), mantido; guarda estrutural contra total em `useState` e página de volta à 1 por efeito | — | — |
| ~~LISTS-ERROR-FALSE-EMPTY-ADMIN-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): Usuários e Documentos controlados mostram a falha sem a frase de vazio | — | — |
| ~~LISTS-EMPTY-ROW-390-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): a frase de vazio com ação das listagens (`ListStatusRow`) fica na largura visível do contêiner em 390px | — | — |
| ~~LISTS-EMPTY-ROW-390-RAW-01~~ | **Fechado em 2026-09-14** por SMALL-MOBILE-UX-WAVE-03 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): as 49 linhas de vazio escritas à mão passaram por `TableEmptyRow`, o mesmo corpo com a largura visível do `ListStatusRow`; guarda contra `table__empty` fora dele — `web components/linha-de-vazio-escrita-a-mao.test.ts` | — | — |
| ~~CONSULTATION-CUSTOMER-SWITCH-QUERY-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): trocar de cliente pela mesma rota consulta a aba uma vez, depois do resumo do cliente novo | — | — |
| ~~LISTS-FILTER-INPUT-UX-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): o filtro de período das listagens consulta 300 ms depois da digitação ou no Enter, sem data pela metade nem ano curto; período invertido não consulta | — | — |
| ~~SAVE-FEEDBACK-REMAINING-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): Faturamento, OC, Expedição e Recebimento confirmam só com a resposta, com o rótulo da ação em curso; a OP salva só com pendência | — | — |
| ~~SAVE-ENABLED-NO-DIRTY-01~~ | **Fechado em 2026-09-13** por SAVE-FLOW-HARDENING-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): Pedido e OC salvam só com a pendência da guarda, inclusive no documento novo — não é a exceção da Formulação | — | — |
| ~~BILLING-SHIPMENT-UNSAVED-GUARD-01~~ | **Fechado em 2026-09-13** por SAVE-FLOW-HARDENING-01: Faturamento e Expedição registram a guarda, com faixa e botão de salvar lendo a mesma pendência | — | — |
| ~~SAVE-THEN-COMMIT-STALE-01~~ | **Fechado em 2026-09-13** por SAVE-FLOW-HARDENING-01: emitir, confirmar e conferir releem a resposta da gravação antes da segunda chamada | — | — |
| ~~CONFIRM-DISCARDS-DIRTY-01~~ | **Fechado em 2026-09-13** por CONFIRM-DISCARDS-DIRTY-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): decisão do PO, gravar antes de agir — com a pendência da guarda, "Confirmar pedido" e "Confirmar OC" gravam pelo salvar da tela, esperam a resposta e só então confirmam; sem pendência, confirmam direto | — | — |
| ~~DASHBOARD-COST-BATCH-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): o Painel resolve o custo das 200 OPs concluídas em lote, com a mesma conta da função unitária — 2.650 → 58 SQL e 1,79 → 0,10 s na massa de 200 OPs, DTO idêntico | — | — |
| ~~TZ-FORMATTER-REUSE-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): `instanteComercial`, `minutoDoDiaComercial` e `limitesDoDiaComercial` reaproveitam o formatador por forma de leitura e fuso, como `diaCivil` — ~137 → ~13, ~65 → ~5 e ~268 → ~24 µs; `limitesDaJanelaDeCusto` ~615 → ~50–60 µs; 3,8 milhões de casos iguais à implementação anterior | — | — |
| ~~TZ-LOCALE-STRING-REUSE-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): extensos do shared, `dataCivilPorExtenso` nova (CSV, dia comercial, fonte de custo, Atenção, origem de preço, Orçamento) e `web lib/dates.ts` num formatador guardado — ~55 → ~1–3 µs por data, CSV de 10 mil linhas × 3 datas ~1,4 s → ~44 ms; texto idêntico em cinco fusos do processo, `"Invalid Date"` mantido | — | — |
| ~~ROUTE-CONTEXT-RESTORE-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): na volta do cadastro contextual, a carga inicial do roteiro não escreve por cima do rascunho restaurado — nome, descrição, base, unidade e etapas —, nem na segunda carga do StrictMode; a diferença para o gravado fica pendente até salvar | — | — |
| ~~ROUTE-IDENTIFICATION-SAVE-DRAFT-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): só "Salvar rascunho", ativar e criar versão trazem o rascunho do servidor por cima da tela, normalizado; depois de "Salvar identificação", "Definir padrão" e "Tirar padrão" a releitura mantém base, unidade e etapas pendentes no instante da resposta, e a pendência e a guarda continuam | — | — |
| ~~CONTEXT-ORIGIN-LABEL-ROUTE-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): o cadastro aberto pelo Roteiro diz "← Voltar para Roteiro de produção" | — | — |
| ~~ROUTE-DRAFT-SAVE-INFLIGHT-EDIT-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): preservar, sem bloquear — a ação que grava o rascunho guarda a tela do clique; na releitura, tela que mudou desde então fica e segue pendente contra o gravado (500 salvo, 700 digitado no ar: fica 700), tela igual recebe o normalizado do servidor — `web planning/roteiro-de-producao.test.tsx` | — | — |
| ~~COST-USAGE-RESOURCE-BYID-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): o campo "Recurso" da Estrutura de Custos usa `useRecursosDoSeletor` — criado no contexto e rascunho restaurado fora da página ganham nome pelo id, uma vez; o aviso de energia fora do modo direto confere o recurso resolvido (antes não disparava nunca); a busca tem o recorte da abertura; adicionar espera o tipo e leva `resourceCount` | — | — |
| ~~REPORTS-PRINT-UNACCEPTED-FILTER-01~~ | **Fechado em 2026-09-14** por PRINT-CORRECTNESS-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): cada definição de `REPORT_PRINT_DEFINITIONS` declara `filterKeys` (as chaves do schema da API) e `filterAppliesWhen` (R-02: `from`/`to` só na janela `CUSTOM`); chave de outro relatório, `foo=bar` e paginação não vão ao papel nem disparam consulta de nome; o CSV segue recebendo a URL como veio | — | — |
| ~~FO03-ROW-SITUATION-01~~ | **Fechado em 2026-09-14** por PRINT-CORRECTNESS-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): coluna Qualidade por `situacaoDoLote` (vencido manda, como FO-01/FO-02 e a tela CoA); Pendência pelo laudo com os rótulos da tela CoA — PENDING "Pendente de documento", RECEIVED "Aguardando análise", REJECTED "Laudo rejeitado"; recorte, paginação, ordem e `loadAllPages` intocados. Texto original: FO-03 descreve mal duas pendências do próprio recorte (`OperationalSheetsPdf.tsx`, `QualityPendingPdf`): a coluna Qualidade é `LOT_STATUS_LABELS[lotStatus]` e ignora `isExpired` — no smoke de FO03-PENDING-CUTOFF-01 a pendência com validade 31/01/2026 saiu "Aguardando liberação", enquanto Documentos / CoA diz "Vencido" e FO-01/FO-02 usam `situacaoDoLote`; e a Pendência do laudo rejeitado sai "Aguardando liberação" (o `else` de `pendenciaDoLote`, escrito quando a folha trazia todos os lotes), com o lote bloqueado. O primeiro é uma linha; o texto do segundo é decisão do PO. Anterior à rodada, que não mudou o documento | UX | XS |
| ~~PAGED-DOCUMENT-SNAPSHOT-01~~ | **Fechado em 2026-09-14** por REPORT-ROBUSTNESS-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): `GET /quality/coa-queue?all=true` devolve o recorte inteiro de uma leitura numa transação `RepeatableRead`, com teto de 1.000 lotes (acima: 400 `quality_queue_too_large`, nunca os primeiros N); a FO-03 faz um pedido só e `loadAllPages` saiu. Texto original: `loadAllPages` (`web lib/all-pages.ts`) lê por deslocamento: se entre uma requisição e a seguinte uma pendência sai da fila antes do deslocamento E outra entra depois dele, o total fica igual, nenhuma chave repete e um lote fica de fora sem aviso. Total mudando e chave repetida já lançam; a janela é o intervalo entre as páginas (~ms), só acima de 100 pendências. Fechar pede retrato no servidor (`all=true` com `ALL_ROWS` na fila da Qualidade, ou cursor) — contrato de API, fora de FO03-PENDING-CUTOFF-01 | LOW | S |
| ~~PRICING-PRINT-THOUSANDS-TEST-01~~ | **Fechado em 2026-09-14** por PRICING-MODEL-VIEW-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): o teste procura `1.000 un`, a quantidade pt-BR que o PDF já escrevia, e recusa `1000 un`; a formatação ficou. Texto original: `web pages/print/base-calculada-impressos.test.tsx` falhava na `main` desde PTBR-NUMERIC-DISPLAY-AUDIT-01 (3459833) procurando `startsWith("1000 un")` | — | — |
| ~~REPORTS-PRINT-FILTER-KEYS-DRIFT-01~~ | **Fechado em 2026-09-14** por REPORT-ROBUSTNESS-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): `REPORT_FILTER_CONTRACTS` (shared) guarda `csvPath` e `filterKeys` dos 18 relatórios impressos; a web os lê sem cópia e `api modules/exports/report-filter-contracts.test.ts` compara cada contrato com as chaves do schema da rota CSV. Texto original: `filterKeys` de `REPORT_PRINT_DEFINITIONS` (web) copia à mão as chaves dos schemas de `api modules/reports/reports.schemas.ts`; nenhum teste liga os dois. Filtro novo na API sem a chave na web some do papel (falha segura: o papel omite, nunca inventa). Fechar pede o contrato de chaves no shared ou guarda que leia os dois | — | — |
| ~~NAV-TEMPLATE-WORDING-01~~ | **Fechado em 2026-09-16** por FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §97): Modelos de Formulação e Modelos de Estrutura de Custo dizem "Novo modelo", "Usar modelo", "Nome do modelo", "Salvar como modelo" e "Criar modelo" — botões, rótulos, mensagens da API e ajuda; classes, tabelas, rotas e apelidos da busca de telas continuam `template` — `web formulation-templates/bordas-do-modelo.test.tsx` ("Nomenclatura"). Registro original (UX): "As telas se chamam Modelos de Formulação e Modelos de Estrutura de Custo, mas botões, campos e diálogos seguem dizendo template" | UX | — |
| ~~CUSTOMER-EDIT-PERMISSIONS-01~~ | **Fechado em 2026-09-16** por CUSTOMER-EDIT-PERMISSIONS-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §98; [discovery](../discovery/CUSTOMER-EDIT-PERMISSIONS-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: decisão do PO (opção A) — só ADMIN e COMMERCIAL criam e editam o cadastro (`CUSTOMER_EDIT_ROLES`), 403 na API antes do corpo e da existência, os demais perfis consultam no mesmo modal e não recebem "+ Novo cliente"; sem migration. Registrou CUSTOMER-MASTER-DATA-AUDIT-01 (P2, futuro, seção G) e CUSTOMER-CNPJ-AUTOFILL-01 (P1, aguardando a Veridi, seção C). Registro original (A e "Abertos fora da fila", 2026-09-16): "Quem cria e edita o cadastro do Cliente. Registrado a pedido do PO em 2026-09-16 (HOMOLOGATION-RELEASE-RAILWAY-01), AGUARDANDO DEFINIÇÃO DO PO. Hoje `POST /customers` e `PATCH /customers/:id` só exigem sessão — qualquer perfil cria e edita; CUSTOMER-STATUS-HARDENING-01 restringiu apenas a mudança de situação cadastral (ADMIN e COMMERCIAL, §95). Nada implementado" | — | — |
| ~~CUSTOMER-PAYMENT-DEFAULTS-01~~ | **Fechado em 2026-09-16** por CUSTOMER-PAYMENT-DEFAULTS-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §99; [discovery](../discovery/CUSTOMER-PAYMENT-DEFAULTS-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: forma e condição de pagamento padrão, opcionais, no Cliente; cópia para a primeira proposta real do projeto e nunca leitura viva; "Aplicar padrão do cliente" no rascunho; forma congelada no Pedido; vocabulário forma × condição × observações de pagamento; "Parcelado exige parcelas" no Cliente e no Orçamento (o defeito de parcelado sem parcelas sair à vista no PDF e no Pedido, achado pelo discovery, fechou junto); migration aditiva `20260925093032_customer_payment_defaults`, sem backfill | — | — |
| ~~WEB-SUITE-PREEXISTING-FAILURES-01~~ | **Fechado em 2026-09-16** por WEB-SUITE-PREEXISTING-FAILURES-01, na `main` e fora de PROD: suíte web completa com 3.657 testes e 0 falhas. (1) `web pages/post-e2e-integrity.test.tsx` era teste desatualizado, não valor errado: o "Disponível não reservado" do consumo extra (`ExtraConsumptionDialog`) mostrava o decimal cru da API até PTBR-NUMERIC-DISPLAY-AUDIT-01 (`8db34be`) e passou a ler por `formatQuantityWithUnit` — `3,666667 kg`, os mesmos dígitos de `3.666667`, como Reservado, Saldo reservado e o erro de teto da mesma tela. Voltar a leitura crua faz o teste antigo passar e `web components/leitura-numerica-guarda.test.ts` cair; o teste confere `3,666667 kg` ao lado do rótulo, e o produto ficou como estava. (2) `web pages/ux-acoes-onda-02.test.tsx` acusava defeito real de layout: a edição da linha de recurso da Estrutura de Custos (`8f6ded2`, COST-PRICING-CLARITY-WAVE-01, dois dias depois da guarda de `baf1c99`) pôs "Salvar recurso" e "Cancelar", sempre juntos, numa `.line-actions`; o contêiner virou `.form-actions`, com botões, handlers, `disabled` e ordem intactos e sem exceção nova em `EXCLUSIVAS_POR_ESTADO`. W10 não caiu na suíte e segue na watchlist. Texto original: "Duas falhas da suíte web completa na `main`, vistas em 2026-09-16 (3554 testes, 2 caem, iguais em `3159180` e `5b7c1a3`): `post-e2e-integrity.test.tsx` ("mostra o saldo livre antes de o operador pedir" procura `3.666667`, provável formato pt-BR depois do PTBR-NUMERIC-INPUT-ROLLOUT-01 — conferir se é teste desatualizado ou valor errado) e `ux-acoes-onda-02.test.tsx` (a guarda acusa `pages/industrial-costs/IndustrialCostPage.tsx:1155` com duas ações diretas numa `.line-actions`)" | — | — |
| ~~MASTER-DATA-EDIT-PERMISSIONS-01~~ | **Fechado em 2026-09-16** por MASTER-DATA-EDIT-PERMISSIONS-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §100; [discovery](../discovery/MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: DE1–DE12 do PO — Item com Compras, Qualidade, Produção e ADMIN (controles só Qualidade e ADMIN pela mudança de valor, "Consumido na produção" só Produção e ADMIN, custo de referência inicial só Comercial e ADMIN, inativar Compras/Qualidade/ADMIN, reativar Qualidade/ADMIN); Fornecedor com Compras e ADMIN; Produto com Comercial e ADMIN, inclusive a criação direta aprovada, e "Exige CoA" só para o PA que nasce junto; 403 antes do corpo e da existência (`exigirPerfil` em `lib/current-user.ts`); 409 de situação; consulta no mesmo modal; criação contextual e "Nova relação" por perfil; sem migration. Registrou ACQUISITION-COST-PERMISSION-01 (P1, seção A), ATTACHMENT-ACTIONS-BY-ROLE-01 (UX, seção A), MASTER-DATA-STRUCTURAL-LOCKS-01 e MASTER-DATA-STATUS-HISTORY-01 (seção G). O item não tinha registro aberto no BACKLOG: o discovery foi entregue só no chat | — | — |
| ~~ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01~~ | **Fechado em 2026-09-16** por ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §101; [discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md) `EM_ANALISE`, D3 decidida), na `main` e fora de PROD: `POST /supplier-items` aceitava `qualificationStatus` `APPROVED` ou `BLOCKED` de Compras, a decisão que a rota de homologação recusava com 403. Agora a relação que Compras cria nasce `PENDING`, e pedir outra situação é 403 com o motivo, antes de qualquer leitura e sem gravar relação, oferta, histórico nem troca de preferencial; homologar e bloquear, também na criação, são de Qualidade e ADMIN (`SUPPLIER_ITEM_QUALIFICATION_ROLES`); voltar para pendente segue com Compras, Qualidade e ADMIN; ADMIN mantém a criação com situação explícita; preferencial, oferta, histórico e motor de custo sem mudança; na tela de Compras, "Situação inicial: Pendente" sem seletor; sem migration. O discovery, entregue só no chat, foi persistido na mesma rodada; ITEM-SUPPLIER-UX-01 (Fatias 1 e 2) ficou na seção G. O item não tinha registro aberto no BACKLOG | — | — |
| ~~ITEM-SUPPLIER-UX-01~~ | **Fechado em 2026-09-16** por ITEM-SUPPLIER-UX-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §102; [discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: a seção Fornecedores do modal do Item era só leitura, e criar a relação, homologar e definir o preferencial exigiam sair para Compras › Item × Fornecedor. Com D1–D5 do PO, a seção lista as relações reais do item (preferencial primeiro, inativas à vista, marcas separadas de relação e fornecedor inativos, oferta de hoje) e administra: Compras e ADMIN adicionam fornecedor com o Item fixo (Compras cria `PENDING`) e definem o preferencial com confirmação que diz quem sai, pela rota atômica; Qualidade e ADMIN homologam e bloqueiam no detalhe aberto por cima do Item; os demais consultam; duplicidade leva à relação existente, também pelo 409. Tela geral mantida (D2); Fornecedor → Itens virou SUPPLIER-ITEMS-UX-01, na seção G (D4); lead time fora (D5). Corrigidos no caminho: Escape da confirmação fechava o modal de baixo, e em 390px a coluna de ações fixa cobria o nome do fornecedor. Sem migration e sem API nova | — | — |
| ~~LABEL-ATTACHMENTS-01~~ | **Fechado em 2026-09-16** por LABEL-ATTACHMENTS-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §103; [discovery](../discovery/LABEL-ATTACHMENTS-ARCHITECTURE-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: arquivo versionado do Item Rótulo (tipo PACKAGING e subtipo LABEL, nunca pelo nome) em tabela própria `item_label_file_versions` (migration aditiva `20260925093033`); versões imutáveis com vigente derivada; PDF, PNG e JPEG até 25 MB por extensão, tipo declarado e assinatura; objeto gravado antes da versão, com compensação; anular com motivo sem apagar bytes; restaurar como versão nova com o objeto da origem; download autenticado em streaming; enviar e restaurar Compras, Qualidade, Comercial e ADMIN, anular Qualidade e ADMIN; seção "Arquivo do rótulo" no modal do Item. `StorageAdapter` com `LOCAL_FS` e Cloudflare R2 (`@aws-sdk/client-s3`), provedor gravado por versão, `pnpm storage:r2:smoke`. Railway não tocado; R2 pronto e desligado. O discovery, decidido no chat, foi persistido na mesma rodada. Registrou STORAGE-R2-ACTIVATION-01, ATTACHMENTS-R2-MIGRATION-01 e LABEL-FILE-SUBTYPE-CHANGE-01 (seção G). O item não tinha registro aberto no BACKLOG | — | — |
| ~~SUPPLIER-QUALITY-REJECTION-REASON-01~~ | **Fechado em 2026-09-16** por SUPPLIER-QUALITY-REJECTION-REASON-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §104; [discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md)), na `main` e fora de PROD: a relação Item × Fornecedor podia ser bloqueada sem dizer por quê — a observação da decisão era opcional em qualquer situação. Agora `BLOCKED` exige motivo em texto livre (aparado, de 3 a 1000 caracteres, sem lista fechada) na rota de homologação e na criação já bloqueada: sem ele, 400 `validation_error` com a frase e o campo, sem gravar nada; o 403 por perfil segue antes, e nenhuma permissão mudou. O motivo reutiliza `note` do evento de homologação — sem migration e sem backfill; bloqueio antigo sem motivo continua válido e aparece como "Motivo não registrado". Homologar e voltar para pendente seguem sem motivo. Na tela, "Bloquear" abre "Bloquear fornecedor para este item" com o motivo obrigatório, no detalhe que a tela geral e o cadastro do Item compartilham, e a nova relação bloqueada pelo ADMIN pede o motivo. O item não tinha registro aberto no BACKLOG | — | — |
| ~~ACQUISITION-COST-PERMISSION-01~~ | **Fechado em 2026-09-16** por ACQUISITION-COST-PERMISSION-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §105), na `main` e fora de PROD: `PUT /receipt-lines/:id/acquisition-cost` gravava o custo efetivo de aquisição — fonte REAL do lote e das médias de 30 e 90 dias — para qualquer sessão, e o recebimento da OC aceitava o mesmo custo de qualquer perfil. Decisão do PO: Compras e ADMIN (`ACQUISITION_COST_ROLES`) nas duas portas. O PUT recusa os demais com 403 antes do corpo e da linha, sem gravar; o recebimento de outro perfil que traz custo é 403 antes do corpo e da OC, sem recebimento, lote nem movimento, e receber sem custo segue aberto a todos. `costUpdatedBy` passou a ser o usuário da sessão (era "Ambiente local"). Na tela, "Definir/Atualizar custo" no documento e o campo de custo com "Usar preço da OC" em "Receber OC" só para quem informa; os demais consultam o custo e leem a quem ele cabe. A conta de REAL, 30D e 90D não mudou; sem migration. Registro original (P1, seção A, DE12 de MASTER-DATA-EDIT-PERMISSIONS-01): "VIEWER define o custo real que a seleção automática (§53) usa antes de qualquer oferta ou referência" | — | — |
| ~~ASSISTED-ENTITY-SELECTOR-FOUNDATION-01~~ | **Fechado em 2026-09-17** por ASSISTED-ENTITY-SELECTOR-FOUNDATION-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; padrão em [`UI_BRAND.md`](../UI_BRAND.md), "Assisted consultation from a search field"), na `main` e fora de PROD: fundação de consulta assistida para seletores de entidade, sem substituir o autocomplete. `SearchableEntitySelect` com "Consultar" opt-in no topo da lista; `EntityConsultationDialog` por cima da tela com o recorte do campo, busca e paginação no servidor, linha recusada desabilitada com motivo e cartões em 390px; piloto `ItemConsultationDialog` na bancada (Formulação e Modelo, matéria-prima e embalagem), com "+ Novo item de estoque" pela criação no contexto de sempre e `?tipo=` da seção. Sem API alterada e sem migration. Registrou ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 (seção G). O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |
| ~~FORMULATION-COMPONENT-BASIS-AUTOMATION-01~~ | **Fechado em 2026-09-17** por FORMULATION-COMPONENT-BASIS-AUTOMATION-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §106), na `main` e fora de PROD: a base de cálculo da linha (`FIXED_BASIS`/`PER_DOSE`/`PER_FINISHED_UNIT`) deixou de ser escolha na bancada. Decisão do PO: ela é consequência da seção e do modo — composição por dose na receita por dose (modo `PER_DOSE`, cápsula ou pó), base fixa senão; embalagem por unidade acabada — e a coluna fica como snapshot técnico. `@veridi/shared` com a regra única (`receitaPorDose`, `baseDaSecao`, `baseDoComponente`); API deriva em toda gravação de rascunho da Formulação e do Modelo, realinha as linhas gravadas na troca de modo ou forma, deriva na cópia de versão, na nova versão do Modelo, ao aplicar e ao salvar como Modelo, e descarta `basis` do corpo; ativa, inativa e arquivada intactas. Bancada sem coluna nem seletor de Base, Fornecimento mantido, prévia pela base derivada, aviso e pendência para rascunho legado, base gravada explicada na ajuda do cálculo de versão fechada. DEV (carga de PROD) sem nenhuma das 1.330 linhas fora da regra. Sem migration. O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |
| ~~INVENTORY-INACTIVE-ITEM-VISIBILITY-01~~ | **Fechado em 2026-09-17** por INVENTORY-INACTIVE-ITEM-VISIBILITY-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §107), na `main` e fora de PROD: item inativo não some do estoque físico. Fatia 1 de MASTER-DATA-INACTIVE-VISIBILITY, decisões D1–D3 do PO ([discovery](../discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md), persistido na rodada): `GET /inventory` e o CSV sem o `active: true` fixo — inativo com posição (saldo, reservado ou em compra) aparece marcado, sem posição só com `includeInactiveWithoutPosition`, CSV com o mesmo recorte e "Item ativo"; `itemActive` no DTO; entrada manual de inativo recusada (400 `inactive_item`), saída, perda e Contagem rápida permitidas; Web com o filtro, as marcas, o ajuste sem entrada para inativo e a busca da Contagem rápida achando o inativo. Sem migration. O item não tinha registro aberto no BACKLOG: veio do discovery entregue no chat | — | — |
| ~~ASSISTED-ENTITY-MULTISELECT-01~~ | **Fechado em 2026-09-17** por ASSISTED-ENTITY-MULTISELECT-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; padrão em [`UI_BRAND.md`](../UI_BRAND.md), "Assisted consultation: single or multiple selection"), na `main` e fora de PROD: a consulta assistida opera em seleção única (campo da linha, intacta) ou múltipla, limitada a 10 e explícita (ação da seção). `EntityConsultationDialog` com `selectionMode`, marcação por `recordKey` que atravessa busca, página e recarga, teto dito no rodapé, uma confirmação (`onSelectMany`), presente travado com motivo e sem "+ Novo" na múltipla; papéis de coluna `detail`/`status` para o cartão de 390px. Pilotos: Formulação e Modelo ("+ Adicionar matérias-primas" / "+ Adicionar embalagens", uma linha por item por `linhasDosItensEscolhidos`, base derivada) e recursos do Modelo de Estrutura de Custo ("+ Adicionar recursos", `IndustrialResourceConsultationDialog`). Adendo: colunas por entidade — matéria-prima com fonte/função e pureza cadastrada, embalagem com subtipo, recurso com tipo, capacidade e unidade de uso. Sem API alterada e sem migration. Registrou COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01 (seção G). O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |
| ~~PRODUCT-INACTIVE-COMMERCIAL-GATE-01~~ | **Fechado em 2026-09-17** por PRODUCT-INACTIVE-COMMERCIAL-GATE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §108), na `main` e fora de PROD: Produto inativo não inicia compromisso novo. Fatia 2 de MASTER-DATA-INACTIVE-VISIBILITY, decisões D6–D7 do PO ([discovery](../discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md)): `lib/product-active-gate.ts` recusa com 400 `inactive_product` vincular ao Projeto, linha nova, envio e aceite de Orçamento, aprovação do Projeto, geração e confirmação de Pedido e Amostra nova; a liberação da OP planejada relê Produto e o PA congelado; PA existente e inativo recusa com 400 `inactive_finished_item` em vez de `missing_finished_item`, sem cascata Produto × PA. Rascunho abre marcado e edita, versão nova e duplicação copiam a linha, Pedido gerado e OP liberada seguem, nada é cancelado. Situação atual em `QuoteLineDTO`, `CustomerOrderLineDTO`, `ProductionOrderDTO` e no PA do `ProductDTO`; Web sem o inativo em escolha nova, com marcas, `ProductInactiveNotice` e o aviso de PA inativo no cadastro do Produto. Sem migration. O item estava em "Abertos fora da fila" desde o discovery | — | — |
| ~~ITEM-FORM-BY-TYPE-01~~ | **Fechado em 2026-09-17** por ITEM-FORM-BY-TYPE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §109), na `main` e fora de PROD: o cadastro do Item mostra só o que é do Tipo — matéria-prima com Classificação industrial, embalagem com Dados da embalagem, embalagem Rótulo com Arquivo do rótulo logo depois —, pela autoridade de `Item.type`, nunca da Família nem do nome. Trocar tipo ou subtipo na criação limpa o que ficou escondido, e o envio só leva os campos do tipo (na edição, o gravado escondido fica). O arquivo do Rótulo é opcional, fica na tela até o Item existir e sobe pela rota de LABEL-ATTACHMENTS-01 depois de criar; envio que falha não recria o Item — a tela diz que o item foi criado e abre a seção oficial dele para reenviar, com "Concluir" para o destino normal. `lib/arquivo-do-rotulo.ts` passa a servir às duas telas. Sem API, shared nem migration; `INTERNAL_CONSUMABLE` fora. O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |
| ~~CUSTOMER-CNPJ-AUTOFILL-01~~ | **Reconciliado e fechado em 2026-09-17** por CUSTOMER-CNPJ-LOOKUP-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §111), na `main` e fora de PROD: aprovado pela Veridi, com **OpenCNPJ** como primeiro provedor e **Serpro como provedor futuro**. Mudou de nome de propósito — não é "autofill" (atualização automática), é **assistência ao preenchimento**: `GET /cnpj-lookup/:cnpj?provider=` autenticado e somente leitura (`CUSTOMER_EDIT_ROLES`, §98), chamada externa no servidor com timeout, teto de resposta e parsing que não confia no payload; diálogo com a fonte, comparação Atual × Retornado contra o **estado do formulário**, diferença aplicável marcada por padrão, vazio da fonte que nunca apaga valor existente, Cancelar sem efeito e falha externa que mantém o cadastro manual inteiro; abstração `CnpjLookupProviderAdapter` + registro, para o SERPRO entrar como segundo adaptador sem reescrever tela, endpoint nem contrato; perfil tributário (§83), pagamento (§99), notas e situação (§95) intocados; sem migration. Registro original (C e "Abertos fora da fila", 2026-09-16): "consulta automática de CNPJ no cadastro do Cliente. **NÃO INICIAR SEM APROVAÇÃO EXPLÍCITA DA VERIDI.** Provedor definido: Serpro — Consulta CNPJ Básica. Nada implementado" | — | — |
| ~~FILTER-CSS-640-GUARD-01~~ | **Fechado em 2026-09-17** por FILTER-CSS-640-GUARD-01, na `main` e fora de PROD, só teste: as guardas de tela estreita cortavam `styles/components.css` do ÚLTIMO `@media (max-width: 640px)` até o fim do arquivo, e desde `0c796a90` (CUSTOMER-CNPJ-LOOKUP-01, +118 −0 no CSS) o último é o da tabela da consulta de CNPJ. Eram três, não duas: `web pages/filtros-390px.test.tsx`, `web pages/billings/faturamento-filtros.test.tsx` e `web components/filters/seletor-escolhido-cabe-no-campo.test.tsx`, esta com o mesmo `lastIndexOf`. As três perguntam agora a `declaracoesEmMedia` (`web styles/testing/css-media.ts`) o que o seletor recebe em TODOS os blocos de 640px, e só neles: `.toolbar__search` e `.toolbar__entity` com `min-width: 100%`, `.filter-period__custom` com `width: 100%`. A ordem dos blocos deixou de importar, e a guarda ficou mais estrita que a antiga, que aceitava a regra fora de `@media` ou dentro de comentário depois do último bloco. `components.css` intocado. Registro original (G, 2026-09-17): "as duas guardas de 640px leem só o último bloco do CSS — LOW. `filtros-390px.test.tsx` e `billings/faturamento-filtros.test.tsx` falham na `main` desde `0c796a90`, que acrescentou um `@media (max-width: 640px)` ao fim de `styles/components.css` para a tabela da consulta de CNPJ. A regra de tela estreita continua no CSS; quem está errado é o recorte da guarda" | — | — |
| ~~INTERNAL-CONSUMPTION-REPORT-01~~ | **Fechado em 2026-09-17** por INTERNAL-CONSUMPTION-REPORT-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §117), na `main` e fora de PROD, sem migration: o relatório gerencial de Uso e consumo é o R-21 (Relatórios › Estoque), com filtros de período, item, destino/uso exato, usuário, origem do custo, com/sem custo e busca por `CI-`/Item; KPIs (consumos, valor total conhecido, consumos sem custo, itens distintos) e resumos por item e por destino do recorte inteiro; custo pelos snapshots do `CI-`, valor somando só o custo conhecido e `null` nunca como zero; CSV com o mesmo recorte e PDF pelo documento genérico. Centro de Custo não foi criado (INTERNAL-CONSUMPTION-COST-CENTER-01 segue aberto), a comparação entre períodos não entrou (o handoff não a pediu) e o resumo no PDF virou REPORTS-PDF-SUMMARY-01. Registro original (G, 2026-09-17): "relatório gerencial de uso e consumo (Fatia 3) — anunciado pelo PO no handoff de INTERNAL-CONSUMPTION-01 como a próxima fatia, sem handoff próprio ainda. Consumo por período, por item e por destino, com valor, e provavelmente comparação entre períodos. Depende de INTERNAL-CONSUMPTION-COST-CENTER-01 para agrupar destino de forma confiável" | — | — |
| ~~REPORTS-PDF-SUMMARY-01~~ | **Fechado em 2026-09-17** por REPORTS-PDF-SUMMARY-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md), "Printing policy" e §117), na `main` e fora de PROD, sem migration e sem mudança de API: o documento genérico dos relatórios ganhou o resumo opcional (KPIs, ressalvas, tabelas de agrupamento e o título dos registros), lido da rota JSON da tela com o mesmo recorte do CSV e escrito pela mesma função que a tela usa; o R-21 leva os quatro KPIs, a ressalva do valor, o resumo por item e por destino/uso antes da seção Consumos, e o R-15 os três indicadores; custo nulo segue "Custo não disponível", nunca R$ 0,00. A pergunta do registro ("o papel gerencial precisa dos totais, ou a tela e o CSV bastam?") foi respondida pelo handoff: precisa. Registro original (LOW, 2026-09-17, por INTERNAL-CONSUMPTION-REPORT-01): "O que a tela mostra ACIMA da tabela não está no CSV e por isso não chega ao papel — os KPIs e os resumos por item e por destino do R-21, e o resumo do R-15 (documentos, com preço completo, valor faturado). Levá-los pede uma segunda leitura por relatório (o JSON do mesmo recorte) e uma seção "Resumo" no `ReportPdf`" | — | — |
| ~~CUSTOMER-CNPJ-PERSISTED-DATA-01~~ | **Fechado em 2026-09-17** por CUSTOMER-CNPJ-PERSISTED-DATA-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §119, com a §111 revista), na `main` e fora de PROD, com a migration aditiva `20260925093036_customer_cnpj_registration_data`: o Cliente guarda os dados cadastrais do CNPJ da consulta aplicada e salva — CNAE e descrição, natureza jurídica, porte, abertura, matriz/filial, Simples e MEI (Sim, Não ou não informado), situação na RFB e a data dela, e a última consulta —, como bloco que pertence ao CNPJ: trocar o número descarta o do anterior. Sem integração nova (OpenCNPJ pelo mesmo adaptador); consultar continua sem gravar. Handoff direto do PO, sem registro anterior no backlog | — | — |
| ~~USER-LAST-ADMIN-GUARD-01~~ | **Fechado em 2026-09-17** por USER-LAST-ADMIN-GUARD-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §120; D5 do [discovery](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md)), na `main` e fora de PROD, sem migration: `PATCH /users/:id` recusa inativar ou rebaixar o último ADMIN ativo (`last_active_admin`) e recusa quem tenta isso consigo mesmo, mesmo havendo outro ADMIN (`self_deactivation`, `self_demotion`); contagem e gravação na mesma transação, sob a trava das linhas de ADMIN ativo, e duas edições simultâneas deixam exatamente um. Linha 9u da fila viva (Fatia 0 do discovery) | — | — |
| ~~PRODUCTION-PROFILE-ARCHIVE-01~~ | **Fechado em 2026-09-17** por PRODUCTION-PROFILE-ARCHIVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §121, com a compatibilidade do §89 revista; D4 do [discovery](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md)), na `main` e fora de PROD, sem migration: Arquivar e Desarquivar o Perfil de Produção (Roteiro de Produção na tela) com ADMIN e Produção, pela rota dos Modelos, e 409 na transição repetida; arquivado fora da lista padrão e dos seletores, recusado (409 `profile_archived`) como padrão novo de Produto e em toda aplicação à OP, e tratado pela aplicação automática como padrão fora de ACTIVE — a OP nova nasce sem cópia. O Produto que já apontava continua apontando, com aviso; versões e cópias nas OPs intocadas. Linha 9t da fila viva (Fatia 0 do discovery) | — | — |
| ~~CUSTOMER-CNPJ-EDITABLE-HISTORY-01~~ | **Fechado em 2026-09-18** por CUSTOMER-CNPJ-EDITABLE-HISTORY-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regras em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §122 e §123, com a §111 e a §119 revistas), na `main` e fora de PROD, com a migration aditiva `20260925093037_customer_cnpj_registration_history`: os dados cadastrais do CNPJ viram campos editáveis do Cliente (logo antes de Observações), a consulta ao OpenCNPJ fica aditiva em todos os campos — completa o vazio, só troca o que a pessoa escolher e nunca apaga —, a última consulta vira metadado do sistema no rodapé e toda gravação desses dados deixa um evento só de acréscimo (Edição, Consulta sem diferença ou Troca de CNPJ), com origem Manual/OpenCNPJ por campo e sem histórico retroativo. Junto, a regra global do espaço vertical entre blocos de cadastro (`--block-gap`). Handoff direto do PO; linha 9x da fila viva | — | — |
| ~~MASTER-DATA-HARD-DELETE-01~~ | **Fechado em 2026-09-18** por MASTER-DATA-HARD-DELETE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §125; D1, D2, D3 e D6 do [discovery](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md)), na `main` e fora de PROD, com a migration aditiva `20260925093038_master_data_deletion_history`: exclusão física, só pelo Administrador, do Fornecedor, do Cliente, dos três Modelos e do Roteiro de Produção criados por engano e nunca usados — prévia com as razões, 409 com as referências, catálogo explícito conferido contra o `pg_constraint` com falha fechada, a V1 técnica como filho técnico (o registro do CNPJ da criação ficou bloqueado até a marca estrutural de CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01, abaixo, que fechou a Fatia 1 de vez), transação com trava, recontagem e conferência do efeito real em `pg_stat_xact_user_tables`, e rastro append-only com retrato por lista branca (ALVO no `prod-cleanup`). "Excluir definitivamente" só para ADMIN nas seis telas. Linha 9v da fila viva (Fatia 1 do discovery) | — | — |
| ~~INTERNAL-CONSUMPTION-REVERSAL-01~~ | **Fechado em 2026-09-18** por INTERNAL-CONSUMPTION-REVERSAL-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §126; P1–P10 do [discovery](../discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md)), na `main` e fora de PROD, com a migration aditiva `20260925093039_internal_consumption_reversal`: o consumo interno lançado errado se estorna — `ECI-`, entrada própria `INTERNAL_CONSUMPTION_REVERSAL` no instante do estorno, total, parcial ou em vários, com motivo e o usuário da sessão, só ADMIN e QUALITY; nunca edita nem apaga o CI. Custo copiado do CI (pró-rata com o resto no último, `NO_COST` nulo), sempre o mesmo lote, item inativo permitido; recusa com inventário aberto ou contagem encerrada depois do `createdAt` do CI; já estornado divergente é 409. R-21 líquido na data do CI; extrato e R-03 reconhecem consumo e estorno (R-03 com Entrada/Saída). Laterais registrados: INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01 e DASHBOARD-INTERNAL-CONSUMPTION-01. | — | — |
| ~~CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01~~ (proposto como MASTER-DATA-HARD-DELETE-CNPJ-BIRTH-01) | **Fechado em 2026-09-18** por CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção da exclusão física; regras em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §125 e §114), na `main` e fora de PROD, com a migration aditiva `20260925093040_customer_cnpj_history_creation_marker`: coluna anulável `createdWithCustomerId` no histórico dos dados do CNPJ, sem FK, sem default e sem backfill, gravada só por `createCustomer` com o id do Cliente que nasce (PATCH nunca marca). Na exclusão física o histórico é tabela interna do Cliente e só o registro com `customerId` e `createdWithCustomerId` iguais ao Cliente, e um só, sai junto; sem marca, com a de outro Cliente ou marcado em dobro bloqueia, sem heurística de hora, ordem ou `xmin`. No saneamento a coluna é marca de origem imóvel: o MERGE move `customerId` e nunca a marca, e o registro movido bloqueia a exclusão do canônico. Fecha de vez MASTER-DATA-HARD-DELETE-01 (9v). Linha 9y da fila viva | — | — |
| ~~VERIDI-SYSTEM-VERSIONING-01~~ | **Fechado em 2026-09-19** por VERIDI-SYSTEM-VERSIONING-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; política em [`RELEASES.md`](../RELEASES.md)), sem migration: o sistema passa a ter versão oficial SemVer, e v1.0.0 é a primeira versão comercial (decisão do PO). Fonte única `VERIDI_VERSION` em `packages/shared/src/version.ts`, com guarda que recusa o número em qualquer outro código de produção; `GET /meta` (com sessão) devolve versão, ambiente (Railway, senão `NODE_ENV`) e o commit do deploy (`RAILWAY_GIT_COMMIT_SHA`), campo a campo; o cabeçalho mostra a versão ao lado de "Nutrition" e abre "Sobre o sistema" com versão, data, ambiente e build lidos da API. | — | — |
| ~~INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01~~ | **Fechado em 2026-09-19** por INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §127; achado L2 do [discovery do estorno](../discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md)), na `main` e fora de PROD, **sem migration**: consumo interno de data ANTERIOR a hoje é recusado (409, nada gravado) quando a posição — item, ou item + lote — foi reconciliada por inventário encerrado (sessão ou Contagem rápida que ajustou ou conferiu) ou já contada num inventário aberto, com `countedAt` desde o início do dia comercial do consumo; "Não ajustar", cancelado, posição retirada e outro lote não bloqueiam; consumo de hoje não passa pela guarda. Reproduzido na `main` `cf8d353e` (Contagem rápida −3, CI de anteontem 201, saldo 4 contra 7 físicos). A recusa diz o inventário, quando encerrou e o caminho; a tela avisa na data passada e leva ao inventário. Entra na v1.1.0. Linha 9za da fila viva | — | — |
| ~~MASTER-DATA-HARD-DELETE-02~~ | **Fechado em 2026-09-19** por MASTER-DATA-HARD-DELETE-02 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §128; D1, D2 e D6 do [discovery](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md)), na `main` e fora de PROD, **sem migration**: exclusão física, só pelo Administrador, do Item (MP, ME, PA e UC), do Produto com o Item de produto acabado nascido com ele e do Recurso industrial criados por engano e nunca usados, sobre a infraestrutura da Fatia 1 — catálogo explícito de cada agregado conferido contra o `pg_constraint` (inclusive o CASCADE do ledger, da referência de custo e da contagem e o SET NULL do Produto e do Projeto), o PA como vinculado do Produto (travado e julgado pelo catálogo do Item; qualquer uso dele bloqueia o Produto, e sem uso sai com ele, num rastro só), o PA nunca sozinho pela rota do Item, e tarifa, roteiro e custo bloqueando o Recurso. "Excluir definitivamente" só para ADMIN em Itens, Produtos e Recurso. Entra na v1.1.0. Linha 9w da fila viva (Fatia 2 do discovery; com ela as três fatias fecharam) | — | — |
| ~~VERIDI-AUDIT-QUICK-FIXES-01~~ | **Fechado em 2026-09-19** por VERIDI-AUDIT-QUICK-FIXES-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regras de D5 e D6 em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md), "Purchase suggestion" e §22-25), na `main` e fora de PROD, **sem migration**: os seis defeitos D1–D6 que VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01 achou por leitura reproduziram com teste vermelho e foram corrigidos — filtro "Vencido" pela validade derivada (Lotes, Produto Acabado, R-01, Materiais de Clientes, fila da Qualidade); "Ir para compras" da OP com o valor de máquina na URL; linha de reserva realocada fora do "falta produzir" e da OP do saldo; Painel "OP com falta" pela conta da OP com o dono do estoque; Sugestão de Compra também no Pedido PARTIALLY_SHIPPED; prazo e observações do Pedido travados na tela depois do plano, como o servidor já exigia |
| ~~DOCUMENT-TRANSITION-CONCURRENCY-01~~ (Fatia 1) | **Fechado em 2026-09-19** por DOCUMENT-TRANSITION-CONCURRENCY-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §129; os P0 do [discovery](../discovery/DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01.md)), na `main` e fora de PROD, **sem migration**: cancelar a Expedição, reescrever a separação e conferir lote travam a Expedição e releem o status — a mesma trava da confirmação —, e nada de Expedição cancelada com saída de estoque nem saída apagada pelo CASCADE de uma edição que chegou depois; cancelar a OP relê EM PRODUÇÃO depois do consumo ou da pesagem; cancelar a OC relê depois do recebimento; conflito de concorrência nos fluxos tocados (P2034, P2028 e o deadlock que o Prisma entrega sem código) é 409 `concurrent_write`. Os quatro riscos reproduziram com teste vermelho antes da correção. Entra na v1.1.0. Linha 9zc da fila viva; a Fatia 2 (P1) segue aberta na 9zd | — | — |
| ~~API-ERROR-HANDLER-RECURSION-01~~ | **Fechado em 2026-09-19** por API-GLOBAL-ERROR-HANDLER-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria), na `main` e fora de PROD, **sem migration**, correção de integridade da infraestrutura sem regra de negócio nova: o `setErrorHandler` de `app.ts` chamava `app.errorHandler(...)`, que depois do `setErrorHandler` é o próprio tratador, e recursava até `Maximum call stack size exceeded` — todo erro não mapeado saía 500 com a mensagem e o log do estouro, e os 4xx do Fastify (JSON malformado 400, `statusCode` do erro) viravam 500. O tratador relança ao padrão do Fastify; o 409 `duplicate_name` segue igual. Achado lateral de DOCUMENT-TRANSITION-CONCURRENCY-01; linha 9ze da fila viva | — | — |

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| ~~WEB-DATE-DEFAULT-TZ-01~~ | **Fechado em 2026-09-13** por INPUT-DATE-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): as cinco telas que sobravam (CMV, impresso do CMV, referência do cálculo de custo, resumo de custo do Produto e referência manual de custo do Item) propõem `hojeComercial()`; a OC já tinha saído em PURCHASE-SUGGESTION-BUSINESS-DATE-01. Data explícita intocada | — | — |
| ~~API-PAGINATION-COERCION-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): as 28 consultas paginadas leem `page`/`pageSize` por `inteiroDeConsultaSchema` (`lib/integer-schema.ts`, sobre `inteiroDecimalSchema`); `1e1`, `0x10`, `12.5`, `12,5`, `+1`, `Infinity`, texto e acima de 2^53 são 400; padrão, mínimo e teto intocados; guarda estrutural em `modules/paginacao-da-consulta.test.ts` | — | — |
| ~~API-INT-COERCION-REMAINING-01~~ | **Fechado em 2026-09-14** por API-STRICT-SCALAR-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): `capacityQuantity`, minuto do dia e `numberOfParts` leem `inteiroDecimalSchema().pipe(...)`; `1e1`, `0x10`, `+1`, `1.0` e booleano são 400 sem gravar; faixa, nulo e mensagens intocados; guarda em `lib/escalar-estrito-guarda.test.ts` | — | — |
| ~~INVENTORY-EXPORT-ONLY-WITH-STOCK-01~~ | **Fechado em 2026-09-14** por API-STRICT-SCALAR-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): reproduzido pela rota (`onlyWithStock=false` exportava só com estoque); `booleanoDeConsultaSchema` lê só `"true"`/`"false"`, o resto é 400; tela sem mudança | — | — |
| ~~REPORTS-QUERY-BOOLEAN-PERMISSIVE-01~~ | **Fechado em 2026-09-14** por QUERY-BOOLEAN-STRICTNESS-WAVE-02 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): reproduzido pela rota (`all=abc`/`off`/`1` devolvia o relatório inteiro; o mesmo texto em `onlyWithBalance` escondia o item sem saldo, no JSON e no CSV); `onlyWithBalance`, `onlyShortage`, `includeCost` e `all` leem `booleanoDeConsultaSchema` com o padrão de antes, o resto é 400; nenhuma tela manda `1`/`0`, web intocada | — | — |
| ~~CUSTOMER-MATERIALS-ONLY-WITH-BALANCE-PERMISSIVE-01~~ | **Fechado em 2026-09-14** por QUERY-BOOLEAN-STRICTNESS-WAVE-02 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): reproduzido pela rota (`onlyWithBalance=1` listava o lote zerado, na lista e no CSV); `booleanoDeConsultaSchema().default(false)` — ausente segue sem filtro, o resto é 400 | — | — |
| ~~QUERY-BOOLEAN-PERMISSIVE-REMAINING-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria): reproduzido pela rota (`onlyPending=1` mostrava a fila inteira; `onlyWithBalance=1` trazia o lote zerado; `active=1` listava só os inativos; `archived=1` listava os não arquivados nas três bibliotecas; `includeArchived=1` escondia o anexo arquivado); os sete leem `booleanoDeConsultaSchema` com o padrão de antes, o resto é 400; anexos ganham `listAttachmentsQuerySchema`, sem leitura crua de `request.query`; a guarda não tem mais lista de dívida, só `LEGADO_EXPLICITO` (`semRoteiro`, `activeOnly`); web intocada | — | — |
| **E2E-CORPUS-MASS-01** | Sete suítes E2E procuram código fixo do corpus (`CLI-000013`, `PROD-000031`, `MP-000365`…) e três saem sem avaliar quando não há PA disponível: numa base recriada do zero não avaliam nada. Fere a regra 1 do README das suítes, onde está a lista. Desde DEV-REALDATA-BASELINE-RESET-01 (2026-09-14) há base real reproduzível (`pnpm e2e:baseline:rebuild`) e mapa por suíte em `E2E_STRATEGY.md`: das sete, quatro seguem sem a massa que leem (C), `formacao-de-preco…` e a de `PROD-000214` vão para reescrita (D) e `recebimento-validacao-viva` passava a achar a sua (B). **Em 2026-09-15 (E2E-BASELINE-REDESIGN-WAVE-01-02)** o recebimento ganhou massa própria por API — fornecedor e matéria-prima com lote e validade da execução — e saiu da lista; as três de PA sairiam "SEM MASSA", que o runner (`pnpm e2e:run`) agora reprova. Absorvido por E2E-BASELINE-REDESIGN-01. **Em 2026-09-15 (E2E-BASELINE-REDESIGN-WAVE-03)** `formacao-de-preco-do-novo-orcamento` passou a criar o próprio cliente; restam as do grupo C e a de `PROD-000214`, da WAVE 4 em diante | LOW | M |

### Encerrados na triagem, sem trabalho

| ID | Disposição | Por quê |
|---|---|---|
| **F-01-5** | CLOSED | `clientes.csv` não tem coluna de data e `MappedCustomer` não tem o campo. "Cadastrado em" mostra a única data que existe |
| **F-02-3** | DUPLICATE | É o **#4**, aceito com residual pelo PO em 2026-09-04: 117 px medidos então, 131 px agora. Mesma tabela, mesma causa |
| **F-10-1** | DUPLICATE | É o próprio F-01-1 reconfirmado depois da aprovação do projeto |
| **F-01-4** | CLOSED | Fechado por NAVIGATION-SIDEBAR-01 (2026-09-11): com as seções recolhíveis o menu inteiro cabe sem rolar em 1280×720, Cadastros incluído; a ordem do fluxo ficou, por decisão do PO |

**F-11-1 fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01: a resposta foi a registrada abaixo — o aviso de contexto diz de onde a pessoa veio e leva de volta —, para todo `EntityLink` de cadastro em lista com modal, não só o do Projeto.

**F-11-1 — o rastro que se perde ao clicar no Cliente.** Achado durante
PROJECT-CUSTOMER-CONTACT-01 (2026-09-09), fora do escopo dela e **não
corrigido de propósito**. Clicar no Cliente dentro de um Projeto leva a
`/cadastros/clientes?ids=…&open=…`, onde a tela avisa que a lista está
reduzida (`RecordContextChip`) e oferece "Limpar filtros" — mas não oferece
volta ao Projeto. Quem saiu depende do botão do navegador, e o `FlowContext`
(que existe para dizer de onde um documento veio) não cobre esta ida.

**Correção de um registro anterior (2026-09-10):** a versão de orçamento **É**
endereçável — `/comercial/projetos/:id?quoteVersionId=<id>` abre a versão
pedida, e `QuoteVersionsSection` já lê esse parâmetro (é assim que o retorno da
simulação de CMV volta para a versão certa). A auditoria de
PROJECT-COMMERCIAL-SUMMARY-01 tinha registrado o contrário — que só existia a
rota de impressão —, olhando o `openId` interno sem ver quem o semeia. O link
do orçamento no resumo comercial continua **não implementado** por decisão de
escopo, não por falta de endereço.

Não é do Projeto: vale para todo `EntityLink` que sai de um documento para um
CADASTRO. A resposta certa é uma só — o chip de contexto dizer de onde a
pessoa veio e levar de volta —, e ela pertence à experiência de navegação
contextual / Consulta do Cliente, não a esta capability. Registrar agora
evita a correção pontual em uma tela, que é como a inconsistência nasce.

**F-01-3 é parcialmente NOT_A_BUG.** A auditoria afirmou que código e nome do
cliente não são clicáveis; `CustomersPage.tsx:212,236` mostra
`table--clickable-rows` e `<tr onClick>` com `tabIndex`. A linha é clicável e
abre a edição, que contém o link "Consulta completa". Sobra só o resíduo em P3.

### Grupos de causa raiz — o que se corrige junto

| Grupo | Achados | Causa | Por que junto |
|---|---|---|---|
| **G1** | ~~F-07-1~~ — fechado no FIX-06 | Precisão exibida e precisão validada não se reconciliam | As três comparações `Number(digitado) > Number(limite)` — OP, Expedição e Pedido, esta última remendada com `+ 1e-6` — foram substituídas por `quantity-limit.ts` em FIX-01. Sobra F-07-1, que é exibição sem campo de entrada: o mesmo valor sai formatado numa tela e cru na outra |
| **G2** | ~~F-02-2, F-02-1~~ — fechado no FIX-02 | Quantidade **declarada** usada como se fosse a física | `convertUomDecimal` era chamado com os mesmos argumentos em `formulations.service.ts` e `costs.service.ts`, sem o motor de necessidade. Mesmo atalho, dois lugares. Os dois chamam o motor agora, e o campo `stockEquivalentQuantity` deixou de existir |
| **G3** | ~~F-09-1, F-07-2~~ — fechado no FIX-05 | "Disponível" composto ad-hoc por tela | O Pedido passou a chamar `getUnavailabilityByItems` junto com `getAvailableByItems`, na mesma resolução de escopo, e a exibir o motivo com as palavras do Estoque. A OP continua com o cálculo próprio — que é legítimo e está documentado em `requirement-availability.ts:44` — e agora diz isso no rótulo |
| **G4** | ~~F-06-1, F-06-2~~ — fechado no FIX-04 | `fieldErrors` só nascia da resposta do servidor e só resetava no próximo envio | Mesmo arquivo, mesmo mecanismo: o conserto de um resolveu o outro. O veredito da quantidade é derivado, e a chave de `fieldErrors` deixou de ser a posição no array |
| **G5** | F-06-3 | `nextval` antes da transação | Cinco módulos, mesmo diff, revisão mecânica de uma vez |

## B · #9 — OPS-CALENDAR-01

### 9. OPS-CALENDAR-01 — ABSORVIDO por PLANNING-CALENDAR-01 (2026-09-12)

> **Fechado sem virar item próprio.** Decisão do PO em 2026-09-12:
> PLANNING-CALENDAR-01 ABSORVE OPS-CALENDAR-01 — é a mesma necessidade escrita
> duas vezes, e dois itens criariam a mesma tabela. O calendário global existe
> em `Planejamento → Calendário de Produção`: dias da semana operantes, horário
> inicial e final, intervalo, e exceções por data com tipo e motivo
> (`FERIADO`/`RECESSO`/`PARADA_OPERACIONAL`/`OUTRO`). Ver `PROJECT_STATE.md`.
>
> **O que foi respondido do "auditar antes":** não havia nenhum `getDay()`,
> nenhuma noção de dia útil e nenhum cálculo de prazo por contagem de dias no
> runtime — confirmado, e o único `leadTimeDays` continua o campo informativo
> de `QuoteVersion`, que ninguém soma a data nenhuma. Uma definição por data:
> SIM, uma exceção por data, garantida por unique; repetir a data é recusa
> explícita, e editar troca tipo e motivo. Excluir é permitido enquanto nenhum
> planejamento depende do calendário — a decisão sobre data que já participou
> de planejamento calculado passa a pertencer a PLANNING-CAPACITY-BOARD-01.
>
> **O que ficou de fora, como previsto:** recorrência anual, API externa de
> feriados, calendário por funcionário/equipamento/recurso/setor/turno/cliente,
> e parada parcial por hora. `CustomerOrderDelivery.scheduledDate` continua
> PROMESSA (§75) e o calendário não a move.
>
> **O discovery separado continua aberto:** se o mesmo calendário global vale
> para prazo de planejamento de COMPRA. Nada foi assumido sobre lead time de
> fornecedor.
>
> O texto original fica abaixo, como registro da necessidade e das perguntas.

### 9-a. Registro original — OPS-CALENDAR-01 — P2

Necessidade trazida pelo PO em 2026-09-09. A Veridi precisa de uma tela onde o
usuário **declare** feriados, recessos e outros dias sem operação, para que
esses dias não contem nas futuras contagens de dias úteis de produção e
planejamento. **Não implementar sem autorização** — o que está aqui é o
registro da necessidade e das perguntas que precisam de resposta antes do
build.

**Conceito novo, e o cuidado é não confundi-lo com o que já existe.** O sistema
já tem DATA CIVIL e DIA COMERCIAL (`hojeComercial`, `America/Sao_Paulo`,
§72, §81), e eles governam custo, vigência de oferta, tarifa industrial e
`referenceDate`. Um feriado **não** faz uma oferta deixar de estar vigente, nem
uma `ItemCostReference` ou uma `IndustrialResourceRate` deixarem de valer, nem
`referenceDate` deixar de existir. O que nasce aqui é outra coisa:

> **DIA ÚTIL OPERACIONAL** = dia permitido pela semana **E** não cadastrado
> como dia não útil.

As duas metades dessa definição são independentes, e a primeira ainda não tem
resposta (ver "o que auditar antes").

**Escopo conceitual inicial.** Calendário GLOBAL da Veridi — um só. Cada
registro é uma DATA com motivo/descrição, tipo e observação. Tipos candidatos,
ainda sem enum e sem runtime: `FERIADO`, `RECESSO`, `PARADA_OPERACIONAL`,
`OUTRO`. Tela provável em Configurações → Calendário operacional; a rota
definitiva não se decide agora.

Fora do escopo inicial, e só voltam com necessidade real: calendário por
funcionário, equipamento, recurso, setor, turno ou cliente.

**Feriado é declarado à mão.** Sem integração externa e sem API de feriados —
importação automática é roadmap. Sem recorrência anual: `25/12/2026` é um
registro de data, não uma regra "todo 25/12"; decidir recorrência sem cuidado
produziria regra errada para feriado móvel. Carnaval, Sexta-feira Santa e
Corpus Christi continuam sendo datas cadastradas no calendário do ano —
nenhum algoritmo cívico nesta fase.

**O que auditar antes de construir:**

- **Fim de semana.** Auditar como o sistema trata sábado e domingo hoje, sem
  assumir. Levantamento superficial de 2026-09-09 não encontrou nenhum
  `getDay()`, nenhuma noção de "dia útil" e nenhum cálculo de prazo por
  contagem de dias no runtime — o único `leadTimeDays` é `QuoteVersion`, campo
  informativo digitado na condição comercial, que ninguém soma a data nenhuma.
  Confirmar isso é parte do discovery, não conclusão dele.
- **Uma definição por data?** Provável, mas não criar constraint agora: auditar
  se dois motivos na mesma data precisam coexistir.
- **Editar, inativar ou excluir?** Definir no discovery, preservando
  rastreabilidade de uma data que já participou de planejamento calculado.

**Data não útil não reescreve o passado.** Planejamento FUTURO pode recalcular;
data já prometida, congelada ou histórica não muda em silêncio. Em particular,
`CustomerOrderDelivery.scheduledDate` é PROMESSA (§75) e este calendário não a
move: promessa caindo em dia não útil deve virar alerta ou pedido de
reprogramação explícita — a decisão de UX fica para a implementação.

**Dependências.** É fundação temporal operacional de PLAN-DATE-01 (item 14) e
deve vir antes da parte dele que passar a CONTAR dias úteis — necessidade de
compra, lead time, produção e data necessária a partir da promessa de entrega.
As partes de PLAN-DATE-01 que não dependem de contagem não ficam bloqueadas
por isto.

Ao construir, auditar onde existem `leadTimeDays`, `plannedDate`,
`requiredDate`, `dueDate` e equivalentes — **nenhum deles muda agora**.

**Discovery separado:** se o mesmo calendário global vale para prazo de
planejamento de COMPRA. Não assumir que "dias do fornecedor" seguem o
calendário da Veridi — lead time de fornecedor pode ter semântica própria.

## D · #17 — API-PAGINATION-GUARD-STOCK-COUNTS-01

**Fechado em 2026-09-16** por API-PAGINATION-GUARD-STOCK-COUNTS-01, na `main` e fora de PROD (`release/prod` segue
`5b7c1a3`). Só teste: `listStockCountsQuerySchema` (`GET /stock-counts`) entrou na tabela `CONSULTAS` de
`paginacao-da-consulta.test.ts` com os valores do schema — teto 100 e padrão 20 no tamanho, padrão 1 na página — e
passa pela matriz inteira: padrão, inteiro decimal, mínimo e teto e os 21 formatos recusados. A guarda volta a contar 60
declarações para 30 consultas, e `pnpm --filter @veridi/api test` volta a chegar à faixa serial. Schema, rota e serviço
intocados; sem migration. Estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), seção própria.

Registro original (BACKLOG, seção D, 2026-09-16) — "17. A guarda de paginação da API não conhece a consulta do
Inventário — LOW":

`apps/api/src/modules/paginacao-da-consulta.test.ts`, caso "toda consulta paginada está na tabela acima", falha na
`main` desde `86e84c1` (INVENTORY-PHYSICAL-COUNT-01): a guarda conta 60 declarações `page`/`pageSize` com
`inteiroDeConsultaSchema` e a tabela `CONSULTAS` tem 29 (58). A que falta é `listStockCountsQuerySchema`
(`inventory/stock-count.schemas.ts`, teto 100, padrão 20). A consulta em si está certa — é a leitura estrita —; o que
quebrou foi o retrato. Efeito colateral: `pnpm --filter @veridi/api test` para no primeiro `vitest run` e não chega à
faixa serial (`&&`). Visto em CUSTOMER-PAYMENT-DEFAULTS-01 (2026-09-16), sem relação com a rodada. Correção:
acrescentar a consulta do Inventário à tabela, com teto e padrão.

## D · #18 — TEST-USERS-LEGACY-RESIDUE-01

Resolvido por estado posterior: o `veridi_dev` foi recriado do zero (drop/create) em DEV-REALDATA-BASELINE-RESET-01,
2026-09-14, com a carga de PROD e o ADMIN local. Conferido pelo runbook, sem leitura de banco.


Rodadas anteriores a TEST-SUPPORT-ISOLATION-WAVE-01 deixaram 683 usuários
`USR-TEST-*` e ~808 sessões no `veridi_dev` (2026-09-13). A suíte não escreve
mais lá e ninguém os usa, mas eles aparecem na lista de usuários do DEV. Limpar
é escrita destrutiva no banco do DEV, só com pedido do PO: sessões e
preferências saem em cascata; anexo, pesagem ou consumo de amostra feito por
eles segura o usuário (RESTRICT); as demais autorias viram NULL.

## G — SUPPLIER-ADDRESS-01

Entregue em 2026-09-11 (merge b8d744b).


Vindo do walkthrough real (2026-09-09).

`Supplier` hoje tem código, razão social, nome fantasia, CNPJ, e-mail, telefone
e notas — **nenhum campo de endereço**. `Customer` tem os seis
(`zipCode`, `street`, `number`, `complement`, `district`, `city`, `state`) com a
consulta de CEP já funcionando em `lib/cep-api.ts`.

Restrição durável: **reusar a mesma fundação de endereço e CEP do Cliente**. Não
existe um segundo ViaCEP, não existe uma segunda máscara e não existe uma segunda
regra de "CEP incompleto não consulta". CUSTOMER-CEP-02 fechou em 2026-09-09 e
mudou esse comportamento: a fundação hoje é a de §80 — o endereço pertence a um
CEP, e trocar o CEP limpa os seis campos antes da consulta. O Fornecedor nasce
com ele, não com o anterior.

Exige migration (colunas novas em `suppliers`), e por isso é capability, não
quick win.

## Próximo gate (texto de 2026-09-09 a 2026-09-15)


A validação com a Veridi (#7, #11) é gate só para as regras que dependem do
processo real do cliente. Não impede #8E, #8F e #8G quando o PO autorizar.

**Três gates nasceram do walkthrough de 2026-09-09**, e um deles já foi
respondido:

- ~~a pergunta de preço em QUOTE-DUPLICATE-01~~ — **RESOLVIDA em 2026-09-10**:
  sem herança silenciosa, com escolha explícita entre manter os preços da versão
  de origem e revisá-los, e nenhuma opção pré-marcada. §74 continua de pé porque
  o que acabou foi o silêncio, não a possibilidade de copiar;
- a pergunta de sobreposição de vigência, que vale ao mesmo tempo para
  SUPPLIER-OFFER-OVERLAP-01 e para o resíduo 2 de INDUSTRIAL-RATE-VALIDITY-01;
- ~~**o que prova conversão** em CUSTOMER-COMMERCIAL-STATUS-01~~ — **RESOLVIDA
  em 2026-09-11**: Projeto aprovado OU Pedido confirmado, históricos (§86).

As duas primeiras posições da fila (P0) **não dependem de nenhum dos três**.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](../ROTEIRO_VALIDACAO_CLIENTE.md).
---

## Fora deste arquivo

Dois LOW de nomenclatura levantados nesta auditoria — rótulos de ação
divergentes entre telas e diálogo de confirmação que repete o rótulo de quem o
abriu — continuam **abertos** e vivem em [BACKLOG.md](../BACKLOG.md).

A observação "compra permitida contra projeto não aprovado" não é finding: é
decisão de domínio deliberada, registrada em
[PRODUCT_RULES.md](../PRODUCT_RULES.md) §38.

---

# Saídos do BACKLOG em 2026-09-19 (PRODUCT-BACKLOG-CONSOLIDATION-01)

Consolidação depois das auditorias e correções de 2026-09-19, sobre `main` `c860e190`. Texto movido como estava, com os
links ajustados para esta pasta. A fila viva do BACKLOG passou a ter só o que está aberto, na ordem dada pelo PO.

Também saíram, sem linha própria abaixo — um ID só para cada problema:

- **G5 do Painel Gerencial** (encerramento de saldo de OC parcialmente recebida) — virou CLOSE-WITH-REASON-PO-01,
  decidido em [CLOSE-WITH-REASON-DISCOVERY-01](../discovery/CLOSE-WITH-REASON-DISCOVERY-01.md).
- **O VIEWER e a autoria de PRODUCTION-PERMISSION-HARDENING-01** (I1 para o VIEWER; I3 e I7; P3, P4 e P8 do discovery)
  — passaram para AUTHZ-VIEWER-READONLY-01 e AUTHORSHIP-SESSION-ACTOR-01
  ([AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](../discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md)). O item antigo segue
  no BACKLOG só com o perfil final de quem executa a OP (P1 e P6, com a Veridi).

## Fila viva — linhas fechadas (até 2026-09-19)

Como estavam na fila viva, com a numeração da época.

| Ordem | Prioridade | Item | Estado | Próxima ação | Dependência |
|---|---|---|---|---|---|
| 0 | P0 | ~~**HOMOLOGATION-RELEASE-RAILWAY-01**~~ — publicar o estado aprovado para a homologação da Veridi, sobre os dados existentes | **FECHADO em 2026-09-16** · `release/prod` `2400def` → `3159180` → `5b7c1a3`, tag `homologacao-veridi-2026-09-16-r1` · seis migrations aditivas · dois backups com `RESTAURÁVEL: YES` · dados preservados · smoke verde · sem reset, carga, importação ou restore · o achado do PO (Fornecimento coberto na base fixa) foi corrigido e publicado na mesma rodada | — (registro em [`RELEASES.md`](../RELEASES.md)) | — |
| 0b | P0 | ~~**VERIDI-SYSTEM-VERSIONING-01**~~ — versão oficial do sistema: v1.0.0, fonte única, `GET /meta` e "Sobre o sistema" | **FECHADO em 2026-09-19** · decisão do PO: SemVer `vMAJOR.MINOR.PATCH`, v1.0.0 = primeira versão comercial oficial · fonte única em `packages/shared/src/version.ts` com guarda estrutural · `GET /meta` com versão, ambiente e commit do deploy · versão ao lado de "Nutrition" e "Sobre o sistema" no cabeçalho · **sem migration** · **publicada em PROD em 2026-09-19**: `release/prod` `ff861c90` → `884a500d`, deploy `d55e03aa` SUCCESS, tags `v1.0.0` e `prod-2026-09-19-v1.0.0`, smoke 50/50, dados preservados | — (política em [`RELEASES.md`](../RELEASES.md), estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md)) | — |
| 1b | P1 | ~~**FORMULATION-TECHNICAL-SHEET-PDF-01**~~ — Ficha Técnica do Produto (Formulação) em PDF real | **FECHADO em 2026-09-15** · ação "Ficha técnica (PDF)" no cabeçalho da versão, documento sobre a fundação `apps/web/src/pdf`, read model neutro reaproveitável pelo Modelo · **sem migration** · absorve FORMULATION-PRINT-ADJUSTMENTS-01 no que toca à Formulação | — (detalhe em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md)) | — |
| 2 | P0 | ~~**FORMULATION-TEMPLATE-WORKBENCH-01**~~ — levar a bancada para o Modelo de Formulação (catálogo, aplicação e promoção de Formulação para Modelo) | **FECHADO em 2026-09-16** (`FORMULATION_TEMPLATE_WORKBENCH_CLOSED = YES`), pronto para a homologação com a Veridi · fatia 1: premissas técnicas no Modelo (migration aditiva `20260925093031`) · fatia 2: bancada compartilhada e barra fixa · fatia 3: ativação do Modelo relê o cadastro do Item, `componentIssues` no Modelo, pré-checagem ao aplicar com rascunho gerado mesmo com pendência (D-6), salvar como Modelo numa escrita só, diff das premissas e da ordem, seletor só com elegíveis e item histórico marcado "Inativo", nomenclatura MODELO em toda tela (absorve NAV-TEMPLATE-WORDING-01) · fatias 2 e 3 **sem migration** | — (regras em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §96–§97, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 2b | P1 | ~~**FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01**~~ — Ficha Técnica do Modelo de Formulação em PDF real | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · mesmo documento da ficha do Produto sobre read model neutro (moldura por fonte, corpo técnico compartilhado), adaptador do Modelo com os derivados do motor de `@veridi/shared` · "Matriz de biblioteca — não é documento de Produto", Rascunho/Ativo/Arquivado, legado sem forma · ação no cabeçalho e no histórico · **sem migration** · ficha do Produto com texto idêntico | Publicação quando o PO decidir (detalhe em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md)) | — |
| 3 | P1 | ~~**BILLED-VALUE-CANONICAL-01**~~ — "Valor faturado" do Painel, R-15 e R-14 igual ao valor do documento | **FECHADO em 2026-09-15** · D1 decidida pelo PO: `Billing.totalAmount` · sem migration | — (entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 6 | P1 | ~~Decisões de **FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01** → MANAGEMENT-DASHBOARD-V1-01~~ (Painel Gerencial) | **FECHADO em 2026-09-15** · D2–D5 decididas pelo PO · versão 1 entregue · sem migration | — (entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9 | P1 | ~~**CUSTOMER-STATUS-LIFECYCLE-01**~~ — situação cadastral do Cliente (Ativo · Bloqueado · Inativo), histórico auditável e guardas de venda | **FECHADO em 2026-09-15** · feedback direto da Veridi · migration aditiva (`blocked` + `customer_status_history`) | — (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §95, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md)) | — |
| 9b | P1 | ~~**CUSTOMER-STATUS-HARDENING-01**~~ — quem muda a situação cadastral e o aviso no documento em andamento (pré-homologação) | **FECHADO em 2026-09-16** · absorve CUSTOMER-STATUS-PERMISSIONS-01 (só ADMIN e COMMERCIAL alteram, 403 na API para os demais, que seguem consultando) e CUSTOMER-STATUS-DRAFT-WARNING-01 (aviso no Orçamento, Projeto e Pedido em andamento, pela situação atual que a leitura traz) · guardas de venda intactas · **sem migration** | — (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §95, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9c | P1 | ~~**CUSTOMER-EDIT-PERMISSIONS-01**~~ — quem cria e edita o cadastro do Cliente | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO (opção A do [discovery](../discovery/CUSTOMER-EDIT-PERMISSIONS-DISCOVERY-01.md)): só ADMIN e COMMERCIAL criam e editam (`CUSTOMER_EDIT_ROLES`, lista própria), 403 na API antes do corpo e da existência · os demais perfis consultam o Cliente no mesmo modal, sem campo editável · "+ Novo cliente" só para quem cadastra, com a ajuda de a quem pedir nos seletores · `UpdateCustomerInput` com o endereço que já trafegava · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §98, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9d | P1 | ~~**CUSTOMER-PAYMENT-DEFAULTS-01**~~ — forma e condição de pagamento padrão do Cliente como sugestão para novos orçamentos | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · D1–D6 do PO ([discovery](../discovery/CUSTOMER-PAYMENT-DEFAULTS-DISCOVERY-01.md)): forma (PIX, Boleto, Transferência, Cartão, Outro) e condição opcionais no Cliente, copiadas para a V1 (e para a primeira proposta depois de só legado); V2, recompra e duplicação partem da versão; "Aplicar padrão do cliente" só na tela; o Pedido congela a forma; "Forma de pagamento" passou a ser o meio e à vista/parcelado virou "Condição de pagamento"; parcelado sem parcelas recusado no Cliente e no Orçamento · **migration aditiva** `20260925093032` (sem backfill) | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §99, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9e | P1 | ~~**MASTER-DATA-EDIT-PERMISSIONS-01**~~ — quem cria, edita, inativa e reativa Item, Fornecedor e Produto | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · DE1–DE12 do PO ([discovery](../discovery/MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01.md)): Item com Compras, Qualidade, Produção e ADMIN, os quatro controles só Qualidade e ADMIN pela mudança de valor, "Consumido na produção" só Produção e ADMIN, custo de referência inicial só Comercial e ADMIN (recusado, nunca ignorado), inativar Compras/Qualidade/ADMIN e reativar Qualidade/ADMIN · Fornecedor com Compras e ADMIN · Produto com Comercial e ADMIN, inclusive a criação direta aprovada, e "Exige CoA" só para o PA que nasce junto · 403 antes do corpo e da existência (`exigirPerfil` compartilhado), 409 de situação · consulta no mesmo modal, criação contextual e "Nova relação" por perfil · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §100, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9f | P1 | ~~**ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01**~~ — a relação Item × Fornecedor criada por Compras nasce pendente | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · D3 do PO ([discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md), persistido nesta rodada): Compras cria a relação, os dados comerciais e a primeira oferta e administra o preferencial quando elegível, mas pedir `APPROVED` ou `BLOCKED` na criação é 403 com o motivo, sem gravar nada · homologar e bloquear, também na criação, só Qualidade e ADMIN (`SUPPLIER_ITEM_QUALIFICATION_ROLES`, a mesma lista da rota de homologação) · voltar para pendente com Compras, Qualidade e ADMIN · ADMIN mantém a criação com situação explícita · "Situação inicial: Pendente" na tela de Compras · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §101, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9g | P1 | ~~**ITEM-SUPPLIER-UX-01**~~ — fornecedores administráveis no cadastro do Item (Fatia 1) | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · D1–D5 do PO ([discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md) `IMPLEMENTADO`): a seção Fornecedores do Item lista as relações reais e administra — Compras e ADMIN adicionam fornecedor com o Item fixo (Compras cria `PENDING`) e definem o preferencial com confirmação e troca atômica da API; Qualidade e ADMIN homologam e bloqueiam no detalhe aberto por cima do Item; os demais consultam · duplicidade leva à relação existente · tela geral mantida (D2) · Fornecedor → Itens para SUPPLIER-ITEMS-UX-01 (D4) · sem lead time (D5) · Escape da confirmação não fecha mais o modal de baixo · **sem migration e sem API nova** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §102, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9h | P1 | ~~**LABEL-ATTACHMENTS-01**~~ — arquivo versionado do Item Rótulo, com storage `LOCAL_FS` e Cloudflare R2 | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisões do PO no handoff ([discovery](../discovery/LABEL-ATTACHMENTS-ARCHITECTURE-DISCOVERY-01.md), persistido nesta rodada): Rótulo por tipo e subtipo; versões imutáveis com vigente derivada; PDF/PNG/JPEG até 25 MB por extensão, tipo e assinatura; anular com motivo sem apagar bytes; restaurar como versão nova; download autenticado em streaming; enviar e restaurar Compras, Qualidade, Comercial e ADMIN, anular Qualidade e ADMIN · `StorageAdapter` com `LOCAL_FS` e `R2` · **migration aditiva** `20260925093033` · **Railway não tocado**: R2 pronto e desligado | Publicação quando o PO decidir; ativação do R2 em STORAGE-R2-ACTIVATION-01 (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §103, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9i | P1 | ~~**SUPPLIER-QUALITY-REJECTION-REASON-01**~~ — bloquear a relação Item × Fornecedor exige motivo | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO no handoff: `BLOCKED` exige motivo em texto livre, sem lista fechada, na rota de homologação e na criação já bloqueada — sem ele, 400 `validation_error` e nada gravado, com o 403 por perfil antes · homologar e voltar para pendente sem motivo · bloqueio antigo sem motivo continua válido, mostrado como "Motivo não registrado", sem backfill · diálogo "Bloquear fornecedor para este item" no detalhe que a tela geral e o cadastro do Item compartilham · **sem migration** (reutiliza `note` do histórico de homologação) | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §104, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9j | P1 | ~~**ACQUISITION-COST-PERMISSION-01**~~ — custo efetivo de aquisição definido por qualquer sessão | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO: Compras e ADMIN informam o custo efetivo (`ACQUISITION_COST_ROLES`) nas duas portas — `PUT /receipt-lines/:id/acquisition-cost` com 403 antes do corpo e da linha, e o recebimento de outro perfil que traz custo com 403 antes do corpo e da OC, sem gravar nada; receber sem custo segue aberto a todos · `costUpdatedBy` com o usuário da sessão (antes, "Ambiente local") · "Definir/Atualizar custo" no documento e o campo de custo de "Receber OC" só para quem informa, consulta igual para os demais · REAL, 30D e 90D seguem a mesma fonte · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §105, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9k | P1 | ~~**ASSISTED-ENTITY-SELECTOR-FOUNDATION-01**~~ — consulta assistida nos seletores de entidade, piloto Item | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · fundação de UX: "Consultar itens" no topo da lista do seletor, opt-in (`onConsult`), sem trocar o autocomplete · `EntityConsultationDialog` por cima da tela, com o recorte do campo à vista, busca e paginação no servidor pelas peças das listagens, linha recusada desabilitada com motivo e cartões em 390px · piloto Item na bancada (Formulação e Modelo, matéria-prima e embalagem): tipo da seção e só ativos, item de outra linha desabilitado, selecionar põe o item na linha sem recarregar nem perder pendência · "+ Novo item de estoque" dentro da consulta é a criação no contexto de sempre, só para quem cadastra Item, agora com `?tipo=` da seção · **sem API alterada e sem migration** | Publicação quando o PO decidir; expansão em ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 depois de validar o piloto (padrão em [`UI_BRAND.md`](../UI_BRAND.md), estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9l | P1 | ~~**FORMULATION-COMPONENT-BASIS-AUTOMATION-01**~~ — base de cálculo da linha escolhida à mão na bancada | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO: base é consequência da seção e do modo, não escolha · composição por dose na receita por dose (modo, cápsula ou pó) e base fixa senão; embalagem por unidade acabada · servidor deriva em toda gravação de rascunho (Formulação e Modelo, troca de modo, cópia de versão, aplicar e salvar como Modelo) e descarta `basis` do corpo · ativa, inativa e arquivada intactas · bancada sem Base, Fornecimento mantido, aviso de rascunho legado · DEV sem nenhuma linha fora da regra (1.330) · **sem migration** | Publicação quando o PO decidir, depois do gate READ ONLY `scripts/maintenance/prod-component-basis.ts` em PROD (Formulação e Modelo, todos os status; linha fora da regra vai ao PO) (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §106, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9m | P1 | ~~**INVENTORY-INACTIVE-ITEM-VISIBILITY-01**~~ — item inativo sumia do estoque físico | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · Fatia 1 de MASTER-DATA-INACTIVE-VISIBILITY, D1–D3 do PO ([discovery](../discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md), persistido nesta rodada): inativo com posição (saldo, reservado ou em compra) aparece no Estoque marcado "Item inativo"; sem posição só com "Incluir inativos sem saldo"; CSV com o mesmo recorte e a coluna "Item ativo"; detalhe com a situação e o histórico inteiro; Contagem rápida acha o inativo e conta a posição com saldo; saída e perda seguem; entrada manual recusada (400 `inactive_item`) · perfis intocados · **sem migration** | Publicação quando o PO decidir; fatias 2–4 esperam o handoff (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §107, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9n | P1 | ~~**ASSISTED-ENTITY-MULTISELECT-01**~~ — consulta assistida com várias escolhas onde a tela monta lista, e colunas que distinguem registros parecidos | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO: seleção única no campo da linha, múltipla (até 10, explícita) na ação da seção · `EntityConsultationDialog` com `selectionMode`, marcação que atravessa busca, página e recarga, uma confirmação, presente travado com motivo, sem "+ Novo" na múltipla · pilotos: Formulação e Modelo ("+ Adicionar matérias-primas" / "+ Adicionar embalagens", uma linha por item pelo caminho da escolha na linha, base derivada) e recursos do Modelo de Estrutura de Custo ("+ Adicionar recursos") · adendo: matéria-prima com fonte/função e pureza cadastrada, embalagem com subtipo, recurso com tipo, capacidade e unidade de uso · **sem API alterada e sem migration** | Publicação quando o PO decidir; Roteiro de Produção fica para o rollout (mão de obra E equipamento pedem `types=` na API) — padrão em [`UI_BRAND.md`](../UI_BRAND.md), estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A | — |
| 9o | P1 | ~~**PRODUCT-INACTIVE-COMMERCIAL-GATE-01**~~ — Produto inativo iniciava compromisso comercial novo | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · Fatia 2 de MASTER-DATA-INACTIVE-VISIBILITY, D6–D7 do PO ([discovery](../discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md)): vincular ao Projeto, linha nova, envio e aceite de Orçamento, aprovação do Projeto, geração e confirmação de Pedido e Amostra nova recusam Produto inativo (400 `inactive_product`); liberação da OP planejada relê Produto e PA; PA existente e inativo tem recusa própria (400 `inactive_finished_item`), sem cascata Produto × PA; rascunho abre marcado, versão nova copia a linha, nada é cancelado; Web não oferece o inativo em escolha nova e marca o registro salvo com a situação do servidor · custos, preço, CMV e roteiro intocados · **sem migration** | Publicação quando o PO decidir; fatias 3–4 esperam o handoff (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §108, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9p | P1 | ~~**ITEM-FORM-BY-TYPE-01**~~ — cadastro do Item contextual ao Tipo, com o arquivo do Rótulo escolhido já na criação | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisões do PO no handoff: `Item.type` decide o formulário, nunca a Família · matéria-prima com Classificação industrial, embalagem com Dados da embalagem (subtipo e consumido na produção), Rótulo com Arquivo do rótulo logo depois · troca de tipo e subtipo na criação limpa o que ficou escondido, e o envio só leva os campos do tipo · arquivo opcional, guardado na tela até existir o id e enviado pela rota de LABEL-ATTACHMENTS-01 · falha depois de criar não recria: "Item criado, mas o arquivo do rótulo não pôde ser enviado." e a seção oficial do Item criado para reenviar · **sem API, shared nem migration** · `INTERNAL_CONSUMABLE` fora | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §109, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9r | P1 | ~~**CUSTOMER-CNPJ-LOOKUP-01**~~ — consulta assistida de CNPJ no cadastro do Cliente | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · RECONCILIA e substitui CUSTOMER-CNPJ-AUTOFILL-01, aprovado pelo PO com OpenCNPJ como primeiro provedor (Serpro passa a ser provedor futuro) · assistência ao preenchimento: consultar não grava, comparação Atual × Retornado contra o ESTADO DO FORMULÁRIO, diferença aplicável marcada por padrão, vazio da fonte nunca apaga valor existente, Cancelar não muda nada, falha externa mantém o cadastro manual inteiro · `GET /cnpj-lookup/:cnpj?provider=` autenticado, somente leitura, com `CUSTOMER_EDIT_ROLES` (§98); chamada externa no servidor, com timeout, teto de resposta e parsing que não confia no payload · abstração `CnpjLookupProviderAdapter` + registro, pronta para o SERPRO sem reescrever tela, endpoint nem contrato · perfil tributário, pagamento, notas e situação intocados · **sem migration** | Publicação quando o PO decidir; SERPRO quando houver credencial e decisão (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §111, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9s | P1 | ~~**CUSTOMER-CNPJ-PERSISTED-DATA-01**~~ — dados cadastrais do CNPJ guardados no Cliente | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · evolui CUSTOMER-CNPJ-LOOKUP-01 sem integração nova · CNAE, natureza jurídica, porte, abertura, matriz/filial, Simples e MEI (Sim/Não/Não informado, `null` nunca é Não), situação na RFB, data da situação e última consulta · consultar não grava; "Aplicar consulta ao cadastro" leva o bloco com o `consultedAt` mesmo sem diferença; o Salvar persiste · trocar o CNPJ descarta o bloco do número anterior, na tela e no servidor · perfil tributário, pagamento, notas e situação intocados · **migration aditiva** `20260925093036` | Publicação quando o PO decidir — PROD precisa da migration (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §119, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9t | P1 | ~~**PRODUCTION-PROFILE-ARCHIVE-01**~~ — arquivar e desarquivar o Perfil de Produção | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · Fatia 0 de [MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), D4 · `POST /production-profiles/:id/archive`, com ADMIN e Produção (403 antes do corpo para os demais) e 409 na transição repetida, sem re-carimbar · arquivado fora da lista padrão ("Mostrar arquivados") e dos seletores; 409 `profile_archived` no padrão novo de Produto e em toda aplicação à OP; a aplicação automática deixa a OP nova sem cópia, pendente, sem trocar de roteiro · o Produto que já apontava continua apontando, com aviso; versões e cópias nas OPs intocadas · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §121, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9u | P1 | ~~**USER-LAST-ADMIN-GUARD-01**~~ — nunca zero ADMIN ativo | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · Fatia 0 do [discovery](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), D5: `PATCH /users/:id` recusa inativar ou rebaixar o último ADMIN ativo (409 `last_active_admin`), inativar a si mesmo (`self_deactivation`) e retirar de si o perfil Administrador (`self_demotion`), mesmo havendo outro ADMIN — outro ADMIN executa · contagem e gravação na mesma transação, com as linhas de ADMIN ativo travadas (`FOR NO KEY UPDATE`) · a tela trava perfil e situação do próprio usuário e explica o último · **sem migration** | — (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §120, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9v | P1 | ~~**MASTER-DATA-HARD-DELETE-01**~~ — exclusão física do cadastro errado e nunca usado: infraestrutura, Fornecedor, Cliente, Modelos e Perfil de Produção | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · Fatia 1 do [discovery](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), D1–D3 e D6 · prévia `GET <cadastro>/:id/deletion-check` e `DELETE <cadastro>/:id` com motivo obrigatório, só ADMIN (403 antes do corpo e da existência); 409 `master_data_in_use` com as referências · catálogo explícito por agregado conferido contra o `pg_constraint` a cada execução, redes por sufixo e varredura de JSON, falha fechada · filhos técnicos: a V1 como a criação a deixou e o registro do CNPJ gravado na criação do Cliente, só pela marca estrutural `createdWithCustomerId` (9y, fechado em 2026-09-18 — a Fatia 1 fechou de vez) · transação com `FOR UPDATE`, recontagem e `pg_stat_xact_user_tables`, efeito inesperado desfaz tudo · rastro append-only `master_data_deletion_history` com retrato por lista branca, ALVO no `prod-cleanup` · "Excluir definitivamente" só para ADMIN nas seis telas · **migrations aditivas** `20260925093038` e `20260925093040` (9y) · FKs intocadas | Publicação quando o PO decidir — PROD precisa das migrations 093038 e 093040 (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §125, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9w | P1 | ~~**MASTER-DATA-HARD-DELETE-02**~~ — exclusão física de Item, Produto + PA e Recurso industrial | **FECHADO em 2026-09-19, na `main` e fora de PROD** (`release/prod` segue `884a500d`, v1.0.0) · Fatia 2 do [discovery](../discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), D1, D2 e D6 · §128 · **sem migration** (o enum do rastro já reservava os três tipos) · Item (MP, ME, PA e UC): qualquer uso bloqueia — movimento (inclusive o ajuste sem lote, só com o CASCADE do ledger no caminho), lote, fornecedor, referência de custo (mesmo a da criação), formulação, modelo, OP, consumo interno e estorno, amostra, inventário, pedido, expedição, faturamento, cópias e JSON; o PA nunca sai sozinho · Produto: o PA 1:1 é **vinculado** — lido e travado depois do Produto e julgado pelo catálogo do Item; sem uso dos dois lados sai o agregado inteiro com um rastro, qualquer uso do PA bloqueia o Produto e o PA nunca fica órfão; Produto nascido de Projeto bloqueia · Recurso: tarifa, roteiro, estrutura e modelo de custo, energia e a cópia do roteiro na OP bloqueiam · "Excluir definitivamente" só para ADMIN em Itens, Produtos e no Recurso, sempre pela prévia, com a saída Inativar | Publicação quando o PO decidir — entra na v1.1.0, sem migration; duas leituras para o PO confirmar: referência de custo da criação do Item bloqueia, e o PA é provado pela chave 1:1, sem marca de nascimento (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §128, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9x | P1 | ~~**CUSTOMER-CNPJ-EDITABLE-HISTORY-01**~~ — dados do CNPJ editáveis, consulta aditiva e histórico | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · revê 9s · os dez dados cadastrais do CNPJ viram campos editáveis, na seção logo antes de Observações · consulta ao OpenCNPJ aditiva em todos os campos: vazio nasce marcado, existente só muda com "Substituir", igual aparece para "Confirmar", fonte vazia nunca apaga · "Última consulta" é texto do sistema no rodapé · histórico só de acréscimo por gravação (Edição, Consulta sem diferença, Troca de CNPJ), com origem Manual/OpenCNPJ por campo e "Ver histórico"; sem histórico retroativo · regra global: mesmo espaço vertical entre blocos de todo cadastro (`--block-gap`) · **migration aditiva** `20260925093037` | Publicação quando o PO decidir — PROD precisa das migrations 093036 e 093037 (regras em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §122 e §123, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | 9s |
| 9y | P2 | ~~**CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01**~~ (proposto como MASTER-DATA-HARD-DELETE-CNPJ-BIRTH-01) — marca estrutural do registro do CNPJ gravado na criação do Cliente | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · decisão do PO: coluna anulável `createdWithCustomerId` em `customer_cnpj_registration_history`, sem FK, sem default e sem backfill (registro antigo segue NULL e bloqueando) · só `createCustomer` a grava, com o id do Cliente que nasce — inclusive o OpenCNPJ aplicado antes do primeiro Salvar —; PATCH nunca marca · filho técnico = `customerId` e `createdWithCustomerId` iguais ao Cliente, um só: sai junto (`removedTogether`, CASCADE no efeito esperado); sem marca, marca de outro Cliente ou dois marcados bloqueiam; nenhuma hora, ordem ou `xmin` · saneamento: a coluna é `origensImoveis` do Cliente — fora do catálogo de referências móveis e do resíduo do VERIFY, e o APPLY recusa plano que a mova; o MERGE move `customerId` e nunca a marca, e o registro movido bloqueia a exclusão do canônico · **migration aditiva** `20260925093040`, nenhuma tela muda · fecha de vez a 9v | Publicação quando o PO decidir — PROD precisa das migrations 093038 e 093040 (regras em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §125 e §114, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | 9v |
| 9z | P1 | ~~**INTERNAL-CONSUMPTION-REVERSAL-01**~~ — estorno próprio do consumo interno | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · P1–P10 decididas pelo PO no [discovery](../discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md) · §126 · migration aditiva `20260925093039` · estorno `ECI-` total ou parcial, só ADMIN e QUALITY, custo copiado, mesmo lote, recusa com inventário aberto ou contagem posterior · R-21 líquido na data do CI · extrato e R-03 reconhecem consumo e estorno | — (seção própria no [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md)) | — |
| 9za | P1 | ~~**INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01**~~ — consumo interno de data passada lançado depois de uma contagem baixava duas vezes | **FECHADO em 2026-09-19, na `main` e fora de PROD** (`release/prod` segue `884a500d`, v1.0.0) · decisão do PO no handoff: falhar fechado, sem ajuste compensatório · §127 · **sem migration** · só consumo de data ANTERIOR a hoje: recusa 409 quando a posição (item, ou item + lote) foi reconciliada por inventário encerrado — sessão ou Contagem rápida, ajustou ou conferiu — ou já contada num inventário aberto, com `countedAt` desde o início do dia do consumo · "Não ajustar", cancelado, posição retirada e outro lote não bloqueiam · posição aberta travada `FOR SHARE` · a recusa leva o inventário e a tela o link | Publicação quando o PO decidir — entra na v1.1.0 (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §127, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | 9z |
| 9zb | P1 | ~~**VERIDI-AUDIT-QUICK-FIXES-01**~~ — defeitos D1–D6 da revisão funcional ponta a ponta (VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01) | **FECHADO em 2026-09-19, na `main` e fora de PROD** (`release/prod` segue `884a500d`, v1.0.0) · os seis reproduziram com teste vermelho antes da correção · **sem migration** · D1 filtro "Vencido" pela validade derivada · D2 "Ir para compras" com o valor de máquina · D3 linha de reserva realocada fora do reservado efetivo · D4 Painel "OP com falta" pelo dono do estoque · D5 Sugestão de Compra também em PARTIALLY_SHIPPED · D6 prazo e observações travados depois do plano · achados laterais na seção A | Publicação quando o PO decidir — entra na v1.1.0 (estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), regras de D5 e D6 em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9zc | P0 | ~~**DOCUMENT-TRANSITION-CONCURRENCY-01**~~ (Fatia 1) — transição de documento × efeito físico sob concorrência: os quatro P0 | **FECHADO em 2026-09-19, na `main` e fora de PROD** (`release/prod` segue `884a500d`, v1.0.0) · §129 · **sem migration**, FK e CASCADE intocados · R-S1 e R-S2 (Expedição: cancelar, reescrever a separação e conferir lote travam a Expedição e releem — nada de CANCELLED com saída nem SHIPMENT_OUT apagado pelo CASCADE), R-O1 (cancelar a OP relê EM PRODUÇÃO depois do consumo ou da pesagem) e R-P1 (cancelar a OC relê depois do recebimento), os quatro reproduzidos com teste vermelho antes da correção · conflito de concorrência nos fluxos tocados é 409 `concurrent_write`, sem retry | Publicação quando o PO decidir — entra na v1.1.0 (discovery [DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01](../discovery/DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01.md), regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §129, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |
| 9ze | P1 | ~~**API-GLOBAL-ERROR-HANDLER-01**~~ — o tratador global de erros da API recursava até estourar a pilha | **FECHADO em 2026-09-19, na `main` e fora de PROD** (`release/prod` segue `884a500d`, v1.0.0, com o defeito desde `f3a4c666`) · fecha API-ERROR-HANDLER-RECURSION-01, achado lateral de DOCUMENT-TRANSITION-CONCURRENCY-01 · reproduzido com teste vermelho antes da correção · **sem migration** · o tratador relança ao padrão do Fastify: erro genérico 500 com a mensagem e o log originais, JSON malformado 400, `statusCode` do erro preservado, 409 `duplicate_name` igual | Publicação quando o PO decidir — entra na v1.1.0 (estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A) | — |

## Fila viva — linhas abertas como estavam antes da reorganização

Continuam abertas no BACKLOG, reescritas na ordem nova: 1, 4, 5, 7, 8, 10 e 11 na tabela "Fora da ordem de
2026-09-19"; a 9q no "Depois" (saneamento das duplicatas em PROD); a 9zd é a linha 4 da fila nova. Aqui fica o texto de
antes, com a numeração da época.

| Ordem | Prioridade | Item | Estado | Próxima ação | Dependência |
|---|---|---|---|---|---|
| 1 | P0 | **FORMULATION-WORKBENCH-01** — Formulação como bancada interativa (forma × apresentação, física por dose e por cápsula, composição × embalagem) | **EM HOMOLOGAÇÃO** · motor e migration aditiva `20260925093028` entregues em 2026-09-15 · ajustes de UX da homologação entregues em 2026-09-15 (pureza e reserva de produção como colunas, painel de ajustes fora da Formulação, forma restrita a Pó/Cápsula, resumo de premissas no topo) · refinamento final de UX entregue em 2026-09-15 (rótulos Pureza (%) e Reserva de matéria-prima (%), premissa global Perda prevista de produção (%) com Rendimento esperado derivado, quantidade bruta no custo estimado interno sem tocar quantidade comercial, grade modernizada, Apresentação comercial condicionada à Forma, explicações em ⓘ) · migration aditiva `20260925093029` · **publicada em PROD em 2026-09-16** (HOMOLOGATION-RELEASE-RAILWAY-01); o achado da homologação em PROD — o seletor de Fornecimento coberto pela Reserva na receita por base fixa, na Formulação e no Modelo — foi corrigido em `5b7c1a3` sem mudar largura de coluna | Avaliação visual do PO nos dois produtos de homologação do `veridi_dev` e em PROD; o fechamento depende de aprovação explícita | — |
| 4 | P1 | **E2E-BASELINE-REDESIGN-WAVE-04** — grupo C das E2E com massa própria | Discovery `EM_ANALISE`; P1 e a espera da 4E resolvidas pelo estado posterior | PO fecha P2–P8 ([abaixo](../BACKLOG.md#wave-4--decisões-ainda-reais)); 4A pode começar | — |
| 5 | P1 | **INVENTORY-PHYSICAL-COUNT-01** — Inventário Físico em sessões de inventário | Discovery `DECIDIDO` · **Fatia 1 (domínio e API) entregue em 2026-09-15** · **Fatia 2A (telas até Em revisão: lista, novo com prévia, detalhe, contagem no desktop e em 390px, fila local, conflito, posições, ocorrências, cancelar, concluir a primeira contagem) entregue em 2026-09-16** · **Fatia 2B (revisão com recortes e seleção por id, recontagem, Ajustar/Não ajustar com confirmação de movimentação e movimentos da posição, encerramento com a consequência por unidade e recusa por posição, Contagem rápida pela prévia com retenção antes do saldo, aba Contagens rápidas, `INV-` em Movimentações, filtros de local, situação e validade) entregue em 2026-09-16** · na `main` e fora de PROD · sem migration · o ciclo pela tela está completo (contar → revisar → recontar → decidir → encerrar → ajustes) | Fatia 3 — FO-01 de sessão e CSV ([discovery](../discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md)); sobras da 2B e o achado da confirmação na [lista](../BACKLOG.md#inventário-físico--status) | — |
| 7 | P1 | Decisões de **PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01** → PRODUCTION-PERMISSION-HARDENING-01 | Discovery `EM_ANALISE` · P1 e P6 bloqueiam | PO fecha P1 e P6 (e confirma P2–P5, P7, P8); implementar | — |
| 8 | P1 | Decisões de **WAVE-05-GOLDEN-PATH-DISCOVERY-01** → E2E-BASELINE-REDESIGN-WAVE-05 (golden path) | Discovery `EM_ANALISE` · Q3 bloqueia | PO fecha Q3 e as demais; passos 1–2 do plano não dependem de decisão | WAVE 4 entregue |
| 9q | P1 | **ITEM-DUPLICATE-SANITIZATION-01** — Itens de matéria-prima e embalagem com o mesmo nome, Onda A | **Onda A aplicada no `veridi_dev` em 2026-09-17; PROD não saneado** (`release/prod` segue `5b7c1a3`) · decisões do PO no handoff ([discovery](../discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md), persistido nesta rodada): G1, G12, G14, G16, G17 e G18; duplicado sem uso removido; de-para no arquivo de decisão da carga, sem alias · ferramenta PLAN/APPLY/VERIFY com trava consultiva, `SELECT FOR UPDATE`, impressão digital e falha fechada; APPLY só em banco local · importador não recria a duplicata absorvida · DEV: Itens −6, relações −2 e 1 movida, ofertas e eventos preservados; restam 12 grupos · **sem migration** | Onda A em PROD (conferência READ ONLY, PLAN em PROD, backup restaurável e APPLY liberado para produção, com aprovação do PO); Ondas B e C (regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §110, estado em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md)) | PO |
| 9zd | P1 | **DOCUMENT-TRANSITION-CONCURRENCY-01 (Fatia 2)** — os P1 do discovery | Aberta · Pedido (aplicar plano e reservar × cancelar deixam reserva ACTIVE presa; confirmar × cancelar ressuscita o cancelado), Faturamento (emitir × cancelar, editar × emitir), OC confirmar × cancelar e Lote liberar × bloquear · OP liberar × cancelar ficou coberto pela Fatia 1 (o cancelamento travado relê LIBERADA e libera a reserva criada), sem teste dedicado | Handoff do PO; o mesmo padrão da Fatia 1 ([discovery](../discovery/DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01.md), seções 8 e 15) | 9zc |
| 10 | P2 | **Estabilização final ampla do produto** | Sem ID e sem escopo | Abrir ID e escopo quando 4–8 fecharem | WAVE 4, permissões e WAVE 5 |
| 11 | — | **DEMO-DATASET-01** — ambiente DEMO com massa fictícia determinística | **AGUARDANDO DEFINIÇÃO DO PO** | Massa fictícia determinística + reset protegido para um futuro ambiente Railway DEMO, e o fluxo `main` → `release/demo` → aprovação → o MESMO SHA em `release/prod`. Nada criado: sem ambiente, sem `release/demo` | PO |

## STORAGE-R2-ACTIVATION-01 — feito em 2026-09-17, ainda aberto no BACKLOG

A consolidação achou o item aberto em "Abertos fora da fila" e na seção G, mas o R2 está ativo em PROD desde a release
`8e824e8f` (2026-09-17): as seis variáveis estão no serviço e o código que as lê subiu nela ([`DEPLOY.md`](../DEPLOY.md)
§6.1, [`RELEASES.md`](../RELEASES.md)). Sobra uma pergunta, anotada no BACKLOG (seção C, #7): bucket próprio para PROD,
que hoje usa o de homologação. O registro da seção G, como estava:

### STORAGE-R2-ACTIVATION-01 — ligar o Cloudflare R2 no Railway — P1 · AGUARDANDO O PO

Registrado em 2026-09-16 por LABEL-ATTACHMENTS-01, **sem nada feito no Railway**. O código está pronto e desligado: sem
variáveis, o arquivo do Item Rótulo vai para o volume (`LOCAL_FS`). Ligar = cadastrar `VERIDI_STORAGE_PROVIDER=R2`,
`VERIDI_R2_ENDPOINT`, `VERIDI_R2_BUCKET`, `VERIDI_R2_REGION=auto`, `VERIDI_R2_ACCESS_KEY_ID` e
`VERIDI_R2_SECRET_ACCESS_KEY` no serviço, e provar antes com `pnpm storage:r2:smoke` na mesma credencial
([`DEPLOY.md`](../DEPLOY.md) §6.1). Infra já pronta pelo PO: bucket privado `veridi-homologacao` e token S3 restrito a
ele; o smoke real com essa credencial, injetada fora do Git, passou em 2026-09-16 (upload, head, download com bytes
iguais, sobrescrita recusada, objeto apagado). Decidir também se PROD usa o mesmo bucket de homologação ou um próprio —
o bucket mora só na variável.

## INTERNAL-CONSUMPTION-REVERSAL-01 — registro da seção G

Fechado em 2026-09-18 (§126); a linha fechada já estava na seção A deste arquivo. O registro que ainda morava na seção G
do BACKLOG, como estava:

### ~~INTERNAL-CONSUMPTION-REVERSAL-01~~ — desfazer um consumo interno registrado — FECHADO em 2026-09-18

**Fechado em 2026-09-18** por INTERNAL-CONSUMPTION-REVERSAL-01 (§126), com as decisões P1–P10 do PO no
[discovery](../discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md): estorno próprio (`ECI-`), entrada
`INTERNAL_CONSUMPTION_REVERSAL`, total ou parcial, só ADMIN e QUALITY, R-21 líquido na data do CI. Vale só para o
consumo interno — as outras saídas continuam sem estorno e pedem discovery própria. O texto abaixo registra quando
era pergunta.

Registrado em 2026-09-17 por INTERNAL-CONSUMPTION-01 (Fatia 2), **sem implementação e por decisão consciente**. O
consumo interno só CRIA: não há `DELETE`, não há estorno e o registro confirmado não é editado. Isso não é uma falta
desta capacidade — é o padrão do sistema inteiro: nenhum movimento físico confirmado desfaz hoje (recebimento,
consumo de produção, amostra e expedição também não). Inventar um estorno só aqui criaria um conceito que o resto do
estoque não tem, e que o relatório da Fatia 3 teria de interpretar sozinho.

O caminho que existe hoje para um consumo lançado errado é o Inventário Físico: conta o que realmente há e gera o
ajuste rastreável pela diferença. A pergunta ao PO, quando houver posição: um consumo interno errado merece estorno
próprio (movimento de entrada ligado ao `CI-` original, com motivo), ou a correção por inventário basta? Se a
resposta for estorno, ela provavelmente vale para as outras saídas também, e aí é uma decisão de estoque, não de uso
e consumo.

---

# Saídos do BACKLOG em 2026-09-19 (DOCUMENTATION-HYGIENE-COMPACTION-01)

Rodada só de documentação, sobre `main` `8cf83861`. O BACKLOG passou a guardar, de cada item aberto, só o que
orienta o trabalho — o defeito ou a pergunta, a decisão pendente e a dependência. Abaixo está, **verbatim**, o texto
que a compactação tirou ou resumiu: narrativa de descoberta, evidência, medições, hashes, tabelas de grupos, registros
de quando o item era pergunta, as linhas da fila como estavam e as entradas já fechadas que ainda estavam lá. Os itens
abertos continuam no [BACKLOG](../BACKLOG.md) com o mesmo ID; nenhuma decisão, prioridade ou posição de fila mudou. O
pacote candidato da v1.1.0 e os blocos de decisão do PO (permissões e autoria, encerrar com motivo, passagem de
bastão) ficaram no BACKLOG como estavam e não se repetem aqui.

## Cabeçalho — regras de leitura e a base de 2026-09-19 (linhas 3–18 do BACKLOG em `8cf83861`)

O que está **aberto**. Nada mais.

Fechado não fica aqui: regra durável em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md), estado em
[`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), discovery em [`discovery/`](../discovery/README.md), onde cada regra é
protegida em [`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md) e o que já saiu deste arquivo em
[`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md). Escopo futuro vive só em
[`ROADMAP_POST_MVP.md`](../ROADMAP_POST_MVP.md) e não entra aqui sem decisão explícita do PO.

**Base:** reconciliado com o estado real em 2026-09-19 sobre `main` `c860e190` (PRODUCT-BACKLOG-CONSOLIDATION-01;
antes, em 2026-09-15, BACKLOG-RECONCILIATION-01); `main` declarada estável em `0d81aae` (MAIN-STABILITY-FAST-GATE-01,
2026-09-15). PROD em `release/prod` = `884a500d`, **v1.0.0** desde 2026-09-19, tags `v1.0.0` e
`prod-2026-09-19-v1.0.0` ([`RELEASES.md`](../RELEASES.md)): nada integrado depois foi publicado — o pacote candidato da
v1.1.0 está [abaixo da fila](../BACKLOG.md#veridi-nutrition-v110--candidata). As 2 falhas conhecidas da suíte web completa, que
existiam em `3159180` e `5b7c1a3`, fecharam na `main` em 2026-09-16, fora de PROD (WEB-SUITE-PREEXISTING-FAILURES-01:
3.657 testes, 0 falhas; entrada em [`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção A). Zero CRITICAL,
zero BLOCKER. O MVP foi entregue; o que está aqui é evolução do produto.

## Fila viva — as linhas como estavam antes da compactação (linhas 22–104 do BACKLOG em `8cf83861`)

## Fila viva — a ordem, num lugar só

Reorganizada em 2026-09-19 (PRODUCT-BACKLOG-CONSOLIDATION-01) com a ordem dada pelo PO, sobre `main` `c860e190`. Só o
que está aberto: as linhas fechadas da fila anterior, e o texto das abertas como estava, foram para
[`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md), seção "Saídos do BACKLOG em 2026-09-19". Um problema tem um
ID só; o detalhe mora no discovery ou na seção indicada, e a fila só ordena.

| Ordem | Prioridade | Item | Estado | Próxima ação | Dependência |
|---|---|---|---|---|---|
| 1 | P0 | **AUTHZ-VIEWER-READONLY-01** — VIEWER somente leitura e os perfis decididos por ato | Decidido pelo PO em 2026-09-19 (decisões 1–7 e 10 de [AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](../discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md), [resumo abaixo](../BACKLOG.md#permissões-e-autoria--decisões-do-po)) · o relatório do discovery não ficou registrado: o inventário de rotas se refaz na `main` atual | Handoff do PO | — |
| 2 | P1 | **AUTHORSHIP-SESSION-ACTOR-01** — autoria nova pelo usuário da sessão e ator obrigatório no service | Decidido (decisões 8 e 9 do mesmo discovery) · sem backfill de "Ambiente local" · pode ir na mesma rodada do 1, se simples e seguro, como conceito separado | Handoff do PO | — |
| 3 | P0/P1 | **PENDING-PRODUCTION-LOT-ATTRIBUTION-01** — defeito F-1: com Plano misto (estoque + produção), a OP do saldo oferece e aceita produzir em dobro | Por leitura, sem teste (F-1 de [OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01](../discovery/OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md), [resumo abaixo](../BACKLOG.md#passagem-de-bastão-no-painel--decisões-do-po)) · correção proposta: produção atribuída por lote e uma função única para o DTO e a OP do saldo · sem migration | Reproduzir com teste vermelho e corrigir | — |
| 4 | P1 | **DOCUMENT-TRANSITION-CONCURRENCY-01 (Fatia 2)** — os P1 do discovery | Aberta · Pedido (aplicar plano e reservar × cancelar deixam reserva ACTIVE presa; confirmar × cancelar ressuscita o cancelado), Faturamento (emitir × cancelar, editar × emitir), confirmar e editar OC, Lote liberar × bloquear e os resíduos P1 confirmados — OP liberar × cancelar ficou coberto pela Fatia 1, sem teste dedicado ([discovery](../discovery/DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01.md), seções 8 e 15) | Handoff do PO; o mesmo padrão da Fatia 1 | Fatia 1 (`ea5188e2`) |
| 5 | P1 | **PURCHASE-SUGGESTION-OWNER-SCOPE-01** — a Sugestão de Compra mede o disponível sem escopo de dono | Por leitura, sem teste · lateral de VERIDI-AUDIT-QUICK-FIXES-01 (seção A) | Reproduzir com teste vermelho e corrigir | — |
| 6 | P1 | **CLOSE-WITH-REASON-PO-01** — encerrar o saldo de OC com motivo | Decidido (fatia 1 de [CLOSE-WITH-REASON-DISCOVERY-01](../discovery/CLOSE-WITH-REASON-DISCOVERY-01.md), [resumo abaixo](../BACKLOG.md#encerrar-com-motivo--decisões-do-po)) · absorve o G5 do Painel Gerencial · **migration aditiva** | Handoff do PO | — |
| 7 | P1 | **CLOSE-WITH-REASON-OP-01** — encerrar OP sem produção | Decidido (fatia 2) · sem migration · permissão provisória ADMIN + PRODUCTION · leva P3a e P3b: OP concluída, com ou sem produção, não prende o cancelamento do Pedido | Handoff do PO | — |
| 8 | P1 | **CLOSE-WITH-REASON-RESERVATION-01** — liberar reserva de PA | Decidido (fatia 3) · sem migration · base da fatia do Pedido | Handoff do PO | — |
| 9 | P1 | **CLOSE-WITH-REASON-CO-01** — encerrar o saldo de Pedido | Decidido (fatia 4) · **migration aditiva** · inclui a trava das entregas (L7) | Handoff do PO | 8 |
| 10 | P1/P2 | **DASHBOARD-ORDER-NEXT-ACTION-01** — a próxima ação do Pedido no Painel: PA pronto para reservar, Pedido sem Plano, saldo sem produção | Decidido (F1 do discovery de passagem de bastão) · sem migration · suprime o "aguardando produção" redundante | Handoff do PO | 3 |
| 11 | P2 | **DASHBOARD-OP-READY-TO-RELEASE-01** — OP pronta para liberar | Decidido (F2) · sempre INFO, ordenada pela programação | Handoff do PO | — |
| 12 | P2 | **DASHBOARD-DELIVERY-DELAYS-01** — entrega atrasada e OP que termina depois da promessa | Decidido (F3) · comparação por dia civil; `requestedDeliveryDate` é a promessa implícita do Pedido sem entrega ativa | Handoff do PO | — |
| 13 | P2 | **STOCK-COUNT-EXPIRED-STATUS-FILTER-01** — "Situação do lote: Vencido" deixa vazio o escopo do Novo inventário | Aberto (seção A) | Corrigir | — |
| 14 | P2 | **PERIOD-GUARD-R21-MATRIX-01** — guarda `periodo-invertido` vermelha na `main` desde o R-21 | Aberto (seção A) | Corrigir | — |
| 15 | P2 | **LOT-STATUS-FILTER-OVERLAP-01** — lote vencido gravado como Liberado aparece em "Vencido" e em "Liberado" | Pede decisão: situação filtrada efetiva × gravada (seção A) | PO decide; depois corrigir | — |
| 16 | P2 | **DASHBOARD-EXPIRED-LIST-BALANCE-01** — o card de vencidos conta com saldo; o "ver todos" lista todos | Aberto (seção A) | Corrigir | — |
| 17 | P2 | **API-500-RAW-ERROR-01** — erro não traduzido volta 500 com a mensagem crua do Prisma | Aberto (seção A) · o tratador global já não recursa (API-GLOBAL-ERROR-HANDLER-01) | Corrigir | — |
| 18 | P2 | **INTERNAL-CONSUMPTION-COST-CENTER-01** — Centro de Custo do consumo interno | Decidido ([INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01](../discovery/INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01.md); seção G) · **migration aditiva** · abaixo dos P0/P1 atuais | Handoff do PO | — |
| 19 | P2 | **DASHBOARD-INTERNAL-CONSUMPTION-01** — o Painel não representa Uso e consumo | Falta decidir o card: próprio, líquido dos estornos como o R-21, ou num existente (seção G) | PO decide o card | — |

**Depois, nesta ordem:**

1. **REVERSALS-02** — estorno rastreável no padrão do `ECI-` (§126) para as outras saídas, que seguem sem estorno ("vale
   só para o consumo interno", [INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01](../discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md)).
2. **PURCHASE-NEEDS-CONSOLIDATED** — necessidade de compra consolidada por item, sem MRP.
3. **CONTEXT/CONSULTATION** — Visão do Produto e do Cliente completas, e a cadeia de custo (`costing`) já calculada e
   não exibida.
4. **SHOP-FLOOR-RECORDING** — registro de produção fiel ao papel: data real, pré-preenchimento, número oficial.
5. **MASTER-DATA-NAME-UNIQUENESS-01** — índice único de nome no banco, bloqueado pelo saneamento de PROD (seção G).
6. **Saneamento das duplicatas em PROD** — operação separada, nunca junto de publicação: Ondas A, 2 e 3 (§110, §118,
   §124) com conferência READ ONLY, PLAN, backup restaurável e APPLY aprovado pelo PO (ITEM-DUPLICATE-SANITIZATION-01 e
   as ondas da seção G).

Os itens 1 a 4 correspondem a quatro pontos do Top 8 da revisão funcional ponta a ponta
(VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01, 2026-09-19, só no chat), com a descrição de lá; os outros quatro pontos
do Top 8 estão nas linhas 1–2, 6–9 e 10–12 da fila.

**Fora da ordem de 2026-09-19** — abertos com posição na fila anterior, que esperam decisão ou handoff:

| Item | Estado | Próxima ação | Quem |
|---|---|---|---|
| **FORMULATION-WORKBENCH-01** — Formulação como bancada interativa | **EM HOMOLOGAÇÃO** · publicada em PROD em 2026-09-16 · histórico em [`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md) | Avaliação visual do PO; o fechamento depende de aprovação explícita | PO |
| **E2E-BASELINE-REDESIGN-WAVE-04** — grupo C das E2E com massa própria | Discovery `EM_ANALISE`; a 4A pode começar | PO fecha P2–P8 ([abaixo](../BACKLOG.md#wave-4--decisões-ainda-reais)) | PO |
| **INVENTORY-PHYSICAL-COUNT-01** — Inventário Físico em sessões | Fatias 1, 2A e 2B entregues: o ciclo pela tela está completo | Fatia 3 — FO-01 de sessão e CSV; INVENTORY-CONFIRMATION-AFTER-DECISION-01 espera o PO ([abaixo](../BACKLOG.md#inventário-físico--status)) | PO |
| **PRODUCTION-PERMISSION-HARDENING-01** — perfil final de quem executa a OP | Discovery `EM_ANALISE` · o VIEWER, a autoria, P3, P4 e P8 saíram para as linhas 1 e 2 em 2026-09-19; até o perfil final, vale o provisório "todos menos VIEWER" | Veridi responde P1 e P6 ([abaixo](../BACKLOG.md#permissões-da-produção--status)) | Veridi |
| **E2E-BASELINE-REDESIGN-WAVE-05** — golden path | Discovery `EM_ANALISE`; vem depois da WAVE 4 | PO fecha Q3 e as demais ([abaixo](../BACKLOG.md#golden-path-wave-5--status)) | PO |
| **Estabilização final ampla do produto** | Sem ID e sem escopo | Abrir ID e escopo quando a WAVE 4, as permissões da Produção e a WAVE 5 fecharem | PO |
| **DEMO-DATASET-01** — ambiente DEMO com massa fictícia determinística | **AGUARDANDO DEFINIÇÃO DO PO** · nada criado: sem ambiente, sem `release/demo` | Massa fictícia determinística + reset protegido para um futuro ambiente Railway DEMO, e o fluxo `main` → `release/demo` → aprovação → o MESMO SHA em `release/prod` | PO |

**P3** — LOW e UX realmente abertos, sem posição: tabelas da seção A (a partir de "LOW e UX da triagem"), fora os que
ganharam posição na fila acima; seção D e watchlist (E). A estabilização final é o lugar natural para varrê-los.

**Abertos fora da fila**, cada um esperando decisão própria — nenhum sobe sem o PO:

| Item | Por que não está na fila | Onde |
|---|---|---|
| **CUSTOMER-MASTER-DATA-AUDIT-01** — histórico de antes/depois do cadastro do Cliente (P2) | Futuro, registrado em 2026-09-16 (CUSTOMER-EDIT-PERMISSIONS-01); avaliar antes de construir | G |
| **MASTER-DATA-STRUCTURAL-LOCKS-01** — travas estruturais do cadastro mestre além de `operationallyUsed` | Registrado em 2026-09-16 (MASTER-DATA-EDIT-PERMISSIONS-01); pergunta de produto antes de construir | G |
| **MASTER-DATA-STATUS-HISTORY-01** — motivo e histórico de Inativar/Reativar de Item, Fornecedor e Produto (P2) | Futuro, registrado em 2026-09-16 (MASTER-DATA-EDIT-PERMISSIONS-01); exigiria migration | G |
| **SUPPLIER-ITEMS-UX-01** — Fornecedor → Itens fornecidos administrável no cadastro do Fornecedor (Fatia 2) | D4 do PO em 2026-09-16: capability separada, não implementar agora. A Fatia 1 (Item) fechou em ITEM-SUPPLIER-UX-01. Espera o handoff do PO | G |
| **ATTACHMENTS-R2-MIGRATION-01** — anexos genéricos (`Attachment`) no adaptador de storage e no R2 (P2) | Futuro, registrado em 2026-09-16 (LABEL-ATTACHMENTS-01); avaliar se ainda faz sentido | G |
| **LABEL-FILE-SUBTYPE-CHANGE-01** — Item Rótulo com versões pode trocar de subtipo e a seção some (LOW) | Registrado em 2026-09-16 (LABEL-ATTACHMENTS-01), sem posição: é pergunta de cadastro mestre | G |
| **ASSISTED-ENTITY-SELECTOR-ROLLOUT-01** — consulta assistida nos demais seletores (Cliente, Fornecedor, Produto, Lote e outros) | Registrado em 2026-09-17 (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01): expandir só depois de validar o piloto Item com a Veridi. A seleção múltipla já existe (ASSISTED-ENTITY-MULTISELECT-01). Espera o handoff do PO | G |
| **COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01** — linha de recurso sem uso por lote não vai no "Salvar rascunho" do Modelo de Estrutura (LOW) | Registrado em 2026-09-17 (ASSISTED-ENTITY-MULTISELECT-01): anterior à rodada, mais visível com "+ Adicionar recursos". Pergunta de UX antes de mexer | G |
| INACTIVE-MARKERS-REPORTS-01 (opcional) — última fatia do cadastro inativo | Registrada em 2026-09-17 com o discovery. As Fatias 1 a 4 fecharam no mesmo dia (INVENTORY-INACTIVE-ITEM-VISIBILITY-01 §107, PRODUCT-INACTIVE-COMMERCIAL-GATE-01 §108, SUPPLIER-ITEM-INACTIVE-GATE-01 §112 e PRODUCTION-INACTIVE-COMPONENT-GATE-01 §116). Só D9 (R-18 abre em "Todos", com a situação) tem recomendação e espera o handoff do PO | [discovery](../discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md) |
| **ITEM-DUPLICATE-SANITIZATION-01** — grupos restantes (2 no DEV: G6 café verde e G11 fosfato de piridoxal) | Ondas 2 (§118) e 3 (§124) resolveram os demais no DEV. G6 e G11 esperam a Veridi: significado de `*`/`**` (V4), teor de clorogênico e as cotações FLORIEN (V1). Registrado em 2026-09-17 com a Onda A | [discovery](../discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md) |
| **ITEM-NAME-STANDARDIZATION-01** — nome do Item MP/ME em MAIÚSCULAS e único sem caixa | Parado em 2026-09-17 no passo de duplicidade: o índice único não nasce enquanto houver grupo repetido (2 no DEV depois da Onda 3; PROD não saneado). Retomar depois das ondas, recontando no DEV e em PROD | [discovery](../discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md) |
| **OPS-BACKUP-01** — backup agendado de PROD (HIGH) | Snapshot do Railway recusado e PITR desligado; o backup lógico JSON é restaurável e provado. Rotina agendada é decisão de infraestrutura | A |
| COST-VAR-02 — variação de CMV e proteção de margem | Bloqueado: sete decisões do PO e dado real em produção | [`archive/COST-VAR-01…`](COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) |
| #8E, #8F, #8G · PLAN-DATE-01 · UX-HELP-03 | Melhorias aguardando autorização | B, E |
| #7, #11 | Gate com a Veridi | C |
| SUPPLIER-OFFER-OVERLAP-01 · COM-CONTRACT-01 · SUPPLIER-MODE-01 · ASSET-01 | Discovery sem pergunta decidida | G |
| **FINISHED-GOODS-OWN-LOT-PREFERENCE-01** — preferir o lote produzido para a própria linha do Pedido (opcional) | Pendente em 2026-09-19 e não decidido: muda a política de alocação (hoje FEFO, sem olhar o dono do lote de PA) | [discovery](../discovery/OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md) |
| Achados preservados na consolidação de 2026-09-19 — qualidade × lote reservado, custo histórico, perda esperada × operacional, OP com perda total, retorno de cliente e fornecedor, material equivalente, vida útil mínima por cliente, políticas definitivas por área | Sem posição; a maioria depende da Veridi | C |

## Decisões ainda reais — WAVE 4, Inventário Físico, Painel Gerencial, Permissões da Produção e golden path (linhas 205–319 do BACKLOG em `8cf83861`)

### WAVE 4 — decisões ainda reais

[E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01](../discovery/E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01.md), lido sobre
`9c60845` e persistido sobre `6256ca9` sem ser refeito. O documento histórico não muda.

**Resolvido por estado posterior:**

- **P1** (WAVE 3 era só o fluxo do Orçamento ou também o grupo C?) — a WAVE 3 foi entregue em `6256ca9` (2026-09-15)
  como o fluxo do Orçamento (E2E-QUOTE-PAGE-FLOW-01); o grupo C é da WAVE 4 ([`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md),
  "Próxima prioridade"). Com isso a 4A, a 4B e a 4F ficam prontas pelo próprio discovery.
- **Espera da 4E pela WAVE 3 na `main`** — satisfeita em `6256ca9`. Antes da 4E, reconferir as fixtures comerciais que
  a WAVE 3 criou (`scripts/e2e/fixtures/comercial.mjs`, `comercial-ui.mjs`), que o discovery não auditou.

**Ainda reais** (cada uma com recomendação no discovery):

- **P2** — Pedido + Confirmar + Plano por API na disponibilidade e em entregas/expedição (a ajuda já é API e o
  cancelamento, tela).
- **P3** — nome da suíte fundida de entregas e expedição, e remoção dos dois arquivos antigos.
- **P4** — um PA de 20 un para os dois cenários, ou um `produzirPa` por cenário.
- **P5** — pureza e overage da massa própria (98 % e 5 %, registrados e não aplicados), sem cenário novo.
- **P6** — ajuda: Orçamento pela página da versão ou pela ficha do Projeto; Formulação pelo detalhe do produto ou
  pela versão; checagem de 390 no Pedido.
- **P7** — OP fora da 1ª página com o roteiro padrão do produto (`PUT`) em vez de aplicar roteiro na OP.
- **P8**, reformulada — a premissa "sem helper da WAVE 3" caiu (`fixtures/comercial.mjs` está na `main`). Resta
  decidir se o desconto digitado no Orçamento faz parte da prova, ou se entra por API e só envio → faturamento fica
  na tela.

Absorve E2E-CORPUS-MASS-01: o que sobrava dele (grupo C e a suíte de `PROD-000214`) são suítes alvo desta wave.

### Inventário Físico — status

**PO BASELINE APROVADA** (INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01, seção G; `04d97ad`, merge `9b011aa`).
**Discovery INVENTORY-PHYSICAL-COUNT-DISCOVERY-01: `DECIDIDO`** — D1–D8 e P1–P7 fechadas pelo PO em 2026-09-15
(opção F de concorrência, recontagem opcional, sem tolerância, ADMIN/PRODUCTION/QUALITY contam e aprovam), documento em
[`discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md`](../discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md).
**Fatia 1 entregue em 2026-09-15** (INVENTORY-PHYSICAL-COUNT-01): domínio, schema e API das sessões, e a Contagem rápida
gravando `INV-` QUICK. **Fatia 2A entregue em 2026-09-16**, sobre o discovery das telas
(INVENTORY-PHYSICAL-COUNT-UI-DISCOVERY-01, addendum do documento, DU-1 a DU-6): as telas contam até Em revisão.

**Fatia 2B entregue em 2026-09-16** (INVENTORY-PHYSICAL-COUNT-01, na `main` e fora de PROD, sem migration): revisão com
recortes e seleção por id, recontagem pedida e contada pela tela de contagem, Ajustar/Não ajustar com motivo e
confirmação de movimentação marcada à mão (com os movimentos da posição), encerramento com a consequência por unidade e
os ajustes vistos conferidos pelo servidor (`stock_count_changed`), recusa por posição com recontar/redecidir/voltar à
revisão, Contagem rápida pela prévia (retenção antes do saldo, `expectedSystemQuantity`, `Decimal`, `INV-` no
resultado), aba Contagens rápidas com o resultado, `INV-` em Movimentações, R-03 e CSV, e filtros de local, situação e
validade no Novo inventário. Decisões do PO da rodada: sem endpoint de pré-checagem do encerramento (tenta e mostra a
recusa); só a última decisão e a última recontagem ficam gravadas; histórico completo delas não agora.

**Ainda aberto do assunto** (nenhum bloqueia o ciclo pela tela):

- **INVENTORY-CONFIRMATION-AFTER-DECISION-01** (P2, pede decisão do PO — toca quantidade): a confirmação de movimentação
  vale para sempre na posição. Movimento lançado DEPOIS da decisão — inclusive um lançamento retroativo — não pede nova
  confirmação, e o encerramento aplica a diferença congelada; recontagem (rodada ≥ 2) também dispensa a confirmação para
  movimentos lançados depois dela. Achado na Fatia 2B, lendo `completeStockCount`; não corrigido (regra de domínio da
  Fatia 1). Proposta: confirmação vale até o instante da decisão, e movimento posterior volta a pedir;
- adicionar posição em revisão pela tela (a API aceita e responde sem saldo a quem conta; a tela só oferece em contagem);
- filtros "última contagem" e "movimentação" do montador (o PO pediu só os que entregam valor agora: local, situação e
  validade entraram); retenção leve;
- histórico completo de decisões e recontagens por posição (hoje só a última) — decisão do PO: não agora;
- conferência visual em navegador da revisão e dos diálogos em 390px (a rodada foi validada por testes de tela; o PO
  vetou Playwright nela).

Depois: Fatia 3 (FO-01 de sessão e CSV controlado). Regularização de material sem lote (P7), inventário cíclico, scanner
dedicado e localizações seguem FUTURO.

### Painel Gerencial — status

**Versão 1 entregue em 2026-09-15** (MANAGEMENT-DASHBOARD-V1-01, Gestão → Painel Gerencial): D1–D5 decididas e
aplicadas, e o faturado sai de `billings/billed-value.ts`, nunca de conta própria. O encerramento de saldo de OC
parcialmente recebida (G5) virou CLOSE-WITH-REASON-PO-01 em 2026-09-19 (fila, linha 6); o "a receber de fornecedores"
em R$ fica viável depois dele, como opcional. Continuam abertos, sem posição e sem promoção: preço acordado em Pedido
digitado direto (G2); lista de Pedidos por data de confirmação (G4 residual), sem a qual o cartão "Pedidos confirmados"
fica sem link. Evolução do discovery (seção 10.3), só com pedido do PO: recebido a custo
efetivo, compras por fornecedor, propostas em aberto, margem contratada, bloco de Compras para PURCHASING, atalho no
Painel Operacional e PDF do painel. Fora do produto: contas a pagar, contas a receber, caixa e margem realizada.

### Permissões da Produção — status

Capability própria, [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](../discovery/PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md).
**Não está resolvida porque as E2E rodam como ADMIN** (decisão G): isso só tira os perfis das E2E, não fecha a API.

**Desde 2026-09-19 o item ficou só com o perfil final de quem executa a OP.** As decisões de
[AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](../discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md) levaram o resto: o VIEWER
de I1 vai para AUTHZ-VIEWER-READONLY-01 (fila, linha 1); a autoria de I3 e I7 para AUTHORSHIP-SESSION-ACTOR-01 (linha
2); P3 respondida (Plano, OP do saldo, reservar e realocar PA com ADMIN + COMMERCIAL); P4 respondida (os "Ambiente
local" antigos ficam, sem backfill); P8 absorvida pelas duas. Até o perfil final, a execução da OP segue o provisório
"todos menos VIEWER".

- **Bloqueiam o perfil final (Veridi):** P1 — quem executa a OP (picking, consumo, pesagem, parte, apontamento,
  variância, conclusão; recomendado: só ADMIN + PRODUCTION); P6 — os operadores da Veridi entram com conta PRODUCTION
  própria.
- **Com recomendação, sem bloquear:** P2 (variância), P5 (botões de estoque que já dão 403), P7 (autoria em texto ×
  `userId`).
- **Armadilha preservada:** I6 — `ForbiddenError` não mapeado em `picking`/`production`/`recipe` (um `requireRole` novo
  responde 500); vale já para AUTHZ-VIEWER-READONLY-01.

### Golden path (WAVE 5) — status

[WAVE-05-GOLDEN-PATH-DISCOVERY-01](../discovery/WAVE-05-GOLDEN-PATH-DISCOVERY-01.md). Vem **depois da WAVE 4**.
`private-label-golden-path.mjs` não mudou desde `9c60845`: F-01 (quebra em `pedido`) e F-02 (quebra em
`sugestao-compra`) seguem valendo.

**Resolvido por estado posterior:**

- **Q5** (escopo das WAVE 3 e 4; esperar o merge da 3) — WAVE 3 = fluxo do Orçamento, mergeada em `6256ca9`; WAVE 4 =
  grupo C; o golden path vem depois da 4.
- **B1** (WAVE 3 em paralelo no trecho comercial) — deixou de ser bloqueio de processo. Sobra reconferência técnica do
  trecho comercial e do runner contra a `main`, sem decisão do PO.

**Ainda reais:** **Q3** (bloqueante — opção B do runner: repassa `--run`/`--desde`, exige `--clone`, checkpoint na
pasta do clone); Q1 (cadastros pela tela ou API), Q2 (pedido direto sai), Q4 (clone mantido na reprovação), Q6
(`orcamento`/`pedido` em quatro etapas), Q7 (diálogo de pendências na estrutura mínima), Q8 (asserções R/N), Q9
(roteiro padrão no Produto ou na OP), Q10 (commit diferente na retomada).

Absorve CUSTOMER-LIST-DEFAULT-E2E-01: o que sobrava dele é o golden path procurar Cliente pela lista padrão.

## A. Defeitos abertos — introdução, triagem de 2026-09-07 e achados das entregas posteriores (linhas 328–383 do BACKLOG em `8cf83861`)

## A. Defeitos abertos

Triados em 2026-09-07 sobre a auditoria de produto. Evidência, passos e
conferência numérica ficam em [`archive/E2E_AUDIT_2026-09-07.md`](E2E_AUDIT_2026-09-07.md);
aqui fica só o que exige trabalho, com a severidade **do PO**, que nem sempre é
a do auditor.

### LOW e UX da triagem de 2026-09-07

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-06-3** | `nextval` chamado fora da transação: recusa consome número de documento em cinco módulos | LOW | S |
| **F-03-2** | Coluna ORIGEM do histórico de versões vazia para versão criada de template | LOW | XS |
| **F-08-3** | Campos "Consumir agora" sem rótulo acessível | LOW | XS |
| **F-01-1** | "Produto" nomeia dois fatos diferentes na Consulta de Cliente | UX | S |
| **VOCAB-01** | Um conceito, três nomes: "Base de produção" (campo), "Base de referência" (leitura) e "Base de produção sugerida" (template) nomeiam a mesma quantidade. Mesma família de F-01-1; sweep só quando houver rodada de nomenclatura | UX | S |
| **F-01-2** | "Criar projeto" desabilitado sem dizer o que falta | UX | XS |
| **F-04-2** | Ativar estrutura e precificação com dado completo não pede confirmação | UX | S |

**F-01-1 e F-07-2 foram rebaixados**: os dois números estão certos para o que
representam — `Project.productId` (produto resultante) contra `project_products`
(produtos em desenvolvimento), e "disponível incluindo a reserva desta OP"
(`requirement-availability.ts:44`) contra disponível global. O defeito é o
rótulo, não o dado. **F-07-2 foi fechado no FIX-05** por isso mesmo: só o rótulo
mudou.

**F-06-3 foi elevado de observação a defeito**: o padrão correto já existe em
`products.service.ts:314`, com comentário nomeando exatamente este problema —
`nextSequenceCode(tx, …)` como primeira linha **dentro** da transação.

### LOW e UX — achados das entregas posteriores

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-01-3** | "Consulta completa" só é alcançável de dentro do modal de edição | UX | S |
| **QUOTE-VERSION-SWITCH-DIRTY-01** | Abrir outra versão com condições pendentes descarta o rascunho sem aviso — mantido de propósito em QUOTE-DRAFT-STATE-01. Só existe um rascunho por projeto e as outras versões são somente leitura; avisar, salvar ou descartar é decisão do PO | UX | S |
| **QUOTE-CASH-HIDDEN-DIRTY-01** | Parcela ou intervalo digitado no Parcelado e escondido pela troca para À vista conta como alteração pendente; salvar grava à vista sem parcelas (o servidor limpa), a releitura não muda o gravado e a pendência fica: "Alterações não salvas" e envio preso até "Descartar alterações". Por leitura de código, desde QUOTE-DRAFT-STATE-01 — antes da correção, o mesmo com `NaN`. Decidir se campo escondido conta como pendência | UX | S |
| **PTBR-NUMERIC-DISPLAY-RESIDUAL-01** | Resíduo consciente de PTBR-NUMERIC-DISPLAY-AUDIT-01: inteiros pequenos dentro de frase sem `formatIntegerPtBr` ("Página X de Y", "Preço incompleto (3/5)", produtos e lotes da conferência da Expedição) — só passam de 999 em volume irreal; a guarda estrutural não enxerga variável solta nem ternário (`: row.onOrder`), só a busca manual; e uma quantidade inteira exibida `1.234`, colada num campo decimal, é recusada como ambígua (a mensagem diz como escrever) | UX | S |
| **OP-PARTS-ZERO-COERCION-01** | "Dividir produção em" vazio ou `0` vai à API como 1 em silêncio — `Number(x) \|\| 1` herdado, preservado no rollout como `partesParaEnvio` para não mudar o payload. A API recusaria `0` com "A produção tem ao menos 1 parte"; decidir se zero volta como erro no campo | UX | XS |
| **NUMERIC-FOCUS-API-ZEROS-01** | Preço e custo de 8 casas que a API serializa com `toFixed` (`12.50000000`) aparecem `12,50` fora do foco e `12,50000000` no foco: `toPtBrEditText` preserva os dígitos, como manda a foundation. Tirar os zeros não significativos na carga mantém o payload semanticamente igual e muda a representação enviada ao salvar sem editar — decidir | UX | XS |
| **FORM-UOM-FK-01** | FK física em `FormulationTemplateComponent.unitCode` → `UnitOfMeasure`. A regra já vale sem ela — tela controlada, API fail-closed, ativação reconferida (FORM-UOM-01) —, e a auditoria somente leitura achou DEV 13/13 e PROD 7/7 componentes com unidade do catálogo e compatível: a migration seria trivial. Recomendada como endurecimento físico, **só com autorização do PO** | LOW | XS |
| **FORMULATION-ITEM-SWAP-UOM-01** | Na Formulação real, trocar o Item de um componente sempre põe a unidade de estoque do Item novo, mesmo quando a escolhida serve: `500` em `mg` vira `500` em `kg`, sem conversão nem aviso — e, antes do Item, a lista oferece o catálogo inteiro. O Modelo (FORM-UOM-01) mantém a unidade compatível e espera o Item; alinhar a Formulação é decisão do PO | UX | S |
| **API-500-RAW-ERROR-01** | Erro do Prisma que nenhuma rota traduz volta como 500 com a mensagem crua — a chamada, o trecho do código e o caminho do arquivo no servidor (visto com a chave estrangeira da unidade da base antes de FORM-UOM-01). Pede tradução genérica no handler global, sem vazar detalhe interno. Entre `f3a4c666` e API-GLOBAL-ERROR-HANDLER-01 a recursão do tratador escondia a mensagem por acidente (todo 500 dizia "Maximum call stack size exceeded"); corrigida a recursão, o 500 volta a trazê-la — segue aberto | LOW | S |
| **TZ-DST-MIDNIGHT-GAP-01** | No dia em que o horário de verão começa à meia-noite — o jeito do Brasil até 2019: em 04/11/2018 o relógio foi de 00:00 a 01:00 —, as duas passadas de `meiaNoiteComercial`/`instanteComercial` (`packages/shared/business-timezone.ts`) medem o deslocamento já de verão e voltam uma hora: `limitesDoDiaComercial("2018-11-04").inicio` é `02:00Z`, 23:00 de 03/11, o fim de 03/11 é `01:59:59.999Z`, e `instanteComercial("2018-11-04", 0..59)` cai em 03/11 às 23h. `diaCivil` diz 03/11 para esses instantes: filtro por período e dia comercial discordam nessa hora. O fim do verão (16/02/2019, 25 horas) sai certo. Só histórico hoje; volta se o horário de verão voltar. Anterior à TZ-FORMATTER-REUSE-01, que o manteve idêntico de propósito — corrigir muda o resultado de data | LOW | S |
| **R20-SENT-PRICING-BASIS-SNAPSHOT-01** | O envio do Orçamento congela na linha custo do cálculo, qualidade dele, margem e markup (`buildProvenanceSnapshot`), mas não o custo p/ preço, a qualidade dele nem o Modelo de Precificação. O R-20 da linha enviada diz "Não congelado no envio" em vez de deduzir do vínculo com a faixa (REPORT-ROBUSTNESS-WAVE-01). Fechar pede migration aditiva em `QuoteLine` — decisão de schema do PO. Proposta: `pricingCostPerUnitSnapshot Decimal(24,12)?` e `pricingCostQualitySnapshot IndustrialCostQuality?` copiados da faixa, e o Modelo copiado da versão (as nove colunas nulas de `PricingVersion`, ou `pricingModelSnapshot Json?`), preenchidos no envio; sem backfill — nulo continua "Não congelado no envio" | LOW | M |
| **R20-MANUAL-REFERENCE-MARGIN-01** | A conferir: linha de preço manual ou herdado enviada congela como referência a proveniência da faixa ativa da mesma quantidade (`faixaEquivalenteVigente`), e com ela `contributionMarginSnapshot` da faixa — margem calculada sobre o preço da faixa, não sobre o `unitPrice` da linha. O R-20 mostra essa margem na linha, ao lado do preço manual. Visto na leitura de REPORT-ROBUSTNESS-WAVE-01, sem reproduzir nem mudar | LOW | S |
| **QUOTE-NEW-VERSION-PATHS-01** | Dois caminhos criam versão com efeitos diferentes: "Criar nova versão"/"Novo orçamento" parte da mais recente, herda sozinho o preço do caso seguro de §74 e substitui a enviada; "Duplicar como nova versão" parte da escolhida, pergunta o preço e não substitui nada. O PO decide se os dois convergem (achado de QUOTE-DUPLICATE-01, registrado como P2) | UX | — |
| **QUOTE-DUPLICATE-ORIGIN-01** | A versão duplicada não guarda de qual nasceu: a linha com preço mantido diz no motivo; com "revisar", nada fica. Coluna de origem exigiria migration (achado de QUOTE-DUPLICATE-01) | UX | — |
| **CUSTOMER-FACTS-LOAD-01** | Watch: listagem e exportação de Clientes carregam, para cada Cliente da página, os Projetos com o histórico de status e os Pedidos confirmados. Número de consultas constante; volume de linhas cresce com a história. Medir com volume real (achado de CUSTOMER-COMMERCIAL-STATUS-01) | LOW | — |
| **QUOTE-SUGGESTION-390-01** | Em 390px a frase "Existe uma precificação vigente…" da linha do Orçamento fica cortada dentro da tabela rolável (já cortava o preço; a explicação de F-05-1 alonga a frase). Conferido no código em 2026-09-15: a frase segue em `QuoteWorkspace.tsx` | UX | — |
| **LISTS-CUSTOM-PERIOD-PAGE-RESET-01** | "Personalizado" clicado fora da página 1 (Faturamento, Recebimentos, OC, Produto Acabado) volta para a página 1 do MESMO recorte e consulta uma vez: semear grava `period`/datas na URL, e `useListFilters.set` sempre volta à página 1. Existe desde FILTER-FOUNDATION-01. Decidir se abrir o Personalizado é trocar filtro | UX | — |
| ~~**FORMULATION-PRINT-ADJUSTMENTS-01**~~ | **ABSORVIDO por FORMULATION-TECHNICAL-SHEET-PDF-01 (2026-09-15).** O achado era que nenhum impresso lia a pureza, a reserva (o antigo *overage*) nem o físico por unidade da Formulação. A Ficha Técnica do Produto lê os três direto da VERSÃO — pureza aplicada com nota quando o cadastro divergiu desde então, reserva por linha e "Por embalagem" na unidade de estoque — e diz "não aplicada" quando a versão histórica registrou pureza sem autorizar a correção, que é o que o modo da quantidade significa no papel. Fora da Formulação (Folha de Receita, OP, CMV, Cálculo) o achado do PDF-DOCUMENT-SYSTEM-01 segue como está: aqueles DTOs não trazem os ajustes, e levá-los é decisão de outro item | UX | — |
| ~~**FORMULATION-TEMPLATE-BASIS-EDIT-01**~~ | **ABSORVIDO por FORMULATION-TEMPLATE-WORKBENCH-01 (2026-09-16).** O achado era a falta de seletor de base na linha do Modelo. A base deixou de ser um campo genérico a oferecer: ela é consequência da SEÇÃO — embalagem conta por unidade acabada, composição conta por dose quando a receita é por dose (`baseSugeridaDaSecao`, `packages/shared`) —, e a fatia 1 já a sugere na linha nova pelo tipo real do Item. A linha que já declarou base não é tocada, e `FIXED_BASIS` continua existindo: matriz histórica escrita sobre a base continua sobre a base. O acabamento visual das duas seções é da fatia 2. Superado em 2026-09-17 por FORMULATION-COMPONENT-BASIS-AUTOMATION-01: a base de toda linha de rascunho é derivada e o seletor saiu (§106) | UX | — |
| **UI-NUMERIC-FIELD-STANDARD-01** | Aplicar ao sistema inteiro o padrão de campo numérico homologado na Formulação: caixa compacta, borda única, canto arredondado, número à direita, pt-BR, setas de incremento/decremento respeitando a última casa escrita e limites conforme o domínio. Pedido do PO em 2026-09-16, registrado sem implementar: é varredura de tela por tela, e entra na estabilização final (10) ou numa rodada própria | UX | — |
| **ATTACHMENT-ACTIONS-BY-ROLE-01** | Documentos de Lote, Recebimento, Projeto e Amostra (`AttachmentsSection`) oferecem anexar e "Arquivar" a todo perfil, mas a API só aceita anexar com a lista do contexto (Lote e Recebimento: Compras, Qualidade e ADMIN; Projeto: Comercial, Qualidade e ADMIN; Amostra: também Produção) e arquivar com Qualidade e ADMIN — o clique termina em 403. O Produto já passa `canUpload`/`canArchive` pelas listas de `@veridi/shared` desde MASTER-DATA-EDIT-PERMISSIONS-01; levar o mesmo às outras quatro telas pede as listas dos contextos no shared | UX | S |
| **NAV-TWO-SEARCHES-01** | Convivem "Buscar ou escanear lote" no topo e "Buscar telas…" na coluna; unificar é assunto da busca global de registros. Conferido no código em 2026-09-15: as duas seguem | UX | — |

## A. Achados laterais de VERIDI-AUDIT-QUICK-FIXES-01 (linhas 385–396 do BACKLOG em `8cf83861`)

### Achados laterais de VERIDI-AUDIT-QUICK-FIXES-01 (2026-09-19)

Vistos na rodada que corrigiu D1–D6, fora do escopo dela: registrados, não corrigidos. Desde 2026-09-19 os cinco têm
posição na fila viva (linhas 5 e 13–16).

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **PERIOD-GUARD-R21-MATRIX-01** | A guarda `lib/periodo-invertido.test.ts` ("o par de cada CSV é o da família") está vermelha na `main` desde o R-21 (INTERNAL-CONSUMPTION-REPORT-01, `50ee85a8`): o CSV `/reports/inventory/internal-consumption` tem o par `from`/`to` e não está em `FAMILIAS`. Reproduzido na base `83fa171e` (1 falha, 230 passam). Falta a família do R-21 na matriz — e, com ela, a prova de que o período invertido é recusado nesse CSV | LOW | XS |
| **PURCHASE-SUGGESTION-OWNER-SCOPE-01** | Por leitura, sem teste: a Sugestão de Compra mede o disponível das necessidades da Veridi com `getAvailableByItems` sem escopo de dono (`buildPurchaseSuggestion`, `purchase-suggestion.service.ts`), então estoque de cliente reduz a falta e a compra sugerida de material da Veridi. Mesma classe do D4; o material do cliente já usa o escopo certo | MEDIUM | S |
| **STOCK-COUNT-EXPIRED-STATUS-FILTER-01** | Novo inventário: a "Situação do lote" oferece "Vencido", que vira `status in [EXPIRED]` — nunca gravado —, e o escopo sai vazio. O filtro "Validade: Somente vencidos" funciona. Mesma raiz do D1, deixada de fora porque o escopo é reconferido no encerramento | LOW | S |
| **LOT-STATUS-FILTER-OVERLAP-01** | Os filtros "Liberado", "Aguardando liberação" e "Bloqueado" seguem o status gravado e listam lote vencido com o selo "Vencido"; desde o D1 o lote vencido gravado como Liberado aparece em "Vencido" e em "Liberado". Decidir se a situação filtrada é a efetiva — mexe na fila "Liberação de lotes" | UX | S |
| **DASHBOARD-EXPIRED-LIST-BALANCE-01** | O card LOT_EXPIRED conta lote vencido COM saldo; o "ver todos" abre Lotes com todos os vencidos, zerados inclusive, e a lista não tem filtro de saldo | UX | XS |

## A. Achados do FAST-DEVELOPMENT-RESET-02 e o achado estrutural (linhas 423–448 do BACKLOG em `8cf83861`)

### Achados do FAST-DEVELOPMENT-RESET-02 (2026-09-11)

Golden path private label pela interface, numa base recriada do zero. Dois
bloqueios apareceram e foram corrigidos na própria rodada: o catálogo de
unidades só existia onde alguém tinha rodado seed (instalação nova nascia sem
unidade nenhuma), e RECEIPT-BUSINESS-DAY-01 (todo lote recebido pela interface
levava a véspera no código). O que sobrou não bloqueia o fluxo. A fila viva
ficou congelada durante a rodada: posição destes itens é decisão do PO.

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **OPS-BACKUP-01** | Backup de produção: snapshot manual pela API do Railway recusado (`Not Authorized` — plano ou papel da conta), PITR desligado, nenhuma rotina agendada. O backup desta rodada é o lógico JSON (`prod-backup-json.mjs`), com restauração provada linha a linha por `restore-json-backup-check.mjs`. É o item "Backup do banco" de `DEPLOY.md` §7, que bloqueia operação de verdade. Desde BACKUP-RESTORE-CHECK-01 (2026-09-14) a prova concilia a referência que as migrations gravam (as 6 unidades) em vez de colidir na chave: o backup da carga inicial restaurou 687 linhas idênticas | HIGH | S |
| **TEMPLATE-PURITY-LEGACY-DATA-01** | Desde INPUT-DATE-CONTRACT-WAVE-01 o Modelo recusa pureza 0 ou acima de 100. Modelo gravado antes com esses valores continua lido, mas salvar a versão em rascunho sem corrigir a linha passa a dar 400 com a mensagem da pureza. Não conferido em PROD (sem leitura de produção nesta rodada): contar `formulation_template_components` com pureza `<= 0` ou `> 100` | LOW | XS |
| **COST-MP-EMB-SPLIT-01** | Nem a estimativa da Formulação nem o CMV mostram matéria-prima e embalagem em subtotais separados — o cálculo soma "Materiais e embalagens Veridi" numa linha (`CostBreakdown.tsx`). O total está certo; a separação sai somando pelo código MP-/ME- | UX | S |

### Achado estrutural, sem item próprio

Existem **três implementações independentes** da conta "quantidade por base":
`packages/shared/src/formulation-quantity.ts` (`fatorDaBase`),
`apps/api/src/lib/formulation-math.ts` (`basisFactor`, reimplementado à mão) e o
`convertUomDecimal` cru usado como se fosse a conta. O comentário do próprio
pacote compartilhado diz que isso é o que o domínio proíbe: *"duas contas para o
mesmo número acabam discordando, e a que aparece na tela seria a que ninguém
usa."* G2 (grupos de causa raiz, hoje em
[`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md)) é o primeiro sintoma; consolidar os três motores é candidato a
capability própria, não a correção de finding.

## B. Melhorias aprovadas — #8 e #9 (linhas 452–479 do BACKLOG em `8cf83861`)

## B. Melhorias aprovadas — aguardando autorização do PO

### 8. Cálculo ao vivo nas demais telas

Padrão nascido na Formulação: valor derivado aparece enquanto se digita, a
conta vem da **mesma função** que a API usa, `CalcHint` mostra a aritmética,
premissa ausente vira travessão. Já no padrão: Ordem de Compra, Expedição,
Precificação, Faturamento, Formulação, CMV e a prévia de política de preço
(#8A–#8D, #8H). Regra durável de prévia × gravado:
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §54.

| Item | Tela | Escopo | Prioridade |
|---|---|---|---|
| **#8E** | Recebimento | Custo efetivo: total e comparação com o custo previsto quando aplicável | LOW |
| **#8F** | Ficha de Pesagem | Mostrar a diferença antes da confirmação | LOW |
| **#8G** | Ordem de Produção | Mudar a quantidade planejada não atualiza a prévia das necessidades até salvar. **Auditar antes**: nenhum cálculo vivo pode mutilar OP já congelada | A AUDITAR |

Também no radar, sem item próprio: Contagem de Estoque e Reservar ↔ Produzir
calculam ao vivo mas ainda sem `CalcHint`; Custo Industrial e impacto de
materiais do Pedido ficam em branco até apertar botão, sem dizer que o valor é
do que está salvo.

### 9. OPS-CALENDAR-01 — ABSORVIDO por PLANNING-CALENDAR-01 (2026-09-12)

Fechado sem virar item próprio: o calendário global existe em Planejamento → Calendário de Produção. O
registro original e o que ficou de fora estão em
[`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md). Segue aberto só o discovery separado: se o mesmo
calendário global vale para prazo de planejamento de COMPRA.

## C. #7 — a lista de convenções como estava (linhas 489–508 do BACKLOG em `8cf83861`)

### 7. Convenções operacionais ainda não formalizadas

Cada uma tem um padrão em uso; nenhuma impede operação. Com o feedback da
Veridi, quebrar em requirements independentes:

- regra de geração automática do número de lote;
- limiar/alerta de validade próxima;
- permissões detalhadas por papel — o cadastro mestre já tem decisão do PO (Cliente §98; Item, Fornecedor e
  Produto §100); em 2026-09-19 o PO decidiu Pedido e entregas, OC, rascunho de OC pelo Pedido, Plano, OP do saldo,
  reserva de PA e preço de faturamento, com o provisório "todos menos VIEWER" onde a Veridi não definiu o perfil final
  ([AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](../discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md)); a execução da Produção
  tem discovery próprio (PRODUCTION-PERMISSION-HARDENING-01, perfil final com a Veridi);
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção — Cloudflare R2 aprovado pelo PO em 2026-09-16 e **ativo em PROD
  desde 2026-09-17** para o arquivo do Item Rótulo (§103; STORAGE-R2-ACTIVATION-01, [`DEPLOY.md`](../DEPLOY.md) §6.1).
  PROD usa o bucket de homologação (`veridi-homologacao`): bucket próprio é decisão do PO. Levar os anexos genéricos é
  ATTACHMENTS-R2-MIGRATION-01 (seção G).

## C. #11 — material do cliente (linhas 510–521 do BACKLOG em `8cf83861`)

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

## C. Itens fechados, reconciliados e registros condensados (linhas 541–613 do BACKLOG em `8cf83861`)

### ~~FORMULATION-LOSS-SCOPE-01~~ — a cápsula vazia entra na perda prevista — FECHADO em 2026-09-15

Decisão do PO (2026-09-15): **entra**. A perda prevista é perda do PROCESSO para
alcançar a quantidade líquida vendável, então recebe o fator quem é consumido
proporcionalmente à quantidade BRUTA que entra no processo — matérias-primas,
ingredientes e a cápsula vazia. A embalagem comercial (pote, tampa, rótulo,
cartucho, caixa de embarque, dosador) continua na quantidade vendável.

A auditoria confirmou o que o registro anterior suspeitava: nenhum atributo do
domínio separava "embalagem consumida na produção" de "embalagem comercial" —
`packagingSubtype` enumera pote, tampa, rótulo, cartucho, caixa e dosador mas
não tem valor para a cápsula, e a base do componente descreve a aritmética da
linha, não a incidência da perda. A menor mudança que diferencia o
comportamento foi uma marca explícita do cadastro, `Item.consumedInProduction`
(booleano, `false` por default, migration aditiva `20260925093030`), lida pela
regra canônica `componenteSegueQuantidadeProduzida` em `@veridi/shared`.

Regra durável em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §52; onde ela é
protegida em [`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md).

**Follow-up de cadastro, não de código:** os itens de cápsula vazia já
cadastrados nascem `false`, que é o comportamento anterior. Marcá-los é gesto de
quem cadastra, no formulário do Item — nenhum backfill por nome ou código foi
feito, e nenhum será: uma regra de custo decidida por `nome.includes("CAPS")` é
invisível para quem confere o custo.

### ~~FORMULATION-TEMPLATE-WORKBENCH-01~~ — a bancada no Modelo de Formulação — FECHADO em 2026-09-16

As decisões D-1 a D-11 do PO e as três fatias estão em
[`archive/BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md) (seção A); as regras duráveis, em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §96–§97. O que ficou fora: a Ficha Técnica do Modelo
(FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01, fechada em 2026-09-16; linha 2b da fila, hoje no histórico) e a tabela Forma ×
Apresentação, logo abaixo.

### FORMULATION-PRESENTATION-BY-FORM-01 — a tabela Forma × Apresentação — aguardando a Veridi

Também de 2026-09-15. O domínio não tinha nenhuma regra de compatibilidade entre
`DosageForm` e `PresentationType`, e o dado real só usa `POT` nas duas formas. A
tela passou a oferecer as apresentações coerentes com a forma, com a primeira
versão declarada da tabela em `APRESENTACOES_POR_FORMA` (`packages/shared`):
cápsula oferece tudo; pó oferece tudo menos **Frasco**. A apresentação já
gravada numa versão continua na lista mesmo fora da tabela, e nenhuma migration
destrutiva foi feita. Confirmar ou corrigir a tabela é decisão do PO.

### PRODUCTION-LOT-PURITY-RECONCILIATION-01 — pureza da Formulação × pureza do lote — futuro

Registrado na homologação de FORMULATION-WORKBENCH-01 (2026-09-15), **fora do P0
atual**. A Formulação congela a pureza usada na versão; a Produção escolhe o lote
real, que tem a sua. Quando as duas diferirem, o objetivo futuro é avisar o
operador e exigir uma decisão controlada — nunca recalcular a necessidade em
silêncio, nem deixar passar sem registro.

Também fica para auditar nessa rodada: se a pureza nominal por fornecedor deve
morar no relacionamento Fornecedor ↔ Item, em vez de só no Item. Nada a decidir
nem a implementar agora.

### ~~CUSTOMER-CNPJ-AUTOFILL-01~~ — consulta de CNPJ no cadastro do Cliente — RECONCILIADO em 2026-09-17

**Aprovado pela Veridi e entregue como CUSTOMER-CNPJ-LOOKUP-01** (linha 9r da fila, hoje no histórico; regra em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §111). Este registro fica como histórico da decisão, não como item aberto — e
não deve ser reaberto como capability separada.

O que mudou em relação ao registrado em 2026-09-16: o provedor de estreia é o **OpenCNPJ** (base pública, sem token),
e o **Serpro passa a ser provedor futuro** — a arquitetura nasceu com registro de provedores justamente para que ele
entre como um segundo adaptador, sem reescrever tela, endpoint nem contrato. O nome também mudou de propósito:
"autofill" descrevia atualização automática, e a decisão do PO é o contrário — **assistência ao preenchimento**, com o
usuário escolhendo campo a campo e salvando por conta própria.

As duas frases que este item mandava rever foram revistas: [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §83 passou a dizer
que a consulta existe e que ela **não** define o perfil tributário, e a ajuda do Cliente ganhou o conceito
"Consultar CNPJ". Quem consulta é quem edita o cadastro (§98).

**Continua sem decisão:** ligar o SERPRO — exige credencial, contrato e decisão do PO, e nada disso foi feito.

## D. Manutenção técnica (linhas 617–658 do BACKLOG em `8cf83861`)

## D. Manutenção técnica

### 10. Compactar `archive/DELIVERY_HISTORY.md` — LOW

≈5.326 linhas de diário por entrega — contradiz o objetivo do Baseline v2 de
reduzir contexto histórico vivo. Consolidar para ≈200–400 linhas com só data,
capability, release/commit importante, decisão durável e breaking change
relevante. O Git guarda o detalhe. Não misturar com capability de negócio.

### 12. `validate-migrations-fresh.mjs` ainda chama o Prisma por shell — LOW

`execFileSync("pnpm", […], { shell: true })` imprime o `DeprecationWarning
DEP0190` do Node a cada execução, num comando rodado antes de todo merge com
migration. Sem impacto funcional e sem risco real (os argumentos são
constantes). `scripts/prisma-bin.mjs`, criado no MIG-ORDER-01b, já resolve o
binário do Prisma sem shell — a correção é trocar a chamada por ele. Ficou
fora daquela capability de propósito, para não aumentar escopo.

### 16. CALENDAR-LEGACY-COLUMNS-CLEANUP-01 — colunas de jornada única — LOW

PLANNING-CALENDAR-WEEKLY-SCHEDULE-01 (2026-09-12) passou a jornada para
`production_calendar_weekdays` e deixou em `production_calendars` as colunas
da jornada única — `startMinuteOfDay`, `endMinuteOfDay`, `breakMinutes`,
`breakStartMinuteOfDay`, `breakEndMinuteOfDay` e `monday`…`sunday` —, com os
CHECKs delas. Nenhum código as lê; ficaram só para a migration não precisar
remover coluna junto com o backfill. Limpeza: migration que remova colunas e
CHECKs, depois de a jornada semanal estar em produção e o backup lógico
conferido. Sem impacto funcional até lá — o risco é alguém ler a coluna velha
achando que ela é a jornada.

### 17. FK-ORDER-DOCUMENTED-CYCLE-01 — `fk-order.mjs` acusa o ciclo que a limpeza atravessa — LOW

O diagnóstico somente leitura `scripts/maintenance/fk-order.mjs` trata o ciclo
da contagem física (`stock_count_positions.validEntryId` NO ACTION ×
`stock_count_entries.positionId` CASCADE, desde a migration
`20260925093026`) como anel sem saída: imprime "CICLO DE FK" e sai com código 1
contra qualquer banco migrado (conferido em 2026-09-17 no banco de teste).
`prod-cleanup.mjs` atravessa esse ciclo pelo CASCADE listado em
`CASCADES_EM_CICLO_DOCUMENTADAS` (PROD-CLEANUP-MODEL-CLASSIFICATION-01), e a
ordem dele é a que vale. Correção: o diagnóstico reusar `calcularOrdem()` de
`prod-cleanup-models.mjs`, em vez de manter um segundo cálculo. Sem impacto na
limpeza — o risco é quem roda o diagnóstico ler o código 1 como bloqueio.

## E. Watchlist e itens #15, #14 e #13 (linhas 662–753 do BACKLOG em `8cf83861`)

## E. Watchlist — observado, sem ação conhecida

Não é backlog operacional. Cada item é verdadeiro hoje e não tem trabalho
definido. Se algum voltar com sintoma novo, aí vira item da seção A.

**W2 saiu (2026-09-08).** Voltou com sintoma novo — 8 falhas em 10 `pnpm test` —,
foi medido, teve causa (a suíte da API e a da web disputando a CPU no runner
oficial) e correção. Está em
[`PROJECT_STATE.md`](PROJECT_STATE_HISTORY.md), "O runner oficial não disputa a máquina
consigo mesmo". **W1 continua sem ocorrência**: `ERR_IPC_CHANNEL_CLOSED` não
apareceu em nenhuma das 40 execuções completas dessa medição.

| # | O quê | Por que não é backlog |
|---|---|---|
| **W1** | `pnpm test` — `ERR_IPC_CHANNEL_CLOSED` ocasional no encerramento dos workers do vitest | Nenhuma asserção falha, sem reprodução recente. **Decisão de PO:** não investigar preventivamente. Se reaparecer, capturar versão do Node, worker/processo, ordem de shutdown, árvore de processos, frequência e stack completa **antes** de mexer no runner |
| **W3** | 24 das 56 linhas de `_prisma_migrations` em produção com checksum diferente do arquivo | Line ending, e só. `.gitattributes` fixa LF no SQL das migrations para novos clones. Nada foi reescrito no ledger |
| **W4** | Linha órfã `20260904093000_template_component_quantity_mode` em produção | Tolerada por decisão de 2026-09-04 ([`TECH_BASELINE.md`](../TECH_BASELINE.md)). Reescrever `_prisma_migrations` à mão é pior que a linha |
| **W5** | Dois diretórios de migration com o mesmo timestamp `20260904090000` (`_component_quantity_mode` e `_gmp_production_execution`) | A ordenação é pelo nome completo do diretório, então continua determinística e igual em todo ambiente. Sem impacto observado; renomear diretório aplicado é que quebraria o ledger. Um empate **novo** não nasce mais: `proximoPrefixoLivre` pula prefixo ocupado, e `migration-prefix.test.ts` reprova qualquer duplicata além desta |
| **W7** | Quantidade ainda passa por `Number` em pontos de **exibição** das telas de OP e Pedido: teste de sinal (`> 0`, `<= 0`) em `badge`/`disabled`, a diferença `onHand - reserved - available` renderizada (`ProductionOrderPage.tsx:1157`) e o total somado na tela (`CustomerOrderPage.tsx:2178`). O Pedido também imprimia `reservedRemaining` e `stillToReserve` crus — esses, a diferença renderizada da OP e as somas do Faturamento do Pedido saíram em PTBR-NUMERIC-DISPLAY-AUDIT-01 (`formatQuantity` e `Decimal`); ficam os testes de sinal | Classificado no FIX-01b e deliberadamente **não corrigido**: nenhum alcança payload nem validação. Teste de sinal sobre valor ≥ 10⁻¹² é seguro em `double`; o que é defeito de verdade — soma e diferença exibidas em ponto flutuante, e valor cru na tela — é da mesma família de F-07-1 e pertence ao PREC-UI, não a um remendo pontual |
| **W6** | Decisão de domínio pendente: trocar `RESTRICT` por `SET NULL` em alguma das 27 FKs opcionais | Não acontece mais por omissão no modelo (#14). Cada troca é decisão de domínio própria — bloquear a exclusão, desassociar ou arquivar — e exige a migration que a faça no banco |
| **W8** | Tetos de 100 que SELECTOR-CUTOFF-WAVE-02 revalidou e manteve por não serem corte de escolha: dica de homologação da OC (`PurchaseOrderPage.tsx:380`, relações do fornecedor — acima de 100 a dica some da linha, mas fornecedor e item seguem com busca e a OC não depende dela), relações do cadastro de Item/Fornecedor (`SupplierItemsSection.tsx:29`, tabela só leitura; a lista completa, com filtro, é Compras → Item × Fornecedor), amostras da ficha do Projeto (`ProjectDetailPage.tsx:114`, as 100 mais recentes), usuários (`UsersPage.tsx:41`, listagem, fora da fase — Auth). FO-03 saiu em FO03-PENDING-CUTOFF-01 (2026-09-13): a folha lê todas as páginas de `onlyPending` até o total | Medido no dev: até 59 relações por fornecedor e 9 por item, 1 amostra por projeto; 685 usuários, quase todos resíduo de teste (TEST-USERS-LEGACY-RESIDUE-01, que saiu com a recriação do `veridi_dev` em 2026-09-14). Os de recurso industrial (Modelo de Estrutura de Custo, Roteiro, `porId` do Planejamento) eram seletor e fecharam na wave. Vira item da seção A quando algum passar do teto |
| **W9** | `pages/print/operational-sheets.test.tsx`: os dois primeiros testes do FO-02 caíram por `waitFor` de 1 s em `abrirFolha` (a folha ainda em "Gerando PDF…") numa execução fria de 19 arquivos em paralelo (FO03-PENDING-CUTOFF-01); o arquivo sozinho e duas reexecuções do mesmo gate passaram | FO-02 intocado na rodada e sem falha de conteúdo: é o primeiro `import()` do documento sob CPU disputada. Se voltar no `pnpm test`, o remédio é o prazo do `waitFor` de `abrirFolha`, não o código da folha |
| **W10** | `pages/periodo-invertido-listas.test.tsx`, caso "'Recebimentos': a resposta atrasada não aparece; voltar ao período consulta uma vez": caiu uma vez na suíte web completa de CUSTOMER-EDIT-PERMISSIONS-01 (2026-09-16, 3.657 testes) com `Unable to find an element with the text: Carregando…` — o estado de carregamento é transitório e já tinha passado | Sozinho passou 3 de 3, e nenhum módulo da rodada está no caminho da tela de Recebimentos. Não caiu na suíte completa seguinte (WEB-SUITE-PREEXISTING-FAILURES-01, 2026-09-16: 3.657 testes, 0 falhas). Se voltar, o remédio é o teste esperar o carregamento sem depender de ver o instante dele |
| **W11** | Prazo de 5 s do Vitest estourado sob carga na suíte web completa (MASTER-DATA-EDIT-PERMISSIONS-01, 2026-09-16, 3.796 testes, duas execuções com 5 quedas cada, só `Test timed out in 5000ms`): `lib/dates-formatador.test.ts` nas duas; `components/campo-numerico-guarda.test.ts` e `pages/listas-sem-consulta-solta.test.ts` (guardas que varrem o código-fonte) na primeira; `pages/print/base-calculada-impressos.test.tsx` na segunda, que rodou em paralelo com a suíte web completa de outra sessão | Sem asserção falhando, conjunto diferente a cada execução, nenhum dos arquivos no caminho da rodada, e os quatro passam sozinhos (20/20 em 9,3 s). Se virar rotina, o remédio é prazo próprio nesses arquivos (o formatador percorre todos os fusos; as guardas leem a árvore inteira), não reexecutar até passar |
| **W12** | `modules/inventory/stock-count-telas-2b.test.ts`, caso "conjunto diferente recusa sem gravar nada; o mesmo conjunto encerra e o INV- aparece nos movimentos": caiu uma vez num conjunto focado de 19 arquivos da API em paralelo (INVENTORY-INACTIVE-ITEM-VISIBILITY-01, 2026-09-17) com `expected 'stock_count_close_blocked' to be 'stock_count_changed'` — o encerramento foi recusado por posição antes de conferir os ajustes mostrados | Sozinho passou 5 de 5 e a repetição do mesmo conjunto passou inteira (1.597 testes); a rodada não tocou o Inventário Físico em sessão. A asserção não mostra as `issues` da recusa: se voltar, capturar o corpo antes de mexer. **Causa provável achada em 2026-09-19** (INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01): um teste novo com a mesma forma — recebimento gravado e sessão iniciada logo em seguida — capturou o corpo, `CONCURRENT_MOVEMENT_UNCONFIRMED`: o recebimento criado ANTES do início virou "movimentação durante o inventário". No Windows o `new Date()` do Node (a `referenceAt`) anda 1–3 ms atrás do relógio do sistema — o Postgres ficou à frente em 2.000 de 2.000 leituras —, e o `createdAt` do movimento sai do motor do Prisma. Correção de teste sugerida, não aplicada: gravar os recebimentos de ANTES da sessão com `createdAt` recuado (o `movimentar` do arquivo serve também a movimentos de depois do início, então não é troca de uma linha). O mesmo efeito derrubava o teste do estorno "contagem DEPOIS do registro do CI" (2 em 6 na base), corrigido nessa rodada |

---

### 15. `Decimal.toString()` pode sair em notação exponencial — LOW

Os DTOs serializam quantidade e dinheiro por `toString()`, e o decimal.js
devolve notação exponencial abaixo de `1e-7`: uma quantidade de
`0.000000000001` viaja como `"1e-12"`. A tela e o `parseDecimalInput`
receberiam um texto que não é o formato esperado.

**Não observado em dado real**: a menor escala do domínio é doze casas, e
nenhuma quantidade de operação chega perto do limiar. É defeito de fronteira,
não de uso.

Onde se corrige, quando valer: a serialização, num lugar só — `toFixed` na
escala da categoria (§58), nunca `toString`. Encontrado em COM-04, fora do
escopo dele e do COM-04b.

### 14. PLAN-DATE-01 — planejamento temporal pelas entregas programadas — LOW

COM-04 entregou a promessa; ela ainda não influencia o planejamento. Hoje o
cronograma é informativo: o Plano de Atendimento continua cobrindo o Pedido
inteiro de uma vez, e a Sugestão de Compra não sabe que 1.000 saem em outubro e
1.000 em dezembro.

O que se pode ganhar, quando o PO autorizar:

- **Sugestão de Compra com data** — comprar para a primeira entrega antes de
  comprar para a terceira;
- **Necessidade de produção legível no tempo** — o que precisa estar pronto até
  quando;
- **Sugestão de divisão temporal de OP** — sugestão, nunca divisão automática.

**Restrição durável:** nada disso pode criar um segundo motor de reserva. A
reserva continua sendo do Plano de Atendimento (§75). Sem decisão do PO, não
implementar.

**Dependência temporal:** a parte que passar a CONTAR dias úteis — lead time,
data necessária, necessidade de compra a partir da promessa — precisa de
OPS-CALENDAR-01 (B · #9) antes. As demais partes não ficam bloqueadas por isso.

### 13. Ajuda contextual — o que a Fase 1 deixou aberto — LOW

UX-HELP-02 entregou o modelo V2, os sete conceitos compartilhados e os 12
tópicos P0. **Nenhum destes itens bloqueia nada** — a ajuda funciona por
inteiro nos dois modelos —, e o próximo passo é decisão do PO, não sequência
automática:

- **UX-HELP-03** — painel lateral com abas, botão "?" fixo e rota
  `/ajuda/conceitos/:slug`. O conteúdo V2 migra sem reescrita;
- **39 tópicos ainda no modelo V1** — migram por tela, no ritmo de quem revisa
  a regra daquela tela;
- **Tópicos que servem a várias telas** — Recebimentos (quatro), Lotes (três) e
  a lista de Precificação continuam com um tópico só. O §45 já permite dividir;
- **Rótulos de tela na terminologia aprovada** (PO-5, PO-4) — "Situação",
  "Separação", "Modelo", "Em espera", "Lote comercial". É mudança de interface,
  fora da capability de ajuda; até lá a ajuda cita o rótulo real de hoje.

Divergências ainda vivas entre rótulo e terminologia alvo: "Status" nas listas
de expedição, faturamento, projeto e formulação; "Lote Veridi" onde a
terminologia alvo diz "lote comercial"; "Picking" no caminho
`/producao/picking`.

**Achado de responsivo, fora de escopo e anterior a esta rodada:** a casca do
ERP transborda 67px de rolagem horizontal a 390px de largura (`masthead` e
`workspace` com largura mínima maior que a tela). Não vem da ajuda — o painel
não piora a medida — e pertence ao endurecimento responsivo.

## G. Discovery — registros integrais (linhas 757–1176 do BACKLOG em `8cf83861`)

## G. Discovery — descobrir antes de construir

Nenhum destes tem escopo definido. O trabalho de cada um é **responder uma
pergunta**; desenhar solução antes da resposta é o que produz módulo que ninguém
usa.

Com posição na fila viva desde 2026-09-19: INTERNAL-CONSUMPTION-COST-CENTER-01 (decidido) e
DASHBOARD-INTERNAL-CONSUMPTION-01, os dois P2. O Inventário Físico foi decidido e segue em fatias (a Fatia 3 espera o
handoff). Os outros esperam a pergunta virar decisão. SUPPLIER-ADDRESS-01, que tinha posição, foi entregue em
2026-09-11 (merge b8d744b).

### SUPPLIER-OFFER-OVERLAP-01 — vigências sobrepostas de oferta E de tarifa industrial

Finding do COST-SOURCE-01 (2026-09-09), registrado sem decisão.

Hoje duas ofertas do MESMO fornecedor podem ter vigências que se sobrepõem:
criar uma oferta nova **não encerra** a anterior. O motor resolve de forma
determinística e testada — `effectiveAt` mais recente, desempate por
`createdAt` — então não há ambiguidade no cálculo.

O problema é de leitura: as duas aparecem como **"Serve de referência"** na tela
da relação, sem dizer qual efetivamente vence. Quem corrige um preço digitado
errado no mesmo mês vê dois números válidos e nenhuma pista de qual está no CMV.

Quatro caminhos, nenhum escolhido: (A) permitir e só explicar qual vence;
(B) ao criar vigência nova, encerrar a anterior automaticamente; (C) permitir e
alertar; (D) permitir sobreposição deliberada como recurso de negócio.

**O escopo desta decisão cresceu em 2026-09-09, e isso é bom.** Quando
INDUSTRIAL-RATE-VALIDITY-01 fechou a borda de dia civil, a auditoria confirmou
que `IndustrialResourceRate` tem EXATAMENTE o mesmo desenho: o banco permite
duas vigências abertas (nenhuma constraint), o service permite (nenhuma
validação), o desempate é determinístico (`effectiveAt` mais recente, depois
`createdAt`) e o histórico da tela marca **as duas** como "Vigente" sem dizer
qual vence. **PROD já tem 1 recurso industrial nesse estado**, além das ofertas.

A decisão é uma só, para os dois lados do custo — oferta de fornecedor e tarifa
de recurso industrial. Responder diferente nos dois seria inventar duas regras
para a mesma pergunta, e o estado atual dos dois está travado em teste para que
a mudança seja deliberada (`rate-validity-api.test.ts`,
`scripts/e2e/vigencia-de-tarifa-industrial.mjs`).

**Contexto que NÃO é tarefa:** as 602 ofertas `LEGACY_IMPORT` do corpus não
têm `effectiveAt` nem `preferred`, e isso é **dado do usuário** — DEV e PROD
não as têm desde o reset de 2026-09-11, e elas voltam, do mesmo jeito, se a
carga do corpus for refeita. Não existe item para "corrigir as 602": informar
vigência sem definir preferencial rebaixaria 90 itens para
`AMBIGUOUS_SUPPLIER_REFERENCE` (auditoria COST-VAR-01, G4). Nenhum backfill,
nem em DEV nem em PROD.

### COM-CONTRACT-01 — registro leve de contrato comercial — P2

Vindo do walkthrough real (2026-09-09). **P2 · discovery: não precede bug nem
quick win**, e não entra na fila viva acima.

Não existe nada de contrato no modelo hoje — a busca por `contract`/`contrato` em
`schema.prisma` e em `packages/shared` não devolve nada. O que existe e NÃO é
isto: `ControlledDocumentRevision` (documento controlado da Qualidade) e
`Attachment` (anexo genérico).

**A decisão já tomada é negativa, e é a mais importante:** contrato **não dirige**
a situação comercial do Cliente. Cliente pode ser ativo sem contrato cadastrado,
e um Prospect pode eventualmente ter documento preliminar se o domínio futuro
permitir. Amarrar os dois faria a situação comercial depender de alguém anexar um
PDF.

Escopo a AUDITAR quando a rodada acontecer — lista de partida, não modelo
aprovado: número/referência, `Customer`, `Project` de origem opcional, data
inicial, validade, encerramento, situação, observação e anexo/documento.

**Preferir derivar a situação do contrato por DATAS** — Vigente, Encerrado,
Vencido — em vez de um status manual redundante, pelo mesmo motivo de
CUSTOMER-COMMERCIAL-STATUS-01 e de §71: "vencida" já é estado derivado na
proposta, e nada varre o banco à meia-noite. Não decidido nesta rodada.

**Não confundir com o que já existe.** As cinco coisas são separadas e a
separação é a regra:

| Conceito | O que é |
|---|---|
| `Customer` | a empresa e o relacionamento |
| `Project` | a oportunidade / o desenvolvimento |
| `QuoteVersion` | a proposta |
| `CustomerOrder` | o compromisso operacional de compra |
| Contrato | a evidência jurídico-comercial do acordo, **quando existir** |

**Não criar módulo grande antecipadamente.** Um contrato com ciclo de aprovação,
alçada e versionamento é outra capability; o que a reunião pediu foi registro.

### SUPPLIER-MODE-01 — "Fornecedor — Virtual / Físico"

Vindo do walkthrough real (2026-09-09). **Não criar enum.**

A expressão apareceu na reunião sem definição, e as leituras possíveis levam a
modelos incompatíveis: classifica o FORNECEDOR (uma distribuidora sem estoque
próprio?), o ESTABELECIMENTO/endereço (loja física × operação online), o CANAL
DE COMPRA (portal × presencial), ou é outra coisa que o termo do dia a dia
esconde? Cada resposta muda onde o campo mora — `Supplier`, o endereço de
SUPPLIER-ADDRESS-01, ou a `SupplierItem`.

Descobrir o que a Veridi decide com essa informação. Um enum criado antes da
resposta ficaria preenchido e inútil.

### ASSET-01 — "Cadastro de Ativos"

Vindo do walkthrough real (2026-09-09). **Não criar módulo.**

Auditar primeiro o que já existe: `IndustrialResource` (com tipo
`LABOR`/`EQUIPMENT`/`ENERGY`, potência em kW e tarifas versionadas),
`IndustrialResourceRate` e o uso planejado por estrutura de custo.

A pergunta é qual dos quatro significados está em jogo: ativo IMOBILIZADO
(patrimônio, depreciação, valor contábil — que o ROADMAP lista como futuro),
MÁQUINA no sentido de equipamento produtivo (já é `IndustrialResource`
`EQUIPMENT`), RECURSO industrial (idem), ou apenas a flag **Ativo/Inativo** de um
cadastro qualquer — que é o falso amigo mais provável em português, e que já
existe em todo cadastro.

Se for imobilizado com depreciação, é capability de custeio e encosta em
CMV-TAX/landed cost. Se for qualquer um dos outros três, provavelmente não há
trabalho.

### INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01 — redesenho do Inventário Físico

Registrado em 2026-09-15, só em documento. **Status: PO BASELINE / INTENÇÃO
APROVADA — não é especificação técnica final.** Diferente dos outros itens desta
seção, os objetivos já foram aprovados pelo PO: o discovery responde o que está
aberto e desenha a solução, e pode mudar detalhe, mas não pode perder objetivo
aprovado. O discovery completo (INVENTORY-PHYSICAL-COUNT-DISCOVERY-01) está `DECIDIDO` desde 2026-09-15
([documento](../discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md)); a implementação é INVENTORY-PHYSICAL-COUNT-01, em
fatias — 1, 2A e 2B entregues em 2026-09-15 e 2026-09-16; a Fatia 3 espera o handoff.

**Ponto de partida.** O Inventário Físico de hoje (`StockCountPage`) conta UMA
posição por vez — item, lote quando o item controla lote, contagem e motivo — e,
havendo diferença, cria o ajuste rastreável sem sair da tela. A FO-01 (folha de
contagem física) já tem modo cego (`?cega=1`, sem a coluna de saldo), mas não há
sessão a que ela se vincule. As regras duráveis de
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §16 continuam valendo; nada aqui as altera.

#### PO BASELINE — objetivos aprovados

**Módulo.** O Inventário Físico deixa de ser somente o formulário 1-a-1 e evolui
para **sessões de inventário em lote**. A função atual fica, como **Contagem
rápida** ou equivalente.

**Entrada.** Lista de inventários: em andamento; concluídos; progresso;
divergências; ações para retomar. Ações principais: **Novo inventário**,
**Contagem rápida** e **Folha de contagem**.

**Novo inventário.** Montador de escopo, com os filtros desejados:

- **Tipo:** matéria-prima; embalagem; produto acabado; todos.
- **Saldo:** somente com saldo; com ou sem saldo.
- **Última contagem:** nunca contado; sem contagem há X dias; período.
- **Movimentação:** movimentado nos últimos X dias; sem movimentação há X dias;
  recebido recentemente; consumido em produção recentemente; expedido
  recentemente; ajustado recentemente.
- **Lote:** ativos; aguardando liberação; bloqueados; vencidos; próximos do
  vencimento; lote específico.
- **Histórico:** com divergência anterior.
- **Propriedade:** Veridi; material de cliente; cliente específico.
- **Seleção:** manual.

Antes de iniciar, mostrar a quantidade de itens e a quantidade de lotes/posições.

**Unidade operacional.** Item sem controle de lote: posição por item. Item com
controle de lote: posição por item + lote. Localização física fica para o
discovery.

**Tela de contagem.** Preferência: grade operacional, com as colunas conceituais
Código, Item, Lote, Unidade, Contagem e Situação. A contagem assistida pode
mostrar saldo e diferença. **A contagem cega não mostra saldo nem diferença
durante a primeira contagem.**

**Busca / autocomplete.** Campo "Item, código ou lote", que encontra por código
do sistema, nome, trecho do nome e código do lote. Ao escolher item com lote,
sugere os lotes daquele item. A UX deve ser compatível com scanner no futuro, e
o Enter deve favorecer a contagem sequencial rápida.

**Adição durante a contagem.** Avaliar "Adicionar item ou lote" para o que o
operador encontra fora do escopo inicial, com registro de auditoria. **Nunca
inventar lote inexistente silenciosamente.**

**Progresso.** Algo como "51 / 91 posições · 56%". Permitir interromper e
retomar.

**Divergências e recontagem.** Fluxo: contar → revelar divergências → recontar →
revisar → confirmar ajustes. A recontagem das posições divergentes é suportada.

**Estoque — regra do PO.** O inventário **nunca sobrescreve saldo
diretamente**. Ao finalizar, gera movimentos/ajustes rastreáveis ligados à
sessão de inventário.

**FO-01.** A folha de contagem é vinculada à sessão. Em inventário cego, **não
imprime o saldo do sistema**. Conteúdo conceitual: identificador; código; item;
lote; unidade; campo para contagem; data/responsável.

**CSV.** Exportar o CSV da sessão. Importar CSV **preenche contagens e nunca
ajusta estoque**. Fluxo: upload → validação → preview → erros/avisos →
confirmação. Protege contra: arquivo de outro inventário; item inexistente; lote
inexistente; item e lote incompatíveis; duplicidade; quantidade inválida; linha
fora do escopo; inventário encerrado. Compatível com o uso brasileiro: UTF-8,
separador `;` e decimal pt-BR. Avaliar também o modelo simples
`codigo_item;lote;contagem` — o discovery decide se entra na primeira versão.

**Histórico / auditoria.** Preservar quem criou, quem contou, quem recontou,
quem aprovou, data/hora, valores, divergências e movimentos gerados.

**Modelagem aberta ao cíclico.** A modelagem deve permitir evoluir para
sugestões automáticas: nunca contado; sem contagem há X dias; movimentação
recente; alto giro; divergência recorrente; próximo do vencimento. As sugestões
em si são FUTURO.

#### DISCOVERY REQUIRED — nada decidido aqui

**HIGH / DISCOVERY REQUIRED — concorrência / cut-off.** Saldo 10 no início; a
produção consome 2; o operador conta 8. O sistema **não pode** interpretar isso
automaticamente como divergência de -2. O discovery precisa comparar: bloqueio
de movimentação; snapshot; reconciliação dos movimentos; saldo no momento da
contagem; outra solução.

Também abertas: tolerância; segundo operador; multiusuário; localização física
futura; lote físico inexistente no ERP; lote do ERP não encontrado fisicamente;
autosave; permissões de contar versus aprovar; política de cancelamento;
imutabilidade após o fechamento. E as duas que a baseline já deixou ao
discovery: se "Adicionar item ou lote" entra, e se o modelo simples de CSV entra
na primeira versão.

#### FUTURO — não promover sem decisão do PO

Inventário cíclico com sugestões automáticas, scanner dedicado, localizações e
regras avançadas não entram no escopo por padrão, nem porque o discovery tocou no
assunto: promover exige decisão explícita do PO. Os três primeiros já estão em
[`ROADMAP_POST_MVP.md`](../ROADMAP_POST_MVP.md), seção Armazém / WMS (Contagem
cíclica agendada, Coletores industriais, Endereçamento avançado).

### CUSTOMER-MASTER-DATA-AUDIT-01 — histórico do cadastro do Cliente — P2 · FUTURO

Registrado pelo PO em 2026-09-16 (CUSTOMER-EDIT-PERMISSIONS-01), **sem posição e sem implementação**. O cadastro do
Cliente guarda só quem criou, quem alterou por último e quando (`createdBy*`, `updatedBy*`, `updatedAt`): uma troca de
CNPJ, de razão social ou de perfil tributário não deixa rastro do valor anterior. A situação cadastral já tem histórico
append-only (§95); o cadastro, não. A pergunta a responder: vale um histórico append-only de antes/depois para os
campos estruturais (CNPJ, razão social, perfil tributário e outros), para quais campos, quem lê, e como convive com os
snapshots que os documentos já congelam. Exigiria migration. Quem pode alterar já está decidido (§98).

### MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01 — Onda 2: consolidar os grupos aprovados — P1 · SANEADO NO DEV, FORA DE PROD

**Executada no `veridi_dev` em 2026-09-17** (§118; seção própria do `PROJECT_STATE.md`): 8/8 grupos, 11 Itens
removidos, 7 canônicos com `declaredNutrient` consolidado, duas relações com fornecedor consolidadas; PROD e Railway
intocados. Pendente: a mesma onda em PROD, com conferência READ ONLY, PLAN em PROD, backup restaurável e aprovação do PO
antes — o código do ERP sai de sequence por banco, e a decisão confere o código da planilha dos dois lados. **Antes de
PROD, também a V4 com a Veridi** (o que `*`/`**` significam no nutriente): no G5, "Clorogênico" = "Clorogênico**" é
equivalência declarada só para o DEV, na integração de 2026-09-17 — não regra geral de asterisco —, e a resposta pode
mudar a decisão do grupo. O texto abaixo é o registro da aprovação.

Aprovado pelo PO em 2026-09-17, na integração de MASTER-DATA-DUPLICATE-SANITIZATION-01 (§114). São nove
consolidações, em duas naturezas:

| Grupo | Registros | Natureza |
|---|---|---|
| Arabinogalactana | MP-000115 · MP-000322 | mesmo material, nutrientes diferentes |
| Beta-glucana de levedura | MP-000118 · MP-000304 | idem |
| Concentrado de tomate | MP-000165 · MP-000324 · MP-000347 · MP-000349 | idem (quatro linhas) |
| Fosfato de magnésio dibásico | MP-000204 · MP-000285 | idem |
| Fosfato de cálcio monobásico | MP-000269 · MP-000283 | idem |
| Fosfato de cálcio tribásico | MP-000270 · MP-000284 | idem |
| Membrana de casca de ovo | MP-000312 · MP-000317 · MP-000319 | idem (três linhas) |
| Sachê de sílica gel 5 g | ME-000021 · ME-000089 | **par nomeado**: difere por acento, e o PO declarou duplicado verdadeiro |

**O que a ferramenta ainda não fazia** — e passou a fazer nesta capability (§118):

1. **Escrever o campo consolidado no canônico.** A regra do PO para `declaredNutrient` é juntar os valores ÚNICOS na
   forma "A · B · C", sem repetir termo. Hoje o saneamento só move referência e remove — nunca altera o canônico —, e é
   justamente por divergir em `declaredNutrient` que estes sete grupos saem BLOQUEADOS. Precisa de uma consolidação
   declarada por coluna, com o valor final no PLAN antes de gravar.
2. **Aceitar par nomeado fora da regra automática.** A sílica não vira grupo: a regra preserva acento, de propósito. O
   par entra por decisão versionada, como o arquivo da §110 — e **sem** tornar a regra geral accent-insensitive.
3. **Reavaliar as colisões de índice único** nos grupos que têm relação com fornecedor (o `supplier_items` parcial de
   preferencial hoje bloqueia por não ser calculável).

Fora desta onda, por decisão do PO: MP-000149/475, MP-000325/348, MP-000320/468, MP-000014/022 e MP-000393/486
continuam em revisão (podem ser materiais diferentes), e o Modelo "X" (FT-000001 × FT-000002) segue bloqueado até se
saber conteúdo, versões, referências, se algum é descartável e o impacto da colisão de `versionNumber`. **Decididos na
Onda 3** (seção abaixo, §124).

### MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01 — Onda 3: fundir, renomear, excluir o sem uso — P1 · SANEADO NO DEV, FORA DE PROD

**Executada no `veridi_dev` em 2026-09-17** (§124; seção própria do `PROJECT_STATE.md`), depois da revisão READ ONLY
MASTER-DATA-DUPLICATE-REVIEW-03: G4 maçã fundido em MP-000475 ("Açúcar de maçã · Carboidrato"); G7 oliva e G13 guaraná
renomeados para nome técnico distinto (MP-000320 "… — Verbascosídeo", MP-000468 "… — Hidroxitirosol", MP-000393
"Extrato de guaraná 22%"; MP-000486 mantém o nome); Modelos "X" FT-000001 e FT-000002 excluídos com a V1 DRAFT de cada
um. Restam 2 grupos em revisão. PROD e Railway intocados.

Pendente:

- **A Veridi responde** (a resposta não se infere): o que `*` e `**` significam no nutriente (G6 e G11, a V4); o teor
  real de ácido clorogênico do MP-000325 e do MP-000348; se as cotações FLORIEN R$160/kg (1 kg) e R$650/kg (100 g) são a
  mesma especificação; e por que o código legado 349 aparece com 8%, 45% e 50% nas fórmulas antigas. Com a resposta, o
  PO decide a ação de G6 e G11 numa onda seguinte.
- **A mesma onda em PROD**, como a Onda 2: conferência READ ONLY, PLAN em PROD (o código do ERP sai de sequence por banco
  e os Modelos "X" são dado do DEV — o que houver em PROD é outro registro), backup restaurável e aprovação do PO.
- ~~**A carga não reproduz renomeação nem consolidação**~~ — **FECHADO em 2026-09-18 por ITEM-IMPORT-WAVE-3-CONSISTENCY-01**
  (na `main`, fora de PROD, sem migration): com o pacote, a carga grava o `declaredNutrient` consolidado nos canônicos das
  Ondas 2 e 3 e o nome técnico do MP-000320, MP-000468 e MP-000393, conferidos contra o pacote, e o VERIFY acusa base
  que não reflete a decisão. O rebuild num banco descartável chegou aos mesmos 798 Itens do DEV saneado, campo a campo,
  com os mesmos 2 grupos repetidos (G6, G11); reexecutar não recria absorvido nem desfaz renomeação.
- O `family` "OTHER_RAW_MATERIAL" que só o MP-000149 tinha saiu com ele (a decisão só consolidou o nutriente; o canônico
  segue sem família).

### MASTER-DATA-NAME-UNIQUENESS-01 — índice único de nome no banco — P1 · DEPOIS DO SANEAMENTO

Registrado em 2026-09-17 por MASTER-DATA-DUPLICATE-SANITIZATION-01 (§114), **sem implementação e de propósito sem
migration naquela rodada** — a janela de Uso e Consumo estava criando a dela, e duas migrations concorrentes se
atropelam.

O guarda da API já recusa nome repetido sem caixa nos nove cadastros, e **não substitui a constraint**: entre o SELECT
e o INSERT há uma janela em que duas requisições simultâneas passam as duas. Fechá-la é criar, no banco, o índice único
funcional `CREATE UNIQUE INDEX … ON <tabela> (upper(btrim(<coluna>)))` — a MESMA expressão do guarda e da ferramenta de
saneamento, para que os três nunca discordem.

O que precisa acontecer **antes**, e é o motivo de esta capability não ter data:

1. **o saneamento tem de fechar.** O índice não nasce por cima de duplicata existente: o `CREATE UNIQUE INDEX` falha e a
   migration não aplica. Depois da Onda 3 (§124), o `veridi_dev` tem 2 grupos, ambos em revisão com a Veridi (G6 café
   verde e G11 fosfato de piridoxal) — cada um é decisão de produto, e a ferramenta recusa escolher sozinha. A carga já
   reproduz fusão, consolidação e renomeação das ondas (ITEM-IMPORT-WAVE-3-CONSISTENCY-01): o rebuild pelo pacote chega
   aos mesmos 2 grupos do DEV, então o índice quebraria o rebuild só por G6 e G11 — o esperado até a Veridi responder;
2. **PROD tem de ser medido**, em conferência READ ONLY: o estado do DEV não prova o de PROD, e os códigos do ERP saem
   de sequence por banco;
3. **o escopo do Item já está decidido**: o PO fixou em 2026-09-17 que os quatro tipos (RAW_MATERIAL, PACKAGING,
   FINISHED_PRODUCT e INTERNAL_CONSUMABLE) dividem **um único** espaço de nomes, então o índice é um só sobre
   `items` — não um por tipo.

Quando as três estiverem resolvidas, a migration é uma só, com um índice por cadastro, e o guarda da API continua —
mensagem amigável é da aplicação, não do banco.

**Edição do cadastro legado** (MASTER-DATA-DUPLICATE-GUARD-LEGACY-EDIT-01, 2026-09-18, §114): enquanto o índice não
existe, o guarda impede duplicidade NOVA e deixa editar o cadastro que já nasceu duplicado quando o nome efetivo não
muda — PROD tinha 21 grupos / 45 Itens no preflight de 2026-09-18, e cada Salvar deles dava 409. Isso não muda o índice
nem o que vem antes dele: continua bloqueado pelos grupos não resolvidos — G6 e G11 no DEV e, em PROD, o que as ondas
ainda não sanearam lá.

### MASTER-DATA-STRUCTURAL-LOCKS-01 — travas estruturais do cadastro mestre — sem posição

Registrado em 2026-09-16 por MASTER-DATA-EDIT-PERMISSIONS-01 (DE11 do PO), **sem implementação**. Hoje a única trava
de campo estrutural é `Item.operationallyUsed` (OC, recebimento, lote ou movimento travam tipo, unidade, lote e
validade). Ficaram de fora, sem trava nenhuma: Item usado em Formulação ou Modelo (mudar tipo ou unidade reescreve o
significado das linhas), item de produto acabado ligado a Produto, e `PATCH /products/:id`, que religa ou desliga o PA
do Produto sem conferir lote, OP ou Pedido. A pergunta: quais vínculos travam quais campos, e se a recusa é por campo
(como `structural_field_locked`) ou por ato. Quem pode editar já está decidido (§100).

### MASTER-DATA-STATUS-HISTORY-01 — motivo e histórico de Inativar/Reativar — P2 · FUTURO

Registrado em 2026-09-16 por MASTER-DATA-EDIT-PERMISSIONS-01 (DE5 do PO), **sem posição e sem implementação**. Item,
Fornecedor e Produto inativam e reativam sem motivo e sem histórico: só `active` e `updatedAt` mudam. O Cliente já tem
motivo obrigatório e histórico append-only (§95). A pergunta: motivo obrigatório nos três, histórico com autor e data,
e se a reativação do Item continua mais estreita (Qualidade e Administrador) quando houver motivo registrado. Exigiria
migration. Quem inativa e reativa, e o 409 da transição repetida, já estão decididos (§100).

### SUPPLIER-ITEMS-UX-01 — Fornecedor → Itens administrável no cadastro do Fornecedor — sem posição

Fatia 2 do [ITEM-SUPPLIER-UX-DISCOVERY-01](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md), adiada pela D4 do PO
(2026-09-16), **sem posição e sem implementação**. Hoje a seção Itens fornecidos do Fornecedor só lista, com o caminho
para Compras › Item × Fornecedor. A Fatia 1 fechou em ITEM-SUPPLIER-UX-01 (§102): `FornecedoresDoItemSection`,
`SupplierItemFormModal` com `itemFixo` e `preferencial.tsx` são o ponto de partida — com o Fornecedor fixo, o seletor
passa a ser o de Item. Sem migration. Para decidir junto: levar à tela geral a confirmação da troca de preferencial que o
cadastro do Item já pede (hoje o "Marcar como preferencial" do detalhe na tela geral troca direto, D2; a E2E
`oferta-de-fornecedor-vira-custo` passa por ele).

### ATTACHMENTS-R2-MIGRATION-01 — anexos genéricos no adaptador de storage — P2 · FUTURO

Registrado em 2026-09-16 por LABEL-ATTACHMENTS-01, **sem posição**. `Attachment` (lote, recebimento, produto, projeto,
amostra) segue em `lib/file-storage.ts`, no volume: 10 MB, extensão × MIME sem assinatura, download lido inteiro em
memória. A pergunta: vale levar esses anexos ao `StorageAdapter` (provedor por linha, streaming, assinatura) e ao R2, e
como mover os arquivos que já estão no volume sem perder nenhum — cópia verificada por hash antes de trocar o provedor
de cada linha. Exigiria migration (provedor por anexo).

### LABEL-FILE-SUBTYPE-CHANGE-01 — Item Rótulo com versões que troca de subtipo — LOW · sem posição

Visto em 2026-09-16 por LABEL-ATTACHMENTS-01. `packagingSubtype` não é campo estrutural: um Item Rótulo com arquivo
pode virar Pote pela edição. As versões ficam no banco e no storage, mas a seção some da tela e não aceita versão nova
(409 `item_not_label`); voltar o subtipo para Rótulo devolve o histórico intacto. Nada se perde, mas o histórico fica
fora de vista. A pergunta, de cadastro mestre (vizinha de MASTER-DATA-STRUCTURAL-LOCKS-01): travar a troca de subtipo
quando houver versão, ou mostrar o histórico em consulta mesmo fora do subtipo.

### ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 — consulta assistida nos demais seletores — sem posição

Registrado em 2026-09-17 por ASSISTED-ENTITY-SELECTOR-FOUNDATION-01, **sem implementação**. A fundação está na `main`:
`SearchableEntitySelect` com `onConsult` opt-in, `EntityConsultationDialog` e o piloto `ItemConsultationDialog` na
bancada (padrão em [`UI_BRAND.md`](../UI_BRAND.md)). A pergunta, depois de validar o piloto com a Veridi: quais seletores
ganham a consulta, e em que ordem — Cliente, Fornecedor, Produto, Lote, o Item da Ordem de Compra e do Item × Fornecedor.
Cada um reusa o diálogo com as colunas e o recorte do próprio campo. Pontos já sabidos: (1) campo que aceita mais de um
tipo de Item (linha da OC: matéria-prima e embalagem) precisa de filtro aditivo na API (`types=`) — juntar páginas de
dois tipos no navegador quebra paginação e contagem; (2) seletor que mora dentro de modal (Item × Fornecedor) abre a
consulta como mais uma camada, e o Escape já fecha uma de cada vez (`modal-stacking`); (3) nova escolha é só de
ativo: campo cujo recorte traga inativo mostra a linha desabilitada, com o motivo, nunca selecionável.

Atualizado em 2026-09-17 por ASSISTED-ENTITY-MULTISELECT-01: a consulta também opera em seleção múltipla (até 10) na
ação de seção, com colunas por entidade (`detail`/`status`) — Formulação, Modelo e recursos do Modelo de Estrutura de
Custo. Candidatos à múltipla no rollout: (4) a etapa do Roteiro de Produção ("+ Adicionar recurso", mão de obra E
equipamento ativos) — mesmo problema do item (1), pede `types=` em `GET /industrial-resources`; (5) a Estrutura de Custos
grava cada uso de recurso pela API com o uso obrigatório, então lote ali é outra conversa (criar vários usos de uma vez).

### COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01 — linha de recurso sem uso por lote no Modelo de Estrutura — LOW, sem posição

Visto em 2026-09-17 por ASSISTED-ENTITY-MULTISELECT-01, **sem mudança**. No rascunho do Modelo de Estrutura de Custo,
"Salvar rascunho" envia só as linhas com recurso E uso por lote (`CostTemplateDetailPage`, filtro antes de
`resourceUsages`): a linha com recurso e uso em branco não vai, e a tela a mantém com "Alterações não salvas", sem dizer
qual linha falta. Era assim com "+ Adicionar recurso"; com "+ Adicionar recursos" (até 10 linhas de uma vez, uso em
branco para preencher) fica mais fácil cair nisso. A pergunta: recusar o salvar apontando a linha (como a bancada da
Formulação faz com a quantidade), ou avisar quais linhas ficaram de fora.

### DASHBOARD-INTERNAL-CONSUMPTION-01 — o Painel não representa Uso e consumo — P2 · FILA VIVA

**Posição na fila viva desde 2026-09-19** (linha 19, P2); falta a decisão do card, abaixo. Registrado em 2026-09-18 por
INTERNAL-CONSUMPTION-REVERSAL-01, **fora da fatia** por decisão do PO (achado L1 do discovery). O Painel conta movimentos por tipo (`applyMovementCount`) sem caso para `INTERNAL_CONSUMPTION` nem
`INTERNAL_CONSUMPTION_REVERSAL`: os dois não entram em card nenhum nem na atividade por dia, e na lista de
movimentações recentes aparecem com o rótulo do tipo e sem documento de origem. Decidir se o consumo interno ganha
card próprio (líquido dos estornos, como o R-21) ou entra num card existente.


## G. INTERNAL-CONSUMPTION-COST-CENTER-01 — a decisão e o registro de quando era pergunta (linhas 1177–1192 do BACKLOG em `8cf83861`)

### INTERNAL-CONSUMPTION-COST-CENTER-01 — Centro de Custo do consumo interno — P2 · DECIDIDO

**Decidido pelo PO em 2026-09-19**
([INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01](../discovery/INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01.md)); fila
viva, linha 18, abaixo dos P0/P1. Centro de Custo é cadastro próprio, obrigatório em CI novo; criar, editar e inativar só
ADMIN, e todo autenticado consulta; o destino livre sai do CI novo (`purpose` fica como legado de leitura) e
"Observação/finalidade" segue livre; CI antigo sem backfill, mostrado "Sem centro de custo" com o destino antigo; sem
seed; cadastro em Cadastros e Configurações › Centros de custo. Migration aditiva. O texto abaixo é o registro de quando
era pergunta.

Registrado em 2026-09-17 por INTERNAL-CONSUMPTION-01, **explicitamente fora da fatia** por decisão do PO. Hoje o
destino/uso é texto livre e opcional ("Escritório", "Limpeza", "Expedição"). Texto livre agrupa mal: "Escritorio",
"escritório" e "ADM" viram três destinos no relatório. Desde INTERNAL-CONSUMPTION-REPORT-01 (§117) a falta está à
vista: o R-21 filtra e agrupa o destino pelo texto EXATO gravado, e as três grafias saem como três linhas no resumo
por destino. É o momento natural de decidir entre um cadastro de Centro de Custo e uma lista fechada de destinos.
Migrar depois é possível: o texto gravado vira o ponto de partida do mapeamento.

## F. Roadmap — texto integral (linhas 1203–1261 do BACKLOG em `8cf83861`)

## F. Roadmap — fora do backlog

Escopo futuro não fica aqui. Vive em
[`ROADMAP_POST_MVP.md`](../ROADMAP_POST_MVP.md):

- **Preferências de exibição de precisão** (PREC-UI-01 a 08) — desenho em
  [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §11, invariantes
  duráveis em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §57. **Atenção ao
  implementar:** PREC-UI-05 e PREC-UI-06 já são o comportamento atual e
  precisam ser preservados, não reconstruídos;
- **Produto próprio Veridi** — `Product` sem cliente obrigatório, estoque
  próprio de Produto Acabado, venda do mesmo PA a vários clientes.
  `Product.customerId` permanece obrigatório no escopo atual.

**Tributos, frete e demais custos de aquisição permanecem BRAINSTORM**, e o
brainstorm já existe — não se abre item novo para ele. O escopo discutido
(tributo recuperável × não recuperável, percentual × fixo, base de incidência,
vigência, frete e transporte, e em que momento o encargo entra: aquisição,
produção ou venda) está coberto por duas fontes que já estão escritas:

- `ROADMAP_POST_MVP.md`, **Landed cost** — "rateio de frete, impostos e demais
  custos de aquisição" — e a seção "Custeio / CMV — o que ainda falta";
- [`archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md`](COST-VAR-01_AUDITORIA_VARIACAO_CMV.md)
  §21, que mapeia os **pontos de extensão possíveis** com o efeito de cada um no
  CMV: oferta, linha de OC, `ReceiptLine.actualUnitCost`, `ReceiptLine` com
  colunas separadas, documento fiscal, `ItemCostReference` e linha manual da
  estrutura.

A direção registrada ali é `ReceiptLine` — o campo se chama *custo efetivo de
aquisição* por causa disso —, e a escolha entre "somar dentro de
`actualUnitCost`" e "colunas separadas" é rodada própria. Nada a decidir aqui, e
nada a implementar.

**RAW-MATERIAL-EXTERNAL-ENRICHMENT — enriquecimento externo da Matéria-prima —
DESCARTADO pelo PO em 2026-09-17.** O cadastro de Matéria-prima não é enriquecido
por fonte externa, e nem o Open Food Facts nem a ANVISA são integrados a ele. Não
se abre item de backlog nem discovery para isso. A decisão saiu do POC
ADHOC-RAW-MATERIAL-ENRICHMENT-POC-01: somente leitura, fora do repositório e já
removido, testou as duas fontes gratuitas contra cinco matérias-primas reais do
cadastro. Nenhuma delas traz o que a ficha da matéria-prima precisa — pureza, forma
química, CoA, fornecedor, especificação técnica —, porque esse dado vem do
fornecedor, não de base pública:

- **Open Food Facts** é base de produto de prateleira. A busca de texto livre
  devolveu potes de marca e, mais de uma vez, a substância errada (ácido cítrico
  para ácido ascórbico, L-glutamina para L-triptofano). Só a taxonomia de
  ingredientes e aditivos identificou a substância — nome traduzido, número E,
  Wikidata —, o que é referência, não cadastro. Serve a Produto Acabado e a dado
  de varejo.
- **ANVISA — Dados Abertos** (`DADOS_ABERTOS_ALIMENTO.csv`) registra produto, não
  insumo: dez colunas regulatórias (empresa, produto, processo, categoria,
  registro, vencimento, situação) e nenhum match de alta confiança nas cinco
  matérias-primas. "Creatina Monohidratada" aparece com esse nome exato em vários
  registros ativos, todos *Suplementos alimentares* de marca. Serve a dado
  regulatório de Produto.

O aproveitamento dessas fontes no cadastro de **Produto** ficou registrado como
discovery futuro em [`ROADMAP_POST_MVP.md`](../ROADMAP_POST_MVP.md) ("Dados externos
do Produto"), fora da fila viva e sem compromisso.

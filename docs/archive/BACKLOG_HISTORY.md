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
faltava era dado real, não código ([`PROJECT_STATE.md`](../PROJECT_STATE.md),
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
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §95; estado em [`PROJECT_STATE.md`](../PROJECT_STATE.md); proteção em
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
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §96–§97; estado em [`PROJECT_STATE.md`](../PROJECT_STATE.md); proteção em
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
| ~~F-11-1~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): o `EntityLink` de cadastro em lista com modal leva `voltar`, e o aviso de lista reduzida oferece "← Voltar para …"; link de menu e de documento sem mudança | — | — |
| ~~PROJECT-RELOAD-ERROR-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): só o 404 (`NotFoundApiError`) vira "Projeto não encontrado"; rede ou 500 mantém a ficha carregada com alerta de recarga e "Tentar novamente", e a leitura boa limpa o alerta — `web projects/projeto-recarga-com-erro.test.tsx` | — | — |
| ~~FORM-ERROR-VISIBILITY-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01: no Pedido e na OC, erro de ação traz o alerta único do topo à vista e dá foco a ele (em 390px ficava a −331/−387 px de quem clicou); com o diálogo de cancelamento aberto, o erro aparece dentro dele — `web customer-orders/pedido-confirmar-grava-antes.test.tsx`, `web purchase-orders/oc-confirmar-grava-antes.test.tsx` | — | — |
| ~~API-INT-COERCION-01~~ | **Fechado em 2026-09-13** por INPUT-DATE-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): inteiro de escrita é lido como decimal inteiro canônico (`lib/integer-schema.ts`) em `projects.schemas.ts`, `lib/industrial-schema.ts` e no `dosesPerPackage` do Modelo (que usava `z.coerce.number()`); `"1e2"`, `"0x1E"`, `"+1"`, `"1.0"`, `"Infinity"` e `true` são 400; faixa, opcional e nulo intocados. A caracterização em `projeto-inteiros-api.test.ts` passou a esperar 400 | — | — |
| ~~QUOTE-PERCENT-FIELDS-01~~ | **Fechado em 2026-09-13** por PTBR-NUMERIC-INPUT-ROLLOUT-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): os três percentuais das condições são `PercentField`, o erro tem `id` e `aria-describedby` no campo, e à vista entrada e juros escondidos não travam "Salvar condições" nem vão à API (`paraEnvio` só lê o percentual em vigor) — `web projects/condicoes-percentuais.test.tsx` | — | — |
| ~~FORMULATION-DOSES-INPUT-01~~ | **Fechado em 2026-09-13** por PTBR-NUMERIC-INPUT-ROLLOUT-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): "Doses por embalagem" é `IntegerField`, e prévia, validação e envio usam a leitura estrita de inteiro — `1e2` não entra, colar `1.234` dá 1234, vazio vai `null`, o inteiro segue como texto como antes; API-INT-COERCION-01 continua valendo para outros clientes da API | — | — |
| ~~PTBR-NUMERIC-INPUT-ROLLOUT-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`UI_BRAND.md`](../UI_BRAND.md), "Campos numéricos e valores pt-BR"): 85 inputs crus em 37 telas e componentes viraram `IntegerField`/`DecimalField`/`MoneyField`/`PercentField` com o `scale` da coluna (`web lib/numeric-scales.ts`), carga por `toPtBrEditText`, borda por `parsePtBrNumber`, pendência pelo valor e payload canônico; os três `type="number"` saíram; `parseDecimalInput`/`AJUDA_DECIMAL` aposentados; guarda estrutural virou proibição com allowlist justificada (CEP). QUOTE-PERCENT-FIELDS-01 e FORMULATION-DOSES-INPUT-01 fechados junto | — | — |
| ~~PTBR-NUMERIC-DISPLAY-AUDIT-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`UI_BRAND.md`](../UI_BRAND.md), "Campos numéricos e valores pt-BR"): `formatQuantity` agrupa milhar como o campo fora do foco (o round-trip do teto tira os pontos antes de ler); ficha e lista do recurso industrial, Estrutura de Custos, templates de custo, consumo extra, Pedido (Plano de Atendimento, colunas de reserva, expedido, somas do Faturamento por `Decimal`), Orçamento fora de edição, ofertas de fornecedor, relatórios, explicação da Formulação, contagens das listas e PDFs formatados; CSV da API mantido (vírgula decimal sem milhar, contrato de planilha); guarda `web components/leitura-numerica-guarda.test.ts` | — | — |
| ~~ORDER-LINE-390-OVERLAP-01~~ | **Fechado em 2026-09-14** por SMALL-MOBILE-UX-WAVE-03 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): com linhas editáveis, abaixo de 640px a linha do Pedido empilha em grade — Produto na largura toda, Quantidade/unidade/remover embaixo; tocar a Quantidade foca o campo e não abre Produto (smoke 390 com toque real); desktop igual — `web customer-orders/produto-do-cliente-do-pedido.test.tsx` | — | — |
| ~~TEMPLATE-ROW-DROP-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): linha com item sem quantidade ou quantidade sem item prende "Salvar rascunho", com a mensagem na linha, `aria-invalid`/`aria-describedby` e foco no campo que falta; só a linha em branco fica fora do payload — `web formulation-templates/modelo-linha-incompleta.test.tsx` | — | — |
| ~~LISTS-LOADING-STALE-DATA-02~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): as 16 listas restantes com `useListQuery`/`useFilteredPage`/`ListStatusRow`; `useScopedList` sobre a mesma consulta, com a página do cliente e sem vazio junto da falha; Quadro de Produção com a resposta da chave atual; Calendário de Produção sem o defeito (chave fixa, uma carga por montagem), mantido; guarda estrutural contra total em `useState` e página de volta à 1 por efeito | — | — |
| ~~LISTS-ERROR-FALSE-EMPTY-ADMIN-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): Usuários e Documentos controlados mostram a falha sem a frase de vazio | — | — |
| ~~LISTS-EMPTY-ROW-390-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): a frase de vazio com ação das listagens (`ListStatusRow`) fica na largura visível do contêiner em 390px | — | — |
| ~~LISTS-EMPTY-ROW-390-RAW-01~~ | **Fechado em 2026-09-14** por SMALL-MOBILE-UX-WAVE-03 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): as 49 linhas de vazio escritas à mão passaram por `TableEmptyRow`, o mesmo corpo com a largura visível do `ListStatusRow`; guarda contra `table__empty` fora dele — `web components/linha-de-vazio-escrita-a-mao.test.ts` | — | — |
| ~~CONSULTATION-CUSTOMER-SWITCH-QUERY-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): trocar de cliente pela mesma rota consulta a aba uma vez, depois do resumo do cliente novo | — | — |
| ~~LISTS-FILTER-INPUT-UX-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): o filtro de período das listagens consulta 300 ms depois da digitação ou no Enter, sem data pela metade nem ano curto; período invertido não consulta | — | — |
| ~~SAVE-FEEDBACK-REMAINING-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): Faturamento, OC, Expedição e Recebimento confirmam só com a resposta, com o rótulo da ação em curso; a OP salva só com pendência | — | — |
| ~~SAVE-ENABLED-NO-DIRTY-01~~ | **Fechado em 2026-09-13** por SAVE-FLOW-HARDENING-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): Pedido e OC salvam só com a pendência da guarda, inclusive no documento novo — não é a exceção da Formulação | — | — |
| ~~BILLING-SHIPMENT-UNSAVED-GUARD-01~~ | **Fechado em 2026-09-13** por SAVE-FLOW-HARDENING-01: Faturamento e Expedição registram a guarda, com faixa e botão de salvar lendo a mesma pendência | — | — |
| ~~SAVE-THEN-COMMIT-STALE-01~~ | **Fechado em 2026-09-13** por SAVE-FLOW-HARDENING-01: emitir, confirmar e conferir releem a resposta da gravação antes da segunda chamada | — | — |
| ~~CONFIRM-DISCARDS-DIRTY-01~~ | **Fechado em 2026-09-13** por CONFIRM-DISCARDS-DIRTY-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): decisão do PO, gravar antes de agir — com a pendência da guarda, "Confirmar pedido" e "Confirmar OC" gravam pelo salvar da tela, esperam a resposta e só então confirmam; sem pendência, confirmam direto | — | — |
| ~~DASHBOARD-COST-BATCH-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): o Painel resolve o custo das 200 OPs concluídas em lote, com a mesma conta da função unitária — 2.650 → 58 SQL e 1,79 → 0,10 s na massa de 200 OPs, DTO idêntico | — | — |
| ~~TZ-FORMATTER-REUSE-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): `instanteComercial`, `minutoDoDiaComercial` e `limitesDoDiaComercial` reaproveitam o formatador por forma de leitura e fuso, como `diaCivil` — ~137 → ~13, ~65 → ~5 e ~268 → ~24 µs; `limitesDaJanelaDeCusto` ~615 → ~50–60 µs; 3,8 milhões de casos iguais à implementação anterior | — | — |
| ~~TZ-LOCALE-STRING-REUSE-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): extensos do shared, `dataCivilPorExtenso` nova (CSV, dia comercial, fonte de custo, Atenção, origem de preço, Orçamento) e `web lib/dates.ts` num formatador guardado — ~55 → ~1–3 µs por data, CSV de 10 mil linhas × 3 datas ~1,4 s → ~44 ms; texto idêntico em cinco fusos do processo, `"Invalid Date"` mantido | — | — |
| ~~ROUTE-CONTEXT-RESTORE-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): na volta do cadastro contextual, a carga inicial do roteiro não escreve por cima do rascunho restaurado — nome, descrição, base, unidade e etapas —, nem na segunda carga do StrictMode; a diferença para o gravado fica pendente até salvar | — | — |
| ~~ROUTE-IDENTIFICATION-SAVE-DRAFT-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): só "Salvar rascunho", ativar e criar versão trazem o rascunho do servidor por cima da tela, normalizado; depois de "Salvar identificação", "Definir padrão" e "Tirar padrão" a releitura mantém base, unidade e etapas pendentes no instante da resposta, e a pendência e a guarda continuam | — | — |
| ~~CONTEXT-ORIGIN-LABEL-ROUTE-01~~ | **Fechado em 2026-09-13** por LISTS-NAVIGATION-UX-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): o cadastro aberto pelo Roteiro diz "← Voltar para Roteiro de produção" | — | — |
| ~~ROUTE-DRAFT-SAVE-INFLIGHT-EDIT-01~~ | **Fechado em 2026-09-13** por EDITING-INTEGRITY-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): preservar, sem bloquear — a ação que grava o rascunho guarda a tela do clique; na releitura, tela que mudou desde então fica e segue pendente contra o gravado (500 salvo, 700 digitado no ar: fica 700), tela igual recebe o normalizado do servidor — `web planning/roteiro-de-producao.test.tsx` | — | — |
| ~~COST-USAGE-RESOURCE-BYID-01~~ | **Fechado em 2026-09-13** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): o campo "Recurso" da Estrutura de Custos usa `useRecursosDoSeletor` — criado no contexto e rascunho restaurado fora da página ganham nome pelo id, uma vez; o aviso de energia fora do modo direto confere o recurso resolvido (antes não disparava nunca); a busca tem o recorte da abertura; adicionar espera o tipo e leva `resourceCount` | — | — |
| ~~REPORTS-PRINT-UNACCEPTED-FILTER-01~~ | **Fechado em 2026-09-14** por PRINT-CORRECTNESS-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): cada definição de `REPORT_PRINT_DEFINITIONS` declara `filterKeys` (as chaves do schema da API) e `filterAppliesWhen` (R-02: `from`/`to` só na janela `CUSTOM`); chave de outro relatório, `foo=bar` e paginação não vão ao papel nem disparam consulta de nome; o CSV segue recebendo a URL como veio | — | — |
| ~~FO03-ROW-SITUATION-01~~ | **Fechado em 2026-09-14** por PRINT-CORRECTNESS-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): coluna Qualidade por `situacaoDoLote` (vencido manda, como FO-01/FO-02 e a tela CoA); Pendência pelo laudo com os rótulos da tela CoA — PENDING "Pendente de documento", RECEIVED "Aguardando análise", REJECTED "Laudo rejeitado"; recorte, paginação, ordem e `loadAllPages` intocados. Texto original: FO-03 descreve mal duas pendências do próprio recorte (`OperationalSheetsPdf.tsx`, `QualityPendingPdf`): a coluna Qualidade é `LOT_STATUS_LABELS[lotStatus]` e ignora `isExpired` — no smoke de FO03-PENDING-CUTOFF-01 a pendência com validade 31/01/2026 saiu "Aguardando liberação", enquanto Documentos / CoA diz "Vencido" e FO-01/FO-02 usam `situacaoDoLote`; e a Pendência do laudo rejeitado sai "Aguardando liberação" (o `else` de `pendenciaDoLote`, escrito quando a folha trazia todos os lotes), com o lote bloqueado. O primeiro é uma linha; o texto do segundo é decisão do PO. Anterior à rodada, que não mudou o documento | UX | XS |
| ~~PAGED-DOCUMENT-SNAPSHOT-01~~ | **Fechado em 2026-09-14** por REPORT-ROBUSTNESS-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): `GET /quality/coa-queue?all=true` devolve o recorte inteiro de uma leitura numa transação `RepeatableRead`, com teto de 1.000 lotes (acima: 400 `quality_queue_too_large`, nunca os primeiros N); a FO-03 faz um pedido só e `loadAllPages` saiu. Texto original: `loadAllPages` (`web lib/all-pages.ts`) lê por deslocamento: se entre uma requisição e a seguinte uma pendência sai da fila antes do deslocamento E outra entra depois dele, o total fica igual, nenhuma chave repete e um lote fica de fora sem aviso. Total mudando e chave repetida já lançam; a janela é o intervalo entre as páginas (~ms), só acima de 100 pendências. Fechar pede retrato no servidor (`all=true` com `ALL_ROWS` na fila da Qualidade, ou cursor) — contrato de API, fora de FO03-PENDING-CUTOFF-01 | LOW | S |
| ~~PRICING-PRINT-THOUSANDS-TEST-01~~ | **Fechado em 2026-09-14** por PRICING-MODEL-VIEW-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): o teste procura `1.000 un`, a quantidade pt-BR que o PDF já escrevia, e recusa `1000 un`; a formatação ficou. Texto original: `web pages/print/base-calculada-impressos.test.tsx` falhava na `main` desde PTBR-NUMERIC-DISPLAY-AUDIT-01 (3459833) procurando `startsWith("1000 un")` | — | — |
| ~~REPORTS-PRINT-FILTER-KEYS-DRIFT-01~~ | **Fechado em 2026-09-14** por REPORT-ROBUSTNESS-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): `REPORT_FILTER_CONTRACTS` (shared) guarda `csvPath` e `filterKeys` dos 18 relatórios impressos; a web os lê sem cópia e `api modules/exports/report-filter-contracts.test.ts` compara cada contrato com as chaves do schema da rota CSV. Texto original: `filterKeys` de `REPORT_PRINT_DEFINITIONS` (web) copia à mão as chaves dos schemas de `api modules/reports/reports.schemas.ts`; nenhum teste liga os dois. Filtro novo na API sem a chave na web some do papel (falha segura: o papel omite, nunca inventa). Fechar pede o contrato de chaves no shared ou guarda que leia os dois | — | — |
| ~~NAV-TEMPLATE-WORDING-01~~ | **Fechado em 2026-09-16** por FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §97): Modelos de Formulação e Modelos de Estrutura de Custo dizem "Novo modelo", "Usar modelo", "Nome do modelo", "Salvar como modelo" e "Criar modelo" — botões, rótulos, mensagens da API e ajuda; classes, tabelas, rotas e apelidos da busca de telas continuam `template` — `web formulation-templates/bordas-do-modelo.test.tsx` ("Nomenclatura"). Registro original (UX): "As telas se chamam Modelos de Formulação e Modelos de Estrutura de Custo, mas botões, campos e diálogos seguem dizendo template" | UX | — |
| ~~CUSTOMER-EDIT-PERMISSIONS-01~~ | **Fechado em 2026-09-16** por CUSTOMER-EDIT-PERMISSIONS-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §98; [discovery](../discovery/CUSTOMER-EDIT-PERMISSIONS-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: decisão do PO (opção A) — só ADMIN e COMMERCIAL criam e editam o cadastro (`CUSTOMER_EDIT_ROLES`), 403 na API antes do corpo e da existência, os demais perfis consultam no mesmo modal e não recebem "+ Novo cliente"; sem migration. Registrou CUSTOMER-MASTER-DATA-AUDIT-01 (P2, futuro, seção G) e CUSTOMER-CNPJ-AUTOFILL-01 (P1, aguardando a Veridi, seção C). Registro original (A e "Abertos fora da fila", 2026-09-16): "Quem cria e edita o cadastro do Cliente. Registrado a pedido do PO em 2026-09-16 (HOMOLOGATION-RELEASE-RAILWAY-01), AGUARDANDO DEFINIÇÃO DO PO. Hoje `POST /customers` e `PATCH /customers/:id` só exigem sessão — qualquer perfil cria e edita; CUSTOMER-STATUS-HARDENING-01 restringiu apenas a mudança de situação cadastral (ADMIN e COMMERCIAL, §95). Nada implementado" | — | — |
| ~~CUSTOMER-PAYMENT-DEFAULTS-01~~ | **Fechado em 2026-09-16** por CUSTOMER-PAYMENT-DEFAULTS-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §99; [discovery](../discovery/CUSTOMER-PAYMENT-DEFAULTS-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: forma e condição de pagamento padrão, opcionais, no Cliente; cópia para a primeira proposta real do projeto e nunca leitura viva; "Aplicar padrão do cliente" no rascunho; forma congelada no Pedido; vocabulário forma × condição × observações de pagamento; "Parcelado exige parcelas" no Cliente e no Orçamento (o defeito de parcelado sem parcelas sair à vista no PDF e no Pedido, achado pelo discovery, fechou junto); migration aditiva `20260925093032_customer_payment_defaults`, sem backfill | — | — |
| ~~WEB-SUITE-PREEXISTING-FAILURES-01~~ | **Fechado em 2026-09-16** por WEB-SUITE-PREEXISTING-FAILURES-01, na `main` e fora de PROD: suíte web completa com 3.657 testes e 0 falhas. (1) `web pages/post-e2e-integrity.test.tsx` era teste desatualizado, não valor errado: o "Disponível não reservado" do consumo extra (`ExtraConsumptionDialog`) mostrava o decimal cru da API até PTBR-NUMERIC-DISPLAY-AUDIT-01 (`8db34be`) e passou a ler por `formatQuantityWithUnit` — `3,666667 kg`, os mesmos dígitos de `3.666667`, como Reservado, Saldo reservado e o erro de teto da mesma tela. Voltar a leitura crua faz o teste antigo passar e `web components/leitura-numerica-guarda.test.ts` cair; o teste confere `3,666667 kg` ao lado do rótulo, e o produto ficou como estava. (2) `web pages/ux-acoes-onda-02.test.tsx` acusava defeito real de layout: a edição da linha de recurso da Estrutura de Custos (`8f6ded2`, COST-PRICING-CLARITY-WAVE-01, dois dias depois da guarda de `baf1c99`) pôs "Salvar recurso" e "Cancelar", sempre juntos, numa `.line-actions`; o contêiner virou `.form-actions`, com botões, handlers, `disabled` e ordem intactos e sem exceção nova em `EXCLUSIVAS_POR_ESTADO`. W10 não caiu na suíte e segue na watchlist. Texto original: "Duas falhas da suíte web completa na `main`, vistas em 2026-09-16 (3554 testes, 2 caem, iguais em `3159180` e `5b7c1a3`): `post-e2e-integrity.test.tsx` ("mostra o saldo livre antes de o operador pedir" procura `3.666667`, provável formato pt-BR depois do PTBR-NUMERIC-INPUT-ROLLOUT-01 — conferir se é teste desatualizado ou valor errado) e `ux-acoes-onda-02.test.tsx` (a guarda acusa `pages/industrial-costs/IndustrialCostPage.tsx:1155` com duas ações diretas numa `.line-actions`)" | — | — |
| ~~MASTER-DATA-EDIT-PERMISSIONS-01~~ | **Fechado em 2026-09-16** por MASTER-DATA-EDIT-PERMISSIONS-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §100; [discovery](../discovery/MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: DE1–DE12 do PO — Item com Compras, Qualidade, Produção e ADMIN (controles só Qualidade e ADMIN pela mudança de valor, "Consumido na produção" só Produção e ADMIN, custo de referência inicial só Comercial e ADMIN, inativar Compras/Qualidade/ADMIN, reativar Qualidade/ADMIN); Fornecedor com Compras e ADMIN; Produto com Comercial e ADMIN, inclusive a criação direta aprovada, e "Exige CoA" só para o PA que nasce junto; 403 antes do corpo e da existência (`exigirPerfil` em `lib/current-user.ts`); 409 de situação; consulta no mesmo modal; criação contextual e "Nova relação" por perfil; sem migration. Registrou ACQUISITION-COST-PERMISSION-01 (P1, seção A), ATTACHMENT-ACTIONS-BY-ROLE-01 (UX, seção A), MASTER-DATA-STRUCTURAL-LOCKS-01 e MASTER-DATA-STATUS-HISTORY-01 (seção G). O item não tinha registro aberto no BACKLOG: o discovery foi entregue só no chat | — | — |
| ~~ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01~~ | **Fechado em 2026-09-16** por ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §101; [discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md) `EM_ANALISE`, D3 decidida), na `main` e fora de PROD: `POST /supplier-items` aceitava `qualificationStatus` `APPROVED` ou `BLOCKED` de Compras, a decisão que a rota de homologação recusava com 403. Agora a relação que Compras cria nasce `PENDING`, e pedir outra situação é 403 com o motivo, antes de qualquer leitura e sem gravar relação, oferta, histórico nem troca de preferencial; homologar e bloquear, também na criação, são de Qualidade e ADMIN (`SUPPLIER_ITEM_QUALIFICATION_ROLES`); voltar para pendente segue com Compras, Qualidade e ADMIN; ADMIN mantém a criação com situação explícita; preferencial, oferta, histórico e motor de custo sem mudança; na tela de Compras, "Situação inicial: Pendente" sem seletor; sem migration. O discovery, entregue só no chat, foi persistido na mesma rodada; ITEM-SUPPLIER-UX-01 (Fatias 1 e 2) ficou na seção G. O item não tinha registro aberto no BACKLOG | — | — |
| ~~ITEM-SUPPLIER-UX-01~~ | **Fechado em 2026-09-16** por ITEM-SUPPLIER-UX-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §102; [discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: a seção Fornecedores do modal do Item era só leitura, e criar a relação, homologar e definir o preferencial exigiam sair para Compras › Item × Fornecedor. Com D1–D5 do PO, a seção lista as relações reais do item (preferencial primeiro, inativas à vista, marcas separadas de relação e fornecedor inativos, oferta de hoje) e administra: Compras e ADMIN adicionam fornecedor com o Item fixo (Compras cria `PENDING`) e definem o preferencial com confirmação que diz quem sai, pela rota atômica; Qualidade e ADMIN homologam e bloqueiam no detalhe aberto por cima do Item; os demais consultam; duplicidade leva à relação existente, também pelo 409. Tela geral mantida (D2); Fornecedor → Itens virou SUPPLIER-ITEMS-UX-01, na seção G (D4); lead time fora (D5). Corrigidos no caminho: Escape da confirmação fechava o modal de baixo, e em 390px a coluna de ações fixa cobria o nome do fornecedor. Sem migration e sem API nova | — | — |
| ~~LABEL-ATTACHMENTS-01~~ | **Fechado em 2026-09-16** por LABEL-ATTACHMENTS-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §103; [discovery](../discovery/LABEL-ATTACHMENTS-ARCHITECTURE-DISCOVERY-01.md) `IMPLEMENTADO`), na `main` e fora de PROD: arquivo versionado do Item Rótulo (tipo PACKAGING e subtipo LABEL, nunca pelo nome) em tabela própria `item_label_file_versions` (migration aditiva `20260925093033`); versões imutáveis com vigente derivada; PDF, PNG e JPEG até 25 MB por extensão, tipo declarado e assinatura; objeto gravado antes da versão, com compensação; anular com motivo sem apagar bytes; restaurar como versão nova com o objeto da origem; download autenticado em streaming; enviar e restaurar Compras, Qualidade, Comercial e ADMIN, anular Qualidade e ADMIN; seção "Arquivo do rótulo" no modal do Item. `StorageAdapter` com `LOCAL_FS` e Cloudflare R2 (`@aws-sdk/client-s3`), provedor gravado por versão, `pnpm storage:r2:smoke`. Railway não tocado; R2 pronto e desligado. O discovery, decidido no chat, foi persistido na mesma rodada. Registrou STORAGE-R2-ACTIVATION-01, ATTACHMENTS-R2-MIGRATION-01 e LABEL-FILE-SUBTYPE-CHANGE-01 (seção G). O item não tinha registro aberto no BACKLOG | — | — |
| ~~SUPPLIER-QUALITY-REJECTION-REASON-01~~ | **Fechado em 2026-09-16** por SUPPLIER-QUALITY-REJECTION-REASON-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §104; [discovery](../discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md)), na `main` e fora de PROD: a relação Item × Fornecedor podia ser bloqueada sem dizer por quê — a observação da decisão era opcional em qualquer situação. Agora `BLOCKED` exige motivo em texto livre (aparado, de 3 a 1000 caracteres, sem lista fechada) na rota de homologação e na criação já bloqueada: sem ele, 400 `validation_error` com a frase e o campo, sem gravar nada; o 403 por perfil segue antes, e nenhuma permissão mudou. O motivo reutiliza `note` do evento de homologação — sem migration e sem backfill; bloqueio antigo sem motivo continua válido e aparece como "Motivo não registrado". Homologar e voltar para pendente seguem sem motivo. Na tela, "Bloquear" abre "Bloquear fornecedor para este item" com o motivo obrigatório, no detalhe que a tela geral e o cadastro do Item compartilham, e a nova relação bloqueada pelo ADMIN pede o motivo. O item não tinha registro aberto no BACKLOG | — | — |
| ~~ACQUISITION-COST-PERMISSION-01~~ | **Fechado em 2026-09-16** por ACQUISITION-COST-PERMISSION-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §105), na `main` e fora de PROD: `PUT /receipt-lines/:id/acquisition-cost` gravava o custo efetivo de aquisição — fonte REAL do lote e das médias de 30 e 90 dias — para qualquer sessão, e o recebimento da OC aceitava o mesmo custo de qualquer perfil. Decisão do PO: Compras e ADMIN (`ACQUISITION_COST_ROLES`) nas duas portas. O PUT recusa os demais com 403 antes do corpo e da linha, sem gravar; o recebimento de outro perfil que traz custo é 403 antes do corpo e da OC, sem recebimento, lote nem movimento, e receber sem custo segue aberto a todos. `costUpdatedBy` passou a ser o usuário da sessão (era "Ambiente local"). Na tela, "Definir/Atualizar custo" no documento e o campo de custo com "Usar preço da OC" em "Receber OC" só para quem informa; os demais consultam o custo e leem a quem ele cabe. A conta de REAL, 30D e 90D não mudou; sem migration. Registro original (P1, seção A, DE12 de MASTER-DATA-EDIT-PERMISSIONS-01): "VIEWER define o custo real que a seleção automática (§53) usa antes de qualquer oferta ou referência" | — | — |
| ~~ASSISTED-ENTITY-SELECTOR-FOUNDATION-01~~ | **Fechado em 2026-09-17** por ASSISTED-ENTITY-SELECTOR-FOUNDATION-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; padrão em [`UI_BRAND.md`](../UI_BRAND.md), "Assisted consultation from a search field"), na `main` e fora de PROD: fundação de consulta assistida para seletores de entidade, sem substituir o autocomplete. `SearchableEntitySelect` com "Consultar" opt-in no topo da lista; `EntityConsultationDialog` por cima da tela com o recorte do campo, busca e paginação no servidor, linha recusada desabilitada com motivo e cartões em 390px; piloto `ItemConsultationDialog` na bancada (Formulação e Modelo, matéria-prima e embalagem), com "+ Novo item de estoque" pela criação no contexto de sempre e `?tipo=` da seção. Sem API alterada e sem migration. Registrou ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 (seção G). O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |
| ~~FORMULATION-COMPONENT-BASIS-AUTOMATION-01~~ | **Fechado em 2026-09-17** por FORMULATION-COMPONENT-BASIS-AUTOMATION-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §106), na `main` e fora de PROD: a base de cálculo da linha (`FIXED_BASIS`/`PER_DOSE`/`PER_FINISHED_UNIT`) deixou de ser escolha na bancada. Decisão do PO: ela é consequência da seção e do modo — composição por dose na receita por dose (modo `PER_DOSE`, cápsula ou pó), base fixa senão; embalagem por unidade acabada — e a coluna fica como snapshot técnico. `@veridi/shared` com a regra única (`receitaPorDose`, `baseDaSecao`, `baseDoComponente`); API deriva em toda gravação de rascunho da Formulação e do Modelo, realinha as linhas gravadas na troca de modo ou forma, deriva na cópia de versão, na nova versão do Modelo, ao aplicar e ao salvar como Modelo, e descarta `basis` do corpo; ativa, inativa e arquivada intactas. Bancada sem coluna nem seletor de Base, Fornecimento mantido, prévia pela base derivada, aviso e pendência para rascunho legado, base gravada explicada na ajuda do cálculo de versão fechada. DEV (carga de PROD) sem nenhuma das 1.330 linhas fora da regra. Sem migration. O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |
| ~~INVENTORY-INACTIVE-ITEM-VISIBILITY-01~~ | **Fechado em 2026-09-17** por INVENTORY-INACTIVE-ITEM-VISIBILITY-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §107), na `main` e fora de PROD: item inativo não some do estoque físico. Fatia 1 de MASTER-DATA-INACTIVE-VISIBILITY, decisões D1–D3 do PO ([discovery](../discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md), persistido na rodada): `GET /inventory` e o CSV sem o `active: true` fixo — inativo com posição (saldo, reservado ou em compra) aparece marcado, sem posição só com `includeInactiveWithoutPosition`, CSV com o mesmo recorte e "Item ativo"; `itemActive` no DTO; entrada manual de inativo recusada (400 `inactive_item`), saída, perda e Contagem rápida permitidas; Web com o filtro, as marcas, o ajuste sem entrada para inativo e a busca da Contagem rápida achando o inativo. Sem migration. O item não tinha registro aberto no BACKLOG: veio do discovery entregue no chat | — | — |
| ~~ASSISTED-ENTITY-MULTISELECT-01~~ | **Fechado em 2026-09-17** por ASSISTED-ENTITY-MULTISELECT-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; padrão em [`UI_BRAND.md`](../UI_BRAND.md), "Assisted consultation: single or multiple selection"), na `main` e fora de PROD: a consulta assistida opera em seleção única (campo da linha, intacta) ou múltipla, limitada a 10 e explícita (ação da seção). `EntityConsultationDialog` com `selectionMode`, marcação por `recordKey` que atravessa busca, página e recarga, teto dito no rodapé, uma confirmação (`onSelectMany`), presente travado com motivo e sem "+ Novo" na múltipla; papéis de coluna `detail`/`status` para o cartão de 390px. Pilotos: Formulação e Modelo ("+ Adicionar matérias-primas" / "+ Adicionar embalagens", uma linha por item por `linhasDosItensEscolhidos`, base derivada) e recursos do Modelo de Estrutura de Custo ("+ Adicionar recursos", `IndustrialResourceConsultationDialog`). Adendo: colunas por entidade — matéria-prima com fonte/função e pureza cadastrada, embalagem com subtipo, recurso com tipo, capacidade e unidade de uso. Sem API alterada e sem migration. Registrou COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01 (seção G). O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |
| ~~PRODUCT-INACTIVE-COMMERCIAL-GATE-01~~ | **Fechado em 2026-09-17** por PRODUCT-INACTIVE-COMMERCIAL-GATE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §108), na `main` e fora de PROD: Produto inativo não inicia compromisso novo. Fatia 2 de MASTER-DATA-INACTIVE-VISIBILITY, decisões D6–D7 do PO ([discovery](../discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md)): `lib/product-active-gate.ts` recusa com 400 `inactive_product` vincular ao Projeto, linha nova, envio e aceite de Orçamento, aprovação do Projeto, geração e confirmação de Pedido e Amostra nova; a liberação da OP planejada relê Produto e o PA congelado; PA existente e inativo recusa com 400 `inactive_finished_item` em vez de `missing_finished_item`, sem cascata Produto × PA. Rascunho abre marcado e edita, versão nova e duplicação copiam a linha, Pedido gerado e OP liberada seguem, nada é cancelado. Situação atual em `QuoteLineDTO`, `CustomerOrderLineDTO`, `ProductionOrderDTO` e no PA do `ProductDTO`; Web sem o inativo em escolha nova, com marcas, `ProductInactiveNotice` e o aviso de PA inativo no cadastro do Produto. Sem migration. O item estava em "Abertos fora da fila" desde o discovery | — | — |
| ~~ITEM-FORM-BY-TYPE-01~~ | **Fechado em 2026-09-17** por ITEM-FORM-BY-TYPE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria; regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §109), na `main` e fora de PROD: o cadastro do Item mostra só o que é do Tipo — matéria-prima com Classificação industrial, embalagem com Dados da embalagem, embalagem Rótulo com Arquivo do rótulo logo depois —, pela autoridade de `Item.type`, nunca da Família nem do nome. Trocar tipo ou subtipo na criação limpa o que ficou escondido, e o envio só leva os campos do tipo (na edição, o gravado escondido fica). O arquivo do Rótulo é opcional, fica na tela até o Item existir e sobe pela rota de LABEL-ATTACHMENTS-01 depois de criar; envio que falha não recria o Item — a tela diz que o item foi criado e abre a seção oficial dele para reenviar, com "Concluir" para o destino normal. `lib/arquivo-do-rotulo.ts` passa a servir às duas telas. Sem API, shared nem migration; `INTERNAL_CONSUMABLE` fora. O item não tinha registro aberto no BACKLOG: veio direto do handoff | — | — |

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| ~~WEB-DATE-DEFAULT-TZ-01~~ | **Fechado em 2026-09-13** por INPUT-DATE-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): as cinco telas que sobravam (CMV, impresso do CMV, referência do cálculo de custo, resumo de custo do Produto e referência manual de custo do Item) propõem `hojeComercial()`; a OC já tinha saído em PURCHASE-SUGGESTION-BUSINESS-DATE-01. Data explícita intocada | — | — |
| ~~API-PAGINATION-COERCION-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): as 28 consultas paginadas leem `page`/`pageSize` por `inteiroDeConsultaSchema` (`lib/integer-schema.ts`, sobre `inteiroDecimalSchema`); `1e1`, `0x10`, `12.5`, `12,5`, `+1`, `Infinity`, texto e acima de 2^53 são 400; padrão, mínimo e teto intocados; guarda estrutural em `modules/paginacao-da-consulta.test.ts` | — | — |
| ~~API-INT-COERCION-REMAINING-01~~ | **Fechado em 2026-09-14** por API-STRICT-SCALAR-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): `capacityQuantity`, minuto do dia e `numberOfParts` leem `inteiroDecimalSchema().pipe(...)`; `1e1`, `0x10`, `+1`, `1.0` e booleano são 400 sem gravar; faixa, nulo e mensagens intocados; guarda em `lib/escalar-estrito-guarda.test.ts` | — | — |
| ~~INVENTORY-EXPORT-ONLY-WITH-STOCK-01~~ | **Fechado em 2026-09-14** por API-STRICT-SCALAR-CONTRACT-WAVE-01 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): reproduzido pela rota (`onlyWithStock=false` exportava só com estoque); `booleanoDeConsultaSchema` lê só `"true"`/`"false"`, o resto é 400; tela sem mudança | — | — |
| ~~REPORTS-QUERY-BOOLEAN-PERMISSIVE-01~~ | **Fechado em 2026-09-14** por QUERY-BOOLEAN-STRICTNESS-WAVE-02 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): reproduzido pela rota (`all=abc`/`off`/`1` devolvia o relatório inteiro; o mesmo texto em `onlyWithBalance` escondia o item sem saldo, no JSON e no CSV); `onlyWithBalance`, `onlyShortage`, `includeCost` e `all` leem `booleanoDeConsultaSchema` com o padrão de antes, o resto é 400; nenhuma tela manda `1`/`0`, web intocada | — | — |
| ~~CUSTOMER-MATERIALS-ONLY-WITH-BALANCE-PERMISSIVE-01~~ | **Fechado em 2026-09-14** por QUERY-BOOLEAN-STRICTNESS-WAVE-02 ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): reproduzido pela rota (`onlyWithBalance=1` listava o lote zerado, na lista e no CSV); `booleanoDeConsultaSchema().default(false)` — ausente segue sem filtro, o resto é 400 | — | — |
| ~~QUERY-BOOLEAN-PERMISSIVE-REMAINING-01~~ | **Fechado em 2026-09-14** ([`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria): reproduzido pela rota (`onlyPending=1` mostrava a fila inteira; `onlyWithBalance=1` trazia o lote zerado; `active=1` listava só os inativos; `archived=1` listava os não arquivados nas três bibliotecas; `includeArchived=1` escondia o anexo arquivado); os sete leem `booleanoDeConsultaSchema` com o padrão de antes, o resto é 400; anexos ganham `listAttachmentsQuerySchema`, sem leitura crua de `request.query`; a guarda não tem mais lista de dívida, só `LEGADO_EXPLICITO` (`semRoteiro`, `activeOnly`); web intocada | — | — |
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
intocados; sem migration. Estado em [`PROJECT_STATE.md`](../PROJECT_STATE.md), seção própria.

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

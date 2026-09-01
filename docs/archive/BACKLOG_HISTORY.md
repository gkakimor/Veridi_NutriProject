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

## Fora deste arquivo

Dois LOW de nomenclatura levantados nesta auditoria — rótulos de ação
divergentes entre telas e diálogo de confirmação que repete o rótulo de quem o
abriu — continuam **abertos** e vivem em [BACKLOG.md](../BACKLOG.md).

A observação "compra permitida contra projeto não aprovado" não é finding: é
decisão de domínio deliberada, registrada em
[PRODUCT_RULES.md](../PRODUCT_RULES.md) §38.

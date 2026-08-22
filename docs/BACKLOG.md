# Veridi Nutrition — Post-MVP Backlog v0.4

This file contains **mapped future value**, not current implementation scope.

Do not implement backlog items unless Product Ownership explicitly promotes them into the MVP.

---

# Near-term candidates after MVP

## Reorder point / minimum stock
- minimum stock;
- reorder point;
- low-stock alerts;
- purchase suggestion.

High-value because current Veridi spreadsheets already reason about material shortage and purchase need.

Overlaps with Block D item 26 (Purchase Suggestion, `docs/MVP_PLAN.md`) —
that item is deficit-driven from a Customer Order's material impact;
reorder point is stock-level-driven independent of any order. Related but
not the same trigger; both feed a PO DRAFT, never a confirmed PO.

## Purchase planning / basic MRP
Use:
- planned production;
- available stock;
- reserved stock;
- On Order;
- lead time;
to suggest purchase needs.

Do not implement full MRP inside initial MVP.

Block D item 26 (Purchase Suggestion) is the Customer-Order-driven subset
of this same idea; see `docs/MVP_PLAN.md` and `docs/PRODUCT_RULES.md` §29.

## Expiry alerts
- configurable days-to-expiry;
- dashboard/list of upcoming expiry;
- proactive notifications later.

## Better supplier barcode receiving
Use external supplier barcode to:
- identify item;
- locate Purchase Order;
- reduce manual entry.

Internal QR remains Veridi's operational lot identity.

## Advanced reports/dashboards
- inventory trends;
- purchase lead times;
- production yield;
- expiry losses;
- consumption by product;
- supplier performance.

Do not build dashboards before core data is trustworthy.

**Note:** a basic management layer was promoted out of this backlog into
the MVP as **Block E — Management, Reports & Exports** (steps 29–31, see
`docs/MVP_PLAN.md` and `docs/PRODUCT_RULES.md` §30): operational cockpit
dashboard, reports, and CSV/PDF/print exports, to be executed after
Invoicing (28) and before the end-to-end demo. The deeper analytical
capabilities listed above (trends, lead times, supplier performance,
yield analytics) remain backlog — Block E is a cockpit, not BI.

---

# Quality / Compliance

## Full Quality module
Future capabilities:
- receiving inspection;
- parameterized specifications;
- microbiological analyses;
- approve/reject rules;
- non-conformity;
- reinspection;
- quarantine;
- release workflow.

## COA / Certificate of Analysis
- customer;
- NF;
- lot;
- expiry;
- analyses;
- approved/rejected status;
- branded PDF output.

## Recall / non-conformity workflow
Bidirectional traceability is already MVP.
Formal recall workflow remains future.

## Automated document extraction
- PDF parsing;
- XML import;
- supplier laudo extraction;
- NF XML extraction;
- data normalization.

---

# Warehouse / WMS

## Advanced addressing
- warehouse;
- zones;
- bins;
- directed putaway;
- advanced location history.

MVP only needs simple location.

## Multiple warehouses
Add only when operationally required.

## Wave picking / route optimization
Future scale item.

## Scheduled cycle counts
MVP has manual stock count.
Advanced count scheduling remains future.

## Industrial scanners / collectors
MVP uses phone/tablet camera first.
Dedicated hardware can be added later.

## GS1
Potential future:
- GS1 barcodes;
- GTIN;
- lot/expiry encoded standards.

Not needed for MVP.

---

# Purchasing

## RFQ / supplier quotation
- request quotations;
- compare suppliers;
- approval.

## Purchase approvals
- approval thresholds;
- multi-level workflow.

## Supplier performance
- lead time;
- late deliveries;
- quality issues;
- price history.

## Landed cost
- freight allocation;
- taxes;
- additional acquisition costs.

---

# Production

## Advanced MRP
- production planning;
- purchase planning;
- capacity.

## Work centers / machines
- equipment;
- machine capacity;
- production scheduling.

## Process control / encapsulation
- equipment;
- lot;
- OP;
- produced quantity;
- operational stops;
- period;
- process parameters.

## Machine integration
Read counters/microcomputers where feasible.

## Multi-level BOM
Only if products/subassemblies require it.

## Material substitutes
Formal equivalent-material rules.

## Loss/yield tolerances
- reason codes;
- target yield;
- alert thresholds.

## Rework / reprocessing
Formal workflows.

## Logistics unit / Volume / Handling unit
A physical package (box/pallet) identified on its own, holding a known
quantity of a single lot:

```text
VOL-000001 → LT-PA-001 → 500 un
```

Would let the operator scan one box and get the quantity already attached,
instead of scanning the lot and typing the quantity. **Not implemented in
the FAST MVP on purpose**: today the lot QR answers only "which lot?", and
quantity stays an explicit, separate decision on the shipment line. Units
are never serialized — 400 units of a lot are one scan, not 400 reads.

---

# Commercial / CRM

## Quotations
- commercial simulator;
- quotation;
- approval.

## Orders
Moved to **Block D — Orders & Fulfillment** (`docs/MVP_PLAN.md`,
`docs/PRODUCT_RULES.md` §29): Customer Order, Fulfillment Plan,
Finished-Product Reservation, Suggested Production Orders (MVP Ampliado
candidates, 22–25), Purchase Suggestion, Picking/Shipping, Invoicing
(Evolução Incremental, 26–28). Kept here as a pointer only — do not
duplicate scope notes in both places.

## WhatsApp CRM
- conversation consolidation;
- customer history;
- commercial context;
- future AI support.

## Customer portal
Not recommended until the consultative sales model proves a need.

---

# Fiscal / Finance

## Fiscal invoice
Integrate with a Brazilian fiscal provider/API.

Distinct from commercial Invoicing (Block D item 28, `docs/MVP_PLAN.md`
and `docs/PRODUCT_RULES.md` §29), which reflects quantity actually
delivered. The two concepts are related but must not be merged
prematurely — this fiscal/NF integration remains its own future
evolution.

## Costing / CMV
The current spreadsheets already show rich costing needs:
- raw material ✓ (MVP step 29);
- packaging ✓ (MVP step 29);
- production ✓ (material only, MVP step 29);
- labor;
- freight / landed cost;
- taxes;
- commissions;
- markup;
- margin.

**Partially promoted into the MVP as step 29 — Material cost foundation**
(see `docs/MVP_PLAN.md` and `docs/PRODUCT_RULES.md` §31): effective
acquisition cost at receiving, weighted-average cost reference with
30d/90d/last-real fallback, formulation cost estimate and production
material cost from the lots actually consumed, with explicit
`REAL`/`ESTIMATED`/`PARTIAL`/`NO_COST` quality.

Still backlog: labor, energy, depreciation, overhead, standard cost,
accounting FIFO/LIFO inventory valuation, month-end closing, gross/net
margin, landed-cost freight apportionment and a supplier price list. The
schema deliberately names the concept *effective acquisition cost* so
freight and directly attributable expenses can be folded in later.

## Accounts payable / finance
Not part of the operational MVP. Explicitly distinct from step 29: the
cost foundation answers *what the material cost*, never *when and how
much money actually left the cash register* — the latter (payables, due
dates, instalments, cash flow, interest, payments) remains future work
and must never be inferred from cost or from Purchase Order prices.

---

# HR
Only expand beyond user/access identity if clear business value emerges.

---

# Parameterised formulation templates / technical configurator

Formulation templates ship as a **versioned structured copy**: choose a
matrix, and it is copied into the product's own formulation. What was
deliberately left out — and belongs here until real use justifies it:

- placeholders and variables (30/60/90 day presentations from one matrix);
- configurable formulas and dynamic fields;
- sub-templates and inheritance between matrices;
- a product configurator built on top of the above.

The reason to wait: parameterisation multiplies the ways a recipe can be
expressed, and every one of them has to survive costing, pricing and a
production order. Which parameters are actually needed should come from
watching people reuse templates, not from anticipating it. Whatever is built
must keep rule §35 intact — the product's formulation stays an independent
copy, and no parameter change reaches a formulation that already exists.

---

# Product Blueprint (formulation + cost structure + pricing policy)

Three libraries now exist and each stands alone: a formulation template, a
cost structure template (TEC) and a pricing policy (TPP). The obvious next
ask is a package that applies all three to a new product in one step —
"cápsula 60 comprimidos private label" as a single choice.

Deliberately not built now. Reasons to wait:

- **The three do not fail together.** A formulation applies with no
  precondition; a cost structure needs an active formulation and refuses when
  a draft is already open; a policy needs a *saved calculation*, which cannot
  exist until the structure is activated and calculated. A one-click package
  would have to define what happens when step three cannot run — and any
  answer invented before real use will be the wrong one.
- **Bundling hides which layer is stale.** Provenance today names one origin
  per artefact, so "the policy has a new version" is a precise statement. A
  blueprint version wrapping three matrices would announce updates whose
  cause is not visible without opening each one.
- **The reuse pattern is unknown.** Whether shops reuse the same three
  together, or mix one shop's cost structure with another's pricing, should
  come from watching the libraries in use.

Whatever is built must keep rules §35 and §36 intact: each application stays
an independent copy, no tariff enters a cost template, no price enters a
policy, and nothing propagates back into an artefact that already exists.

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

## Legacy address arrives as one line — MEDIUM (migration) · ABERTO — decisão de Product Ownership

`clientes.csv` stores "Rua Vicente Jose de Almeida, n 158, bairro Cupece" in
a single field. The customer form wants Logradouro, Numero and Bairro apart.
Every migrated customer needs a manual split.

This is an import policy question, not a screen defect. Decide whether the
importer parses, or whether the form accepts a single free-form line for
migrated records.

## Legacy expiry dates are all in the past — MEDIUM (migration) · ABERTO — decisão de Product Ownership

Every `validade` in the legacy purchase history is 2023 or earlier. Received
literally in 2026 they are expired on arrival, so no lot can be released and
nothing can be produced. The audit had to substitute synthetic future dates
and label them.

Again a policy decision: refuse expired legacy lots, import them as blocked,
or require an explicit override per lot.

## Action labels differ from screen to screen — LOW · ABERTO

"Criar item", "Criar relação", "Criar fornecedor", "Salvar", "Registrar
tarifa", "Salvar rascunho", "Salvar base". Each screen asks the operator to
re-learn which button commits. Worth one pass of naming, not a redesign.

## Confirmation dialogs repeat the label of the button that opened them — LOW · ABERTO

"Ativar versão" opens a dialog whose confirm button is also "Ativar versão";
same for "Confirmar OC", "Confirmar recebimento" and "Ativar estrutura". The
dialog text itself is good — it says what becomes immutable. Only the button
label is ambiguous about which of the two is being pressed.

## Purchasing is allowed against a non-approved project — decision, not defect

Purchase orders were created and confirmed while `PROJ-000004` was still "Em
desenvolvimento". This is coherent with the domain: raw material enters
generic stock and is not reserved to a project. Recorded so Product Ownership
can decide deliberately rather than discover it later.

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

## Estado do backlog auditado — after the final visual polish

Everything the three deep cases (VAL-LEG-01, 02, 03) and the visual pass
raised is closed:

- **CRITICAL: 0** · **HIGH: 0** · **MEDIUM operacional: 0** · **LOW
  operacional: 0** · **observações visuais: 0**

What is still open here, and deliberately so:

- **2 MEDIUM de migração** — legacy address on one line, and legacy expiry
  dates all in the past. Both are import-policy decisions for Product
  Ownership, not screen defects: whether the importer parses the address, and
  whether expired legacy lots are refused, imported blocked, or overridden per
  lot. Neither blocks operation today; the audits worked around both with
  labelled synthetic data.
- **2 LOW de nomenclatura** — commit-button labels differ across screens
  ("Criar item", "Salvar", "Registrar tarifa", "Salvar rascunho"), and
  confirmation dialogs repeat the label of the button that opened them. Both
  are a naming pass, not a redesign, and neither was raised by an operator
  during the three cases.
- **1 decisão registrada** — purchasing against a non-approved project is
  coherent with the domain and stays as a deliberate decision, not a defect.

Nothing above is hidden behind a "zero": the audited backlog is zero, the
policy and naming items remain visible and unstarted.


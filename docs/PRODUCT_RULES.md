# Veridi Nutrition — Product Rules v0.4

These are Product Ownership's proposed MVP rules for areas where the current Veridi process is manual or not formally defined.

They should be implemented as the default MVP behavior and refined after operational validation.

---

# 1. Users

Users exist primarily for:
- authentication;
- operational responsibility;
- auditability.

Do not build a full HR module.

Keep the permissions model simple initially, but authorization must be enforced server-side.

---

# 2. Customers

Customers are in Block A.

Initial purpose:
- existing business reference;
- product/customer association where needed;
- future commercial/traceability expansion.

Do not implement CRM in MVP.

---

# 3. Suppliers

A material can have one or multiple suppliers.

The supplier actually used on a Purchase Order/receipt must be historically preserved.

Do not rewrite past supplier relationships when master data changes.

---

# 4. Items

An item is a controlled material.

Initial item types:
- RAW_MATERIAL;
- PACKAGING;
- FINISHED_PRODUCT where appropriate.

Each item has:
- immutable database ID;
- human-readable internal code;
- description/name;
- unit of measure;
- active/inactive state;
- optional supplier barcode/external code.

Suggested display-code patterns:
- `MP-000001` raw material;
- `ME-000001` packaging;
- `PA-000001` finished product.

Exact prefixes are presentation-level and may evolve.

Inactive items remain historically visible.

Each item also carries `requiresQualityRelease` (boolean, editable, default by
type — true for RAW_MATERIAL/FINISHED_PRODUCT, false for PACKAGING): decides
whether a lot received for that item starts `AWAITING_RELEASE` or already
`AVAILABLE`. It is a per-item setting the user can override, never inferred
permanently from `type` alone.

## Durable rules confirmed at implementation

- Once an item is operationally used (referenced by a Purchase Order line,
  Receipt line, Lot, or Inventory Movement), its structural fields —
  `type`, unit of measure, `controlsLot`, `controlsExpiry` — are locked
  for good. Changing them after real history exists would silently change
  the meaning of numbers already recorded. `name`, external barcode,
  active/inactive, and `requiresQualityRelease` remain always editable.
- `requiresQualityRelease` only affects lots received after the change —
  it never retroactively rewrites the status of lots that already exist.

---

# 5. Products

A product represents the output/commercial product that can have formulations and production orders.

A product may eventually be customer-specific, but do not force that complexity unless needed.

Product is distinct from Item:
- Item is the physical entity controlled in inventory (including the
  FINISHED_PRODUCT item that is physically moved/stocked);
- Product is the commercial/industrial definition that formulations,
  versions and Production Orders will belong to.

Do not merge Product and Item into a single entity.

A Product may optionally reference:
- a Customer (`customerId`, nullable — a product may have no customer yet);
- a FINISHED_PRODUCT Item (`finishedProductItemId`, nullable).

Cardinality (MVP): when set, the Product ↔ Item link is 1:1 — a
FINISHED_PRODUCT item is associated with at most one Product. This may be
revisited if multiple SKUs/packagings per commercial definition become a
real need; do not model that ahead of time.

A new association (create, or changing an existing link to a different
Customer/Item) requires the target to be active. An existing association
is never invalidated by the Customer/Item being inactivated later —
historical links are preserved and keep displaying, without forcing the
user to clear them to edit unrelated fields.

# 5.1 Projects and versioned quotes (capability 38)

- A **Project** is the commercial funnel before the product exists; a
  **Product** is the approved, operational product. Approving the project
  is exactly the moment one becomes the other — never an automatic
  conversion at registration time.
- A private-label project always belongs to a customer. The customer can
  still be changed while nothing was formally quoted; once a quote is
  sent, changing it would rewrite commercial history, so it is blocked.
- Pipeline vocabulary is Veridi's own: waiting, sample, approved,
  cancelled, stand-by. Approved and cancelled are terminal in this phase,
  and every transition is recorded in an immutable status history —
  `updatedAt` does not tell history.
- Cancelling requires a reason, and "other" requires the description.
- Concept and channel are **open vocabulary**: free text with suggestions
  from values already in use. A closed enum would freeze a vocabulary that
  the business keeps extending.
- The project carries a technical **brief** (dosage form, presentation,
  doses, shelf life…). It is intent, not the product record; it is copied
  into the Product at approval, and from then on the two live separate
  lives.
- Quotes are **versioned**. Only the draft is editable, and there is at
  most one open draft per project. Sending freezes the customer and
  project snapshot, so printing it tomorrow never depends on the current
  registration. Before sending there is no snapshot: the draft shows — and
  prints, marked as draft — the current customer and project registration,
  exactly what sending will freeze. A version outside draft never falls
  back to the registration, not even when it has no snapshot (legacy). A
  new negotiation is always a new version, and the previously presented
  version becomes superseded.
- Quantity and price are Decimal; the total is derived, never stored. A
  `null` price means "not priced yet" and never becomes zero.
- Accepting a quote is an operational record that the customer agreed to
  that version — it is not an electronic signature.
- Approving a project requires an accepted quote, and the whole approval
  is one transaction: the project only ends up approved if the Product is
  created or linked in the same step. Approving twice never creates a
  second product.
- The formulation created at approval is always a DRAFT V1: the commercial
  side approves the business, not the recipe. Only engineering activates a
  version.
- Legacy projects may represent incomplete historical states. They are
  imported as `LEGACY_IMPORT`, never invent a Product to satisfy a foreign
  key, and never overwrite what the system itself has edited.

# 5.2 Samples / pilots / trials Tn (capability 39)

- A **sample is not a Lot and not a Production Order**. A project goes
  into sampling before any Product, finished-goods item or operational
  formulation exists; creating an artificial Product just to make a sample
  would be a lie in the master data, and modelling it as a lot would put
  development material inside shippable stock.
- The sample has its own identity (`AM-000001`) and its own QR payload
  (`SAMPLE:…`), deliberately different from a lot's `LOT:…`. Scanning a
  sample must never open a stock lot.
- The trial number `Tn` is sequential **per project**, generated under a
  row lock so two simultaneous creations never collide. Legacy `Tn` is
  preserved as exported and never renumbered; new samples continue after
  the highest existing number.
- Creating the first sample moves a waiting/stand-by project into the
  sample stage, with an explicit status-history event. An approved or
  cancelled project accepts no new sample.
- **An approved sample never approves the project.** Technical approval of
  a trial and commercial approval of a project are different decisions;
  the latter still requires an accepted quote and an explicit action.
- Material used in a sample is a **real physical stock exit**, recorded as
  its own movement type (sample consumption) — never disguised as an
  adjustment, and never a second ledger of its own. It reuses the same
  eligibility rules as the rest of the system: lot belongs to the item,
  quality/expiry/CoA state, owner (customer-owned material only for that
  customer's project), positive quantity and availability net of what is
  reserved for production orders or customer orders. There is no bypass
  "because it is a sample".
- Rejecting or cancelling a sample **never reverses consumption**: what
  was physically used stays used. A reversal, if ever needed, is an
  explicit inventory operation with its own reason.
- The sample output never enters finished-goods stock and is never
  shippable as product. Its label carries no price or cost.
- Concluding a sample freezes the customer/project snapshot, so a later
  rename never rewrites a label that was already printed and sent.
- Roles: creating a sample belongs to commercial/production; consumption
  and physical completion belong to production; approving or rejecting the
  result belongs to commercial. Quality reads and attaches documents.
- Legacy samples are only imported when the link to a project is
  unequivocal. The historical export has no customer or product code, so
  resolution by resemblance is forbidden — unresolved rows become findings,
  no Project is invented, no consumption is fabricated and no outcome
  (approved/rejected) is guessed.

# 5.3 Item × Supplier, qualification, MOQ and prices (capability 40)

- Price, MOQ and supplier code never live on the Item. One item may have
  several suppliers with different conditions, so the relation itself is the
  entity: **SupplierItem**, unique per (supplier, item).
- The supplier's own code for the item is recorded separately; it is neither
  the internal code nor the legacy spreadsheet code.
- **Qualification is per item, not per supplier.** A supplier approved for
  one raw material is not automatically approved for everything.
  `PENDING` means "no approved qualification on record" — it is an absence,
  never a rejection; only `BLOCKED` is a deliberate refusal.
- Approving or blocking is Quality's decision; Purchasing registers the
  relation, the commercial code, the prices and the preferred supplier, and
  either side may send a relation back to pending. Every transition is kept
  in an immutable history with who and when.
- **Approved and preferred are different concepts.** At most one preferred
  supplier per item (enforced by a partial unique index, with the previous
  one cleared in the same transaction). Only an active, approved relation can
  be preferred, and blocking or deactivating clears it in the same
  transaction. Preferred is an operational/commercial decision — it is
  **never** recalculated because another offer got cheaper.
- A relation being inactive is different from being unqualified: a supplier
  may stay approved and simply stop selling that item. Relations are never
  hard-deleted while offers or history exist.
- Price and MOQ belong to an **immutable offer**. Correcting a price, a MOQ,
  a currency or a validity period is always a new offer — history is never
  rewritten. A price is always present in an offer: unknown price means no
  offer at all, and zero is an explicitly stated zero.
- Every offer states the unit its price refers to, and that unit must be
  compatible with the item's stock unit. MOQ is optional; `null` means "not
  informed", never zero, and when informed it needs a positive quantity and
  a unit.
- The **current offer** is the most recent one whose effective date has
  started and whose validity has not expired. An offer with no effective
  date is a historical price observation and can never be the current price —
  the UI may show it as a legacy reference, never as "current price".
- Currencies are recorded, never converted: no FX in this phase, and no
  cross-currency "cheapest" ranking. USD 10 is not compared with BRL 60.
- Purchase Suggestion only recommends **approved and active** relations of
  active suppliers. The recommendation is conservative: the preferred one,
  or the single approved one; with several approved and none preferred the
  system chooses nobody — and it never picks the cheapest by itself. Blocked
  relations never appear as candidates.
- MOQ produces a recommendation, never a block: when the units are
  comparable, the recommended quantity becomes `max(shortage, MOQ)`; when
  they are not, the MOQ is shown in its original unit and nothing is
  adjusted automatically.
- Missing qualification does not stop anything: no supplier registered for
  an item still shows the shortage, and manual purchase orders remain
  possible (emergency, sample, brand-new supplier). Qualification guides;
  it is not a global purchasing gate in this phase.
- A draft Purchase Order line may be pre-filled from the current offer, but
  only when the currency is BRL and the price unit converts safely to the
  line's unit. The line is a **snapshot** of the negotiated/expected price:
  a later offer never changes an existing order.
- A supplier offer is a **commercial reference, not an actual acquisition
  cost**. It stays out of the `REAL → 30D → 90D → LAST_REAL → NO_COST`
  hierarchy and never silently changes item or formulation cost — that
  remains driven by real receipts.
- Legacy prices are imported as observations: the historical export has no
  quotation date, so they carry no effective date and never become current
  prices. A "best price" flag in a costing snapshot is not an official
  preferred supplier and never sets `preferred`. Suppliers are resolved by
  exact name, never fuzzy-matched, and no supplier is created just to hold a
  legacy price.

# 5.4 Legacy migration (capability 41)

- The importer is **one-shot and specific to Veridi**, not a generic ETL:
  the pipeline is `validate → plan → apply → verify`, plus a separate
  opening-stock step.
- **Dry-run is the default.** Only `apply` writes, and only with an explicit
  flag. The importer is additive and idempotent: it never truncates, drops
  or resets, and re-running never duplicates.
- Identity comes from stable keys — legacy `externalCode`, content-derived
  `sourceKey`, or the domain's own business key. **A legacy code never
  replaces the ERP code**: internal codes always come from the system's own
  sequences.
- Uncertain source data produces a *finding* with an explicit severity;
  it is never "fixed" by guessing, and **fuzzy matching is not allowed**
  anywhere (supplier, item, project or sample).
- A bad row never blocks the good ones: blocking findings skip that row and
  the migration continues.
- Human decisions live in explicit override files (map to an existing
  record, or ignore). **No override creates master data** — a single price
  row is not enough evidence to create an Item, and converting a price per
  kilo into a price per unit would require a weight nobody has.
- The importer never overwrites a record the ERP itself edited; it may only
  complete empty fields of records it created.
- **Importing master data never moves stock.** That invariant is verified
  after every apply.
- Incomplete receipt history is **not** reconstructed: importing historical
  inbound movements without the matching consumption would inflate On Hand,
  and a "receipt with no inventory effect" would contradict the domain.
- Opening inventory requires human reconciliation: legacy balances are
  aggregated per item, the ERP controls stock per item **and lot**, and
  inventing a lot to close a balance would destroy traceability. The sum of
  the informed lots must match the legacy balance or that item is not
  applied.
- A lot-controlled item requires a real lot identification; negative legacy
  balance never migrates; opening lots are never `AVAILABLE` by omission and
  never carry an approved CoA without an actual document.
- The opening event is its own movement type (`OPENING_BALANCE`): it is not
  a purchase receipt, not production and not an adjustment. It is applied
  once per stable key, and later corrections use normal inventory
  count/adjustment.
- The cutover creates a new source of truth: before it, the spreadsheet is
  history; after it, the ERP is the operational truth.
- Costing data (CMV) is deferred to Block G and regulatory limits (IN28) to
  Block H — validated in structure, never persisted.

# 5.5 Operational UX and printing (capability 42)

- Destructive actions (deactivate, cancel, block, archive) are never the
  primary button of a table row: they live in the row's overflow menu and
  keep their confirmation dialog. Frequent operational actions stay visible.
- The document flow (order › production order › shipment › invoice) is
  **navigation, not status**: it never recalculates state and never shows a
  non-existent step as if it were a pending document.
- Filter persistence is client-side and session-scoped only, per user and
  per screen. There are no saved views in the database, and "clear filters"
  is always available so persistence never traps someone on an apparently
  empty screen.
- Report aliases ("Kardex", "necessidade p/ produção") are display and
  search only: the official `R-xx` code and the endpoint never change.
- Attention items are grouped by cause for reading; the dashboard remains a
  derived cockpit with no persisted attention table, and one lot never
  appears under two overlapping reasons.
- The UI never replaces backend validation: role-aware shortcuts only avoid
  offering an action the user cannot perform — the server remains the
  authority.

## Printing policy

Official documents and reports are **real PDF files** generated in the
browser (`@react-pdf/renderer`, `apps/web/src/pdf`) from the same
authenticated API data the screen uses — there is no PDF engine in the
backend and no public document URL. The file is A4, with a controlled
header, running header and footer ("Página X de Y", generation stamp in the
operation's time zone) and no browser header, footer, title or URL. The
document screen offers **Baixar PDF** (direct download, file named after the
document code) and **Imprimir** (prints that same file). The **source** is
always a dedicated document route: the operational screen itself is never
printed. `window.print()` remains only for physical labels (lot and sample
labels) — PDF-DOCUMENT-SYSTEM-01.

| Content | Output |
| --- | --- |
| Administrative list | CSV |
| Report | CSV + professional printing |
| Transactional document | professional printing |
| Traceability | professional printing |
| Operational sheet (FO-xx) | professional printing |
| New / edit form | no export |

- Printing a list-derived document always uses the **complete filtered
  result** (`all=true`), never just the page open on screen.
- Print is always a preview first: the dedicated route renders the document
  and the user decides to print. Nothing prints automatically.
- Every printed document carries the Veridi identity, the document
  name/code, the applied filters or period, when it was generated and — now
  that authentication exists — **who generated the printout**. That is the
  print author, and it never replaces the historical snapshots of who
  executed, approved or issued each act.
- Paper may contain fields that do not exist in the database (physical
  count, checked, observation, signature line). They are handwriting space:
  nothing is persisted from paper, and a signature line on paper is never
  presented as an electronic signature or GMP approval.
- Operational sheets (`FO-xx`) are documentary identification, not an
  entity: no `OperationalSheet` table exists. They show the current filtered
  state at generation time and are not legal snapshots — transactional
  documents keep using their frozen historical snapshots.
- Unknown financial values keep printing as "—", never `R$ 0,00`, and a
  partial cost is always explicitly partial.
- Business codes (`PROJ-`, `PED-`, `LT-`…) are what appear on paper; a UUID
  is never printed when a business code exists.

# 5.6 Industrial cost structure (capability 43)

- **Structure is not calculation.** A cost version declares which recipe,
  which production base and which additional costs exist. No total is
  computed or stored here; the consolidated industrial cost is a later
  capability, and calling a not-yet-calculated number "CMV" is how someone
  prices wrong.
- The structure is **versioned per product**: at most one draft and at most
  one active version, both enforced in the database. Only the draft is
  editable; active and inactive versions are history, and a correction is a
  new version.
- A version points at a **specific formulation version**, never at "the
  currently active formula". Activating a new formula never rewrites an
  existing cost structure — the divergence is reported so a human decides
  whether a new cost version is needed.
- A draft may reference a draft formulation (engineering work), but it
  cannot be activated while the formulation is still a draft: freezing cost
  over a mutable recipe would be meaningless.
- Materials and packaging come from the formulation and are **never retyped**
  as manual cost lines. Customer-supplied material appears because it is part
  of the product's physical structure, but it is never a Veridi acquisition
  cost.
- Manual lines exist only for what is not in the formulation: secondary
  packaging, third-party services, overhead and other. Labour, equipment and
  energy are deliberately excluded — they get their own modelling, and
  creating them as manual lines now would mean duplicating them later.
- The reference output quantity is never assumed (no implicit 1000). The
  minimum batch may be *suggested*; the user confirms, and the unit must be
  compatible with the finished product's unit.
- An uninformed rate is `null` — **never zero**. Zero is an explicitly
  stated zero. Completeness is derived, never persisted: a structure with an
  uninformed rate, or a per-shipping-box line on a product without units per
  box, is incomplete.
- An incomplete structure **can** be activated, with explicit confirmation:
  the unknown stays unknown instead of blocking the whole registration, and
  the future calculation reports partial cost rather than inventing a number.
- Activation freezes document snapshots (product, customer, formulation
  version, units per box) so printing later never changes silently.
- A cost structure changes nothing in the Foundation of Costs: real
  acquisition cost, the `REAL → 30D → 90D → LAST_REAL → NO_COST` hierarchy,
  production consumption cost and supplier offers are untouched. Supplier
  offers remain a commercial reference, not actual cost.
- Percentage rates are stored as plain percent (10 = 10%), with a technical
  ceiling to catch typos. The direct industrial cost base for percentages is
  materials and packaging + direct labour + equipment + energy, before
  overhead; customer-supplied material never enters it.
- Costing structures do not feed quotes, prices, margins or commissions —
  those are later capabilities.

# 5.7 Industrial resources (capability 44)

- A **resource** and the **use of a resource** are different things. The
  resource ("production operator", "encapsulating machine", "electricity")
  is registered once with its own code and its own rate history; how many
  hours a given product consumes belongs to that product's cost structure.
  Free text like "encapsulator R$ 85 × 2.5" inside a product is not a model.
- A labour resource is an **economic category, never a person**. `User`
  stays the record of who did or audited something; the two are never linked
  automatically.
- **Rates are immutable and historical.** A raise is a new rate; the previous
  one stays to explain why an old structure cost what it cost. There is no
  `currentRate` column: the current rate is derived from a reference date
  (`effectiveAt`/`validUntil`), never from `createdAt`, and a legacy value
  with no effective date is a reference — never a current rate.
- The unit follows the type: labour and equipment are charged per hour,
  energy per kWh. "Operator at 3 KG" is rejected. Hour and kWh live in
  their own closed enum and are deliberately kept out of the item unit
  registry, where they would allow a raw material measured in kWh.
- Power (kW) exists only for equipment and is **never invented**. Unknown
  power stays `null`, never zero, and one single powerless piece of
  equipment leaves the derived energy of the whole version *open* rather
  than reporting the partial sum as if it were the real consumption.
- A cost version declares at most **one usage line per resource** (there is
  no routing in this phase, so the same resource's time is summed), always
  with a quantity greater than zero — a resource that is not used simply is
  not declared.
- Energy is either **informed directly** or **derived from equipment**
  (Σ hours × kW), never both: adding them would count the same energy twice.
  `NONE` means "not structured yet" and never means zero energy.
- Activating a version **freezes** the economic snapshot of every usage:
  resource name and type, rate id/value/currency/unit/effective date and
  power. Raising a rate tomorrow never rewrites an activated structure, and
  an unknown rate freezes as `null` — never as zero. Activating with unknown
  rates or powers requires explicit confirmation.
- An **inactive resource blocks the activation** of a new structure, while
  structures already active keep working with the values they froze.
  Deactivating a resource today never creates a pendency on a document that
  was activated yesterday.
- A new cost version copies the resource usages (the plan) but never the
  frozen rates: the new draft must see today's current rate.
- Nothing here multiplies quantity by rate: the consolidated industrial cost
  is the next capability, and printing a "resources" section on a draft
  shows today's reference while an active version shows the frozen snapshot.
- Legacy spreadsheets never create resources. Text hints only produce
  findings (`LABOR_RESOURCE_CANDIDATE`, `EQUIPMENT_RESOURCE_CANDIDATE`,
  `ENERGY_RESOURCE_CANDIDATE`, `EQUIPMENT_COST_MAY_INCLUDE_ENERGY`,
  `UNRESOLVED_RESOURCE_COST`); registering a resource and its rate stays a
  human decision.

# 5.8 Industrial cost calculation (capability 45)

- **Cost, price and amount paid are three different things.** A supplier
  offer is a proposed price, `Receipt.actualUnitCost` is a real acquisition
  cost, and what was actually paid to the supplier stays outside this phase.
- Two views that never mix: the **standard/prospective cost** ("what does it
  cost to produce this structure's reference batch given what is known on a
  date") and the **cost of a realised production** (materials actually
  consumed plus standard industrial costs applied).
- Every calculation takes an explicit **cost reference date**. The UI
  defaults to today, but "today" is never buried in the domain: the same
  product calculated in March and in August is allowed to differ, which is
  exactly why saved calculations exist.
- Prospective material cost follows the Foundation hierarchy —
  **weighted average of the last 30 days → 90 days → last real cost** — and
  only then, as a last resort before "no cost", an eligible supplier offer.
  Averages are always weighted by quantity: 10 kg at 100 plus 20 kg at 130
  is 120, never 115.
- An offer is only eligible when the supplier relationship and the supplier
  are active, the item is APPROVED for that supplier, the price is in BRL,
  the offer is effective on the reference date and its unit converts to the
  item's unit. A legacy offer without an effective date never becomes cost,
  even when it is the only number available.
- With a preferred supplier, its offer wins — preference is a commercial
  decision, not "the cheapest". With several approved suppliers and no
  preferred one, **the cost stays unknown**: picking the lowest price would
  be making a purchasing decision on someone's behalf.
- Customer-supplied material is **excluded**, not zero and not unknown: it
  belongs to the product's physical structure, never to Veridi's cost, and
  it does not degrade the quality of the result.
- Physical quantities always come from the frozen formulation version scaled
  to the structure's reference output — the same requirement math used by
  production, never a second implementation of the formula.
- Shipping boxes are whole: 25 units at 12 per box is 3 boxes. Percentages
  apply to the **complete** direct industrial cost and never compose the
  base of another percentage.
- Direct industrial cost = Veridi materials and packaging + secondary
  packaging + third-party services + labour + equipment + energy + other
  direct lines. Overhead comes after it; customer-supplied material never
  enters the base.
- **A partial total does not exist.** When any necessary component is
  unknown, the total, the direct cost and the unit cost are `null`, and what
  is shown is labelled "subtotal conhecido" — never "total".
- Quality is explicit: `COMPLETE_REAL_REFERENCE` (everything known, all
  materials from real purchases — which is *not* the realised cost of a
  production), `COMPLETE_WITH_ESTIMATES` (at least one material priced from
  a supplier offer), `PARTIAL` and `NO_COST`.
- A **saved calculation is immutable**. It freezes the whole analysis so the
  pricing decision taken today stays explainable in three months; later
  purchases, rate changes or structure edits never rewrite it, and the print
  uses the saved result rather than recalculating.
- The **frontend never calculates economic values**. Saving a calculation
  recalculates on the backend: the payload the screen displayed is never
  accepted as truth.
- A Production Order freezes a **compatible** cost structure at release —
  active and pointing at the same formulation version the order executes.
  No compatible structure means production continues normally and the
  industrial cost is material-only, stated as such.
- Realised production cost separates **actual materials** (the lot really
  consumed, valued at its own `consumedAt`, never "today") from **standard
  applied costs** scaled by produced ÷ reference output. Resource hours and
  kWh are not measured in this phase, so they are never called "real": the
  document is labelled hybrid.
- Completing a Production Order freezes its cost snapshot, once. Informing a
  receipt cost or raising a rate afterwards never rewrites it; a retroactive
  correction, if it ever exists, will be an explicit cost revision.
- Money is always Decimal, never float; internal precision is preserved and
  rounding happens at presentation (2 decimals for totals, up to 6 for unit
  costs). Everything is BRL — no FX in this phase.
- Legacy CMV values validate the engine with historically known inputs; they
  never become current material cost. Divergence between the engine and the
  spreadsheet is reported (`CMV_MATERIAL_DIVERGENCE`), never fixed by
  adjusting a formula or a price.

# 5.9 Pricing, margin and quantity tiers (capability 46)

- A formal pricing version **starts from a saved cost calculation**
  (`CALC-…`). That snapshot is what freezes the structure, the formulation,
  the material references, the rates and the reference date — without it
  nobody can say which cost a price was built on.
- **Every tier of a version shares the same economic basis.** A purchase
  landing in the middle of a negotiation must not make the 300-unit tier and
  the 1000-unit tier describe different realities. A new cost context means a
  new calculation and a new pricing version.
- **Quantity changes the unit cost.** A fixed cost per batch does not shrink
  below one batch, shipping boxes are whole and per-reference-batch resources
  follow the batch count, so a tier is always recalculated for its own
  quantity — never the CALC's unit cost multiplied by an arbitrary number.
  This batch-aware reading is the commercial simulation; the realised
  production cost of capability 45 keeps its proportional reading untouched.
- Customer-supplied material stays outside the Veridi cost and does not
  degrade the cost quality; the pricing document says it is there.
- **Commission is a percentage of the gross sale price** — R$ 100 at 5% is
  R$ 5. No other commission base exists in this phase.
- **Contribution = price − commission − industrial cost.** It is *not* net
  profit: taxes, financial expenses, default risk and commercial freight are
  not modelled, so the words "lucro" and "margem líquida" never appear.
- Contribution margin is contribution ÷ price and **may be negative** — a
  price below cost is commercial information, never clamped to zero. Markup
  is a different thing (price ÷ cost − 1) and is `null` when the cost base is
  zero: infinite markup does not exist.
- Target margin mode computes `P = C / (1 − margin − commission)`, which
  requires margin + commission below 100%; anything else has no price that
  satisfies it and is rejected.
- **A partial cost never produces a price by margin**: the suggested price is
  `null` and the version cannot be activated in that mode. A manual price is
  allowed over a partial cost, but margin, markup and contribution stay
  `null` — a margin computed over the known subtotal would look safe and
  would not be.
- Activating a pricing version **recalculates everything in the backend** and
  freezes cost, price, commission, contribution and markup per tier. Numbers
  sent by the screen are ignored, and the frontend never computes price,
  margin or markup.
- An **active pricing version is immutable**: new receipts, new rates, a new
  structure or a new calculation never rewrite a negotiated price. A new
  version copies the commercial plan (tiers, margins, commissions) but never
  the economic snapshots.
- A tier quantity below the product's minimum batch is a **warning, never a
  silent correction** — the quantity the user typed is the quantity that
  stays.
- Prices are Decimal with enough precision and **no invented rounding rule**:
  the system never turns 15.3846 into 15.90 on its own; a rounded price is a
  manual decision.
- Quotations stay manual in this capacity: pricing feeds no quote
  automatically, and the read model of the active pricing exists for the next
  capability to consume.
- Legacy pricing rows remain **commercial observation only**. Because the
  exported historical unit cost is untrustworthy, the historical margin
  formula cannot be verified (`HISTORICAL_MARGIN_FORMULA_UNVERIFIABLE`) and
  no pricing version is ever created from the spreadsheet.

# 5.11 Finding records (findability round)

Rules that outlived the round that produced them. The UI side of them lives in
`docs/UI_BRAND.md`; what is here is the product intent.

- **A dynamic business entity is searched, not scrolled.** Product, item,
  customer, supplier, project, lot, order, production order, formula, resource
  and supplier item appear as searchable selectors wherever they are chosen.
  A small enum (status, type, mode, currency) keeps the plain select.
- **An entity is always shown as business code + name.** The UUID is an
  implementation detail and never reaches the operator.
- **A link that carries context must filter for real.** A query parameter that
  the destination ignores is worse than no link: it promises the answer and
  delivers a random list. Explicit URL beats the remembered session filter.
- **A known relationship is navigation, not a new search.** If the system
  already knows which orders belong to a customer, the customer's record links
  to them; the person does not open another module and search again.
- **List filters exist to answer real questions**, not to mirror the schema.
  When a filtered list comes back empty it says so — "nothing for these
  filters", with a way to clear them — which is a different statement from
  "nothing registered".
- **A checkbox is a promise that something can be done with the selection.**
  Selection is page-local, the counter never refers to rows the person can no
  longer see, and changing a filter clears it. Selection never implies bulk
  mutation: approving, releasing quality, shipping, invoicing and cancelling
  keep their own transactional rules and stay one record at a time.

# 5.10 Project → Quotation → Cost/Price (capability 47)

- **A product may exist before the project is approved.** Costing and
  pricing need a Product, and a quotation needs a price — so the product now
  has an explicit lifecycle: `DEVELOPMENT` for engineering and costing,
  `APPROVED` for operation. Every product that already existed is
  `APPROVED`; nothing about them changed.
- A development product is **not a fake product**: no parallel entity, no
  temporary code. Approving the project *promotes the same product* — same
  code, same formulation, same cost structure, same pricing, same history.
- Development products may have formulations (including an ACTIVE one, which
  means "recipe chosen", not "product released"), cost structures,
  calculations and pricing. They may **not** enter customer orders,
  commercial production orders, shipments or invoicing. The gate lives in
  the backend, in one helper — calling the API directly does not bypass it,
  and operational selectors only offer approved products.
- Preparing the technical product **does not change the project status**: it
  is engineering work, not a commercial decision. The action is idempotent —
  a project never ends up with two products.
- Cancelling a project deactivates only the development product **that
  project itself created** (`originProjectId`), never a legacy or approved
  one. Nothing is deleted: formulation, structure, calculation, pricing and
  quotations stay auditable.
- Project approval still **requires an accepted quotation** and still creates
  the product when none was prepared. Pricing is *not* required to approve —
  a manual price stays a legitimate commercial exception, shown as a warning
  rather than a blocker.
- A quotation's price is either `MANUAL` or comes from a `PRICING_TIER` of
  an **ACTIVE** pricing version of that project's product. A draft pricing
  never backs a proposal sent to a customer.
- The tier quantity must match the quoted quantity **exactly** (after a safe
  unit conversion). No nearest-tier selection, no interpolation: a tier is a
  closed economic scenario, and using another quantity would change batch
  count, fixed costs, boxes and resources. Without the matching tier the
  answer is "create the tier or use a manual price", never an invented one.
- While a quotation is backed by a tier, quantity, unit and price come from
  the tier and cannot be typed over; commercial conditions (validity,
  payment terms, lead time, notes) stay editable. Unlinking switches to
  manual price, keeps the current value as a starting point and **drops the
  provenance** — a link that survived manual editing would be a lie.
- Sending a quotation freezes the pricing provenance (PREC, tier, CALC, cost
  structure, formulation, industrial cost, cost quality, commission,
  contribution, markup, warnings). Later pricing versions, calculations or
  purchases never rewrite what was presented to the customer.
- A tier with incomplete industrial cost may back a proposal, but sending it
  requires **explicit confirmation**, and the frozen snapshot records that
  the margin was not calculable.
- **The customer-facing quotation never shows cost, margin, markup,
  commission, CALC or PREC.** That provenance is internal, delivered only to
  commercial and administration roles; the R-20 audit report carries the same
  restriction and prints marked as an internal document.
- A new quotation version copies the commercial values but never the pricing
  link: each proposal confirms its own economic basis.
- Legacy quotations stay `MANUAL` and never receive retroactive provenance
  they never had.

---

# 5.12 Product CMV — cost of goods for a quantity

- **CMV is the business view of a product's industrial cost for a quantity,
  composed from Formulation + Cost Structure + the calculation in force; it
  is not a separate source of truth.** No `Cmv` entity, no table, no
  migration, no second engine: the numbers come from the same
  `costForOutputQuantity` the pricing tiers use, and the composition is
  annotated by that engine while it adds up — never recomputed afterwards.
- The question the screen answers is "how much does it cost to produce 1,000
  jars of this product?". Answering it must not require knowing that
  `IndustrialCostVersion`, `IndustrialCostCalculation` or
  `PricingVersion` exist. Those appear as provenance, in Portuguese, under
  "Estrutura de custos" and "Cálculo de referência".
- **Quantity and reference date are always explicit.** The domain never
  picks the day by itself: the same product simulated today and next month
  may cost differently, and the answer has to say which day it is talking
  about. The reference date selects the saved calculation **in force up to
  that calendar day** — a calculation saved later could not have been known
  then. Before any calculation exists there is no CMV, and the answer says
  so instead of using a basis nobody could have had.
- **Simulating is reading.** Opening the screen, changing the quantity or
  going back to the quotation never creates a calculation, never writes a
  price and never persists anything. Freezing remains the job of the
  saved calculation (CALC).
- Quantity changes unit cost: fixed-per-batch costs do not dilute below one
  batch, shipping boxes are whole, and per-reference-batch resources follow
  the batch count. Never the CALC unit cost multiplied by an arbitrary
  quantity.
- **A pricing tier matches by exact quantity only.** No interpolation, no
  nearest tier, no falling back to the one below. 750 units between the 500
  and 1,000 tiers has no price in force, and the screen says exactly that —
  offering a neighbouring price would be inventing a negotiation.
- **A tier existing never changes a quotation line's price by itself.** The
  screen suggests; a person applies. After applying, the source is
  `PRICING_TIER` with the provenance that already existed — CMV itself never
  becomes a price.
- Customer-supplied material keeps its physical quantity and stays out of
  Veridi's acquisition cost. It is neither zero nor unknown.
- An incomplete cost shows **"CMV indisponível"** plus the known subtotal,
  explicitly labelled as not being the total. `R$ 0,00` is never shown in
  place of unknown; zero, when informed, is a real value.
- Cost provenance, cost quality and internal economics (price, margin,
  commission, markup) follow the pricing gate that already existed —
  commercial and administration only. The customer-facing document keeps
  carrying none of it.
- CMV **functionally replaces the spreadsheet for simulation in the current
  flow**. That is not a claim of 100% equivalence with the historical Excel:
  what is covered is cost for a quantity, its composition and the price in
  force.

---

# 6. Purchase Orders

Purchase Order is inside MVP.

Minimum states:
- DRAFT;
- ORDERED;
- PARTIALLY_RECEIVED;
- RECEIVED;
- CANCELLED.

Minimum data:
- internal PO number;
- supplier;
- order date;
- expected delivery date when known;
- items;
- ordered quantity;
- unit;
- optional unit price initially;
- received quantity;
- open quantity;
- status.

A DRAFT PO does not count as On Order.

An ORDERED/PARTIALLY_RECEIVED PO contributes its remaining open quantity to **On Order / Em Compra**.

Receiving may be partial.

A received item may arrive in more than one physical/supplier lot.

MVP does not include:
- quotation comparison;
- RFQ;
- multi-level approval;
- supplier scoring;
- accounts payable.

## Durable rules confirmed at implementation

- Only RAW_MATERIAL/PACKAGING items can be purchased; FINISHED_PRODUCT is
  never a valid PO line item.
- A line's unit of measure always comes from the item's own stock unit —
  no arbitrary/incompatible unit choice on the line.
- The same item cannot appear in two lines of the same PO; combine into one
  line instead.
- Editable transitions this delivery: DRAFT → ORDERED, DRAFT → CANCELLED,
  ORDERED → CANCELLED. PARTIALLY_RECEIVED/RECEIVED are modeled but not yet
  reachable — Receiving owns those transitions.
- DRAFT is fully editable (supplier, dates, lines, quantities, prices).
  ORDERED locks everything except expected delivery date and notes.
  CANCELLED is read-only. Confirming re-validates supplier and every line's
  item (existence/type/active) at that moment, not just at each draft save.
- Confirming freezes the document: supplier and item identity/name/unit are
  snapshotted onto the PO/line at write time, so later edits to the
  Supplier/Item master data never change how a confirmed PO reads.
- Cancelling requires a reason and records who/when; it never deletes the
  PO and never blocks re-reading its history.

---

# 7. Receiving

Receiving should normally originate from a Purchase Order.

For each received lot capture:
- PO;
- item;
- supplier;
- received quantity;
- unit;
- supplier lot;
- expiry when applicable;
- NF/document reference when known;
- optional attached PDF/document;
- initial quality availability status;
- physical location;
- internal lot identity.

A partial receipt:
- updates PO received quantity;
- keeps open quantity;
- keeps PO as PARTIALLY_RECEIVED until complete.

Receiving must be transactional.

---

# 8. Internal lot identity

The system creates its own immutable lot identity.

Example human-readable internal code:
`LT-20260814-00452`

The supplier lot remains a separate field.

Never replace supplier lot with internal lot code.

Store both:
- internal lot = system/physical operational identity;
- supplier lot = external traceability identity.

For finished products, keep:
- immutable internal lot ID;
- user-entered/Veridi output lot number until an automatic algorithm is formally defined.

---

# 9. Lot documents

MVP includes simple document attachment/reference at lot level.

Examples:
- supplier certificate;
- received PDF;
- scanned document;
- related NF reference.

MVP does not include automatic extraction/OCR/XML parsing.

Documents must remain associated with the correct lot.

---

# 10. Lot availability / simple Quality gate

Use a simple lot state model:
- AWAITING_RELEASE;
- AVAILABLE;
- BLOCKED;
- EXPIRED.

Default recommendation:
quality-sensitive received material begins as AWAITING_RELEASE.

Only AVAILABLE lots participate in normal FEFO allocation.

Full laboratory inspection and COA workflows are outside MVP.

## Durable rules confirmed at implementation (Receiving + Lots)

- Receipt is created already confirmed — no persisted DRAFT. Once created it
  is historical/read-only; there is no edit endpoint and no physical delete.
  It stays legible even if the Supplier or Item involved is later
  inactivated (reads are never filtered by `active`).
- `Lot.initialReceivedQuantity` is only how much arrived in that specific
  receipt — never a current balance. There is no `currentQuantity`/On Hand
  on Lot; physical balance is deferred entirely to the future Inventory
  Movements ledger. Lists and screens referring to this value are always
  labeled "Recebido", never "Saldo".
- Supplier lot (`ReceiptLine.supplierLot`/`Lot.supplierLot`) and internal
  lot (`Lot.code`, `LT-YYYYMMDD-NNNNNN`) are always two distinct fields; the
  supplier's identification is stored as given (trimmed only), never
  replaced by the internal code.
- Quality gate at receiving time: `Lot.status` starts `AWAITING_RELEASE`
  when `Item.requiresQualityRelease` is true, `AVAILABLE` otherwise. Only
  two explicit transitions exist this delivery — release
  (`AWAITING_RELEASE → AVAILABLE`) and block (`AWAITING_RELEASE|AVAILABLE →
  BLOCKED`, reason required) — never a free-form status PATCH. `EXPIRED` is
  computed for display (`expiryDate < today`) whenever relevant, not written
  by any job/scheduler.
- Over-receipt is prevented by locking the `PurchaseOrder` row
  (`SELECT … FOR UPDATE`) inside the confirming transaction before summing
  `ReceiptLine`s and comparing against `orderedQuantity` — simple row
  locking, not full `SERIALIZABLE` isolation.
- A lot with an `ACTIVE` Material Reservation cannot transition to
  `BLOCKED` in this phase — a `RELEASED` Production Order may be counting
  on it, and blocking would silently corrupt that commitment.

## Documentary quality — CoA and attachments (capability 37)

- **Operational quality and documentary quality are different things.**
  `Lot.status` says whether the lot can be used; `Lot.coaStatus` says
  whether the certificate arrived and was approved. Neither replaces the
  other.
- The CoA belongs to the **lot** — not to the supplier, not to the item,
  not only to the receipt: the certificate qualifies the physical lot that
  was received. One receipt with several lines produces one documentary
  status per lot.
- `Item.requiresCoa` is the current configuration; the lot freezes it as
  `requiresCoaSnapshot` at creation. Changing the item tomorrow never
  reclassifies lots that already exist. It is a concept independent of
  `requiresQualityRelease` and is never inferred from it.
- A lot of an item that requires a CoA never starts as `AVAILABLE`, even
  when manual quality release is not configured.
- **Approving the CoA does not release the lot.** The flow is: receipt →
  stock on hand → CoA pending/received → CoA approved → the Quality
  operator releases explicitly → available. There is no automatic
  documentary release.
- Uploading a document moves `PENDING` to `RECEIVED`; it never approves.
  Approving without an active CoA document is refused. Approval and
  rejection are restricted to Quality/Admin — Purchasing may attach, not
  decide. The reviewer always comes from the session.
- Rejection requires a reason, and if the lot was operationally available
  it is blocked in the same operation. Nothing about the CoA ever creates
  an inventory movement: On Hand never changes.
- A lot that requires a CoA and is not approved is not eligible for FEFO,
  reservation, picking or consumption — the rule lives in the same
  eligibility function as quality and expiry, not scattered as ad-hoc ifs.
- Attachments are auditable evidence: never hard-deleted, only archived,
  keeping who uploaded and who archived. Files never live in a public
  directory, the user's filename never becomes a path, and download goes
  through the authenticated API.
- Only CoA gates operations. Label art and technical sheets are reference
  documentation and block nothing.
- Legacy data is never classified automatically: the historical "laudo"
  column is read as validation statistics only, never written back into
  master data.

---

## Durable rules — quality decisions on a lot

- **Release, block and unblock are QUALITY/ADMIN decisions.** The routes
  accepted any authenticated session, so a commercial user could release a
  lot waiting on its certificate with a single request while attaching that
  certificate already required the quality role. The screen matches: the
  action is absent for other roles, with the reason in its place.
- **BLOCKED is not terminal.** A block made by mistake used to strand real
  physical material outside available stock forever, with a permanent
  critical alert and no action on any screen. Unblocking returns the lot to
  `AWAITING_RELEASE` — **never straight to `AVAILABLE`**. Reopening the
  decision is not making it: release stays a separate act, still requires an
  approved certificate where the item demands one, and stamps its own
  authorship. The previous block stays in the record, and no quantity becomes
  available as a side effect.

---

# 11. Physical location

MVP includes **simple physical location**.

Examples:
- warehouse/area;
- rack;
- shelf/position.

Keep it simple:
- no advanced WMS;
- no waves;
- no routing optimization.

A lot can show a current location.

Movement history should make location changes traceable if/when implemented.

---

# 12. QR and supplier barcode

QR Code is part of MVP.

Recommended QR payload:
`LOT:<internal-lot-code>`

or an equivalent immutable lookup identifier.

Do not encode mutable values such as:
- current stock;
- lot status;
- supplier name;
- current location.

The application resolves current data from the database.

Store optional supplier barcode/external code when available.

Future functionality may use supplier barcode to accelerate PO/item lookup.

---

# 13. Label

Minimum human-readable lot label:
- Veridi Nutrition;
- item;
- item internal code;
- supplier lot;
- internal lot;
- expiry;
- simple location when known;
- QR.

Do not rely on QR alone.

MVP printing may use browser-printable label layouts.

## Durable rules confirmed at implementation (QR / Label / Scan)

- QR payload (`LOT:<internal-lot-code>`) is an immutable identifier only —
  it never encodes quantity, status, location, expiry, or supplier; the
  application always resolves current data from the database after lookup.
- QR/scanned/typed input is never trusted beyond identity: lookup is
  read-only, and a fabricated code never creates or mutates a lot.
- MVP printing is browser-only (`window.print()`) — no print server, ZPL,
  or Zebra SDK integration yet.
- The label stays human-readable without a scanner and never shows
  available/reserved balance, price, full PO, or other financial data.
- Lot scanning always offers manual code entry alongside the camera —
  camera access is never mandatory, and permission is requested only when
  scanning actually starts.

---

# 14. Inventory quantities

For each item/lot distinguish:

## On Hand
Physical quantity currently recorded.

## Reserved
Quantity allocated to released Production Orders but not yet consumed.

## Available
`On Hand - Reserved`

## On Order
Remaining open quantity on confirmed Purchase Orders.

On Order does not become Available until receiving is confirmed.

Negative On Hand/Available is not silently allowed.

## Durable rules confirmed at implementation

- The `InventoryMovement` ledger is the only source of truth for physical
  quantities. `Lot.initialReceivedQuantity` is never treated as a balance.
  On Hand is always derived (algebraic sum of movements), never a stored
  column on `Item`/`Lot`.
- Available respects the lot's operational status: only `AVAILABLE` and
  non-expired lots count; `AWAITING_RELEASE`/`BLOCKED` still count in On
  Hand but contribute 0 to Available — blocked material never disappears
  from stock. Releasing/blocking a lot never creates an `InventoryMovement`
  — it changes Available, never On Hand.
- On Order is always derived from `ORDERED`/`PARTIALLY_RECEIVED` Purchase
  Order lines' open quantity — never a second persisted quantity.
- Negative stock is prevented structurally: outbound adjustments/loss lock
  the relevant scope (lot, or item when there is no lot) and validate
  against the current On Hand before writing, the same concurrency pattern
  used for Receiving's over-receipt guard.
- `Reserved` is real from Material Reservation onward (sum of `ACTIVE`
  `MaterialReservationLine`s) — never a second persisted quantity.
  `Available = On Hand - Reserved`, never negative. Outbound
  adjustments/loss are bounded by Available, not raw On Hand, from this
  point on — they can never eat into stock a `RELEASED` Production Order
  is counting on.

## Inventory ownership — customer-owned material (capability 35)

Veridi is a private-label manufacturer: part of the material inside the
plant belongs to the customer. Ownership is a property of the **lot**, and
it is deliberately separate from who supplied it.

- Every `Lot` has an owner: `VERIDI` or `CUSTOMER`. A customer-owned lot
  belongs to exactly one Customer; a Veridi lot never has one. The database
  enforces both directions.
- Owner is independent of Supplier: the supplier is who sold the material,
  the owner is who it belongs to. A customer-owned lot usually has no
  supplier at all, and its `supplierLot` is still the manufacturer's lot.
- Customer material **requires lot control**. Receiving customer material
  for an item without lot control is refused — a third party's balance that
  cannot be told apart from Veridi's own stock is worse than no balance.
- Ownership is a historical characteristic of the lot: immutable after
  creation. There is no ownership transfer and no silent owner edit;
  adjustments and stock counts never change it.
- **Visibility is not eligibility.** Global inventory views keep showing all
  physical stock, with the owner made explicit; only allocation filters by
  owner. Aggregate "available" is never presented as Veridi's without
  distinguishing ownership.
- Eligibility for a Production Order requirement: `VERIDI` responsibility
  considers only Veridi lots; `CUSTOMER` responsibility considers only lots
  of that order's customer. Customer A never supplies customer B, and
  Veridi material never covers a customer requirement (nor the reverse).
  Quality, expiry, On Hand, Reserved, FEFO and FIFO fallback all keep
  working exactly as before — owner is one more eligibility criterion.
- Lot substitution in Picking respects the owner: the same item is not
  enough.
- A Production Order with customer-supplied requirements cannot be released
  without a customer: without it there is no eligible stock at all.
- Shortage of customer material never becomes a Purchase Suggestion or a
  DRAFT Purchase Order — it is "waiting for the customer to send". Veridi's
  On Order never covers it either.
- Customer material has **no Veridi acquisition cost**. That is not
  "unknown cost": it is third-party property. It stays out of the order's
  material cost, and cost quality is judged only over Veridi components —
  `null` never becomes `0`.
- Finished-goods ownership is unchanged in this capability: production
  output lots stay Veridi.

---

# 15. Inventory movement ledger

Operational inventory history must be auditable.

Initial movement concepts:
- RECEIPT;
- PRODUCTION_CONSUMPTION;
- ADJUSTMENT_IN;
- ADJUSTMENT_OUT;
- LOSS;
- RETURN_TO_STOCK;
- FINISHED_GOOD_PRODUCTION.

Reservations may be modeled separately from physical inventory movements, but they must be traceable.

For important movements keep:
- item;
- lot;
- quantity;
- type/direction;
- source entity;
- timestamp;
- user;
- reason/notes where required.

Never "fix" history by editing past quantities invisibly.

---

# 16. Physical inventory / stock count

Simple stock count is inside MVP.

Workflow:
1. select item/lot or counting scope;
2. record physical counted quantity;
3. compare with system On Hand;
4. show variance;
5. require reason if different;
6. confirm;
7. create auditable adjustment movement.

Do not directly overwrite On Hand.

Advanced cycle-count scheduling remains future scope.

## Durable rules confirmed at implementation

- Manual adjustment and stock count never edit a balance directly — both
  only ever create `InventoryMovement` rows (`ADJUSTMENT_IN`/
  `ADJUSTMENT_OUT`/`LOSS`), reason required whenever there is a difference
  or an outbound quantity.
- A stock count with no difference creates no movement at all — nothing to
  audit when the count matches the system.
- A stock count whose counted quantity would fall below the currently
  reserved quantity is rejected — the system never resolves this
  automatically by cancelling a reservation; the user must review
  reservations first.

---

# 17. FEFO

Default selection policy:
**First Expire, First Out**.

Allocation logic:
1. include only AVAILABLE lots;
2. exclude expired/blocked/awaiting-release lots;
3. order by earliest valid expiry;
4. allocate from earliest lot;
5. continue across additional lots until requirement is satisfied.

One production requirement may use multiple lots.

The UI must state the recommendation in text:
`Recommended — expires first`.

Do not use color alone.

## Durable rules confirmed at implementation

- FEFO is the default strategy for lot-controlled items with expiry
  tracking. FIFO (earliest receiving date) is the fallback for
  lot-controlled items that don't track expiry — same service interface,
  strategy chosen from the item's own `controlsExpiry` flag. Items
  without lot control have no lot to choose; the service returns
  availability directly, never a fabricated lot.
- Only a lot that is effectively `AVAILABLE` (status plus computed
  expiration, not just the persisted status) and has On Hand greater than
  zero participates in an allocation — `AWAITING_RELEASE`/`BLOCKED`/
  expired lots are excluded even if the database still says `AVAILABLE`.
- The allocation suggestion is purely a recommendation/calculation — it
  never reserves stock, never deducts stock, never creates an
  `InventoryMovement`, and nothing about it is persisted. It reuses the
  exact same On Hand/Available/lot-eligibility rules as the Inventory
  screens — never a parallel/divergent interpretation.
- On Order never satisfies a physical allocation need — material not yet
  received is excluded from allocations even when it appears informative
  elsewhere (e.g. the Inventory overview).
- A user will eventually be able to substitute the suggested lot with a
  different one (in Picking/OP): FEFO is the default recommendation, not
  a rule that makes any other AVAILABLE lot with stock impossible to use.
- Since Material Reservation, allocation is computed against net
  availability (`On Hand - Reserved` per eligible lot), never raw On
  Hand — a lot another OP already reserved contributes only its
  remaining unreserved balance to a new suggestion or RELEASE.

---

# 18. Formulations

A formulation belongs to a product.

A formulation version contains the official:
- raw materials;
- packaging;
- component quantities;
- output/basis quantity as needed.

MVP lifecycle:
- DRAFT;
- ACTIVE;
- INACTIVE.

An ACTIVE version is historical and immutable.

To change an active formulation:
1. create a new version;
2. edit new DRAFT;
3. activate;
4. keep previous version.

Old OPs never change because a new formula is activated.

## Durable rules confirmed at implementation

- A formulation belongs to the Product, never directly to the finished-
  product Item. A version snapshots its output (item id/code/name/unit)
  at creation/copy time — it never depends on the Product's *current*
  finished-item association, so a later re-link on the Product never
  changes how a historical version reads.
- Only one `ACTIVE` version per Product at a time, enforced at the
  database level (not just in application code).
- `ACTIVE`/`INACTIVE` versions are immutable by construction — no edit
  endpoint accepts them. The only way to change a formulation is to
  create a new version from the active one.
- Components are only `RAW_MATERIAL`/`PACKAGING` — never
  `FINISHED_PRODUCT`. A component's unit may differ from the item's
  stock unit as long as the dimension is compatible (UOM), reusing the
  existing UOM service — never a second conversion system.
- `basisQuantity` defines the version's production base ("these component
  quantities yield `basisQuantity` of finished product") — decimal only,
  never a JS float.
- A version preserves the exact output/component data it was
  created/copied with — it stays historically correct even if a
  component's Item is later inactivated or renamed.

### Industrial formulation v2 (capability 34)

- A version declares a **calculation mode**: `FIXED_BASIS` (original
  model, still the default) or `PER_DOSE` (industry practice: quantity
  per dose × doses per package). `PER_DOSE` requires `dosesPerPackage`.
- Each component declares its own **basis** — `FIXED_BASIS`, `PER_DOSE`
  or `PER_FINISHED_UNIT`. Packaging is per finished unit even inside a
  per-dose formula. There is no formula expression engine.
- `purityPercentApplied` and `overagePercent` are **snapshots** on the
  component, re-frozen on the Production Order requirement. Editing
  `Item.defaultPurityPercent` afterwards never rewrites an existing
  formulation or an existing Production Order.
- Purity `null` means **unknown**: no correction is applied. It is never
  treated as 100%.
- Physical requirement = theoretical ÷ (purity/100) × (1 + overage/100),
  always in Decimal. Theoretical and physical are both persisted on the
  requirement, so the shop floor sees what was corrected and why.
- Legacy reference fields (historical total / unit / batch units) are
  documentation of the imported spreadsheet line — never inputs to any
  calculation.

### Industrial production order and recipe sheet (capability 36)

- The order keeps two identities: `code` (`OP-000123`) is the internal
  identity, and the **official annual number** (`023/26`) is the document
  number. The official number is allocated on the first transition to
  RELEASED — a discarded draft never spends numbering — and is immutable
  afterwards. Allocation is concurrency-safe (year row locked), never
  `MAX(number) + 1`.
- RELEASE also freezes the customer snapshot (including full address) and
  the active revisions of both controlled documents. Editing the customer
  or activating a new revision afterwards never rewrites a released order.
- `numberOfParts` (production split into fractions) and the label
  instructions are editable until RELEASE and frozen after it: the recipe
  sheet, the parts and the executed records all depend on them.
- Splitting a requirement across parts is done in Decimal, and the last
  part absorbs the remainder, so the parts always sum exactly to the
  planned total. Only raw materials are fractioned — packaging is never
  split into "a third of a jar" and stays with the order's total.
- A confirmed weighing on the recipe sheet **is** the real consumption: it
  reuses the same `ProductionConsumption` service, so stock is deducted
  exactly once, through the same ledger. `RecipeWeighing` never touches
  inventory by itself; it is the origin and the audit trail of the
  execution. Confirming the same weighing twice never produces a second
  consumption.
- Weighing differences are recorded and highlighted, never hidden and
  never blocked by an invented tolerance — tolerance rules will come from
  Quality.
- Completing a part requires at least one weighing for every planned raw
  material, but never demands an exact match with the plan.
- Shelf life produces a **suggested** expiry (production date + months,
  with calendar month-end handling); an explicitly informed expiry always
  wins, and no expiry is invented when the product has no shelf life.
- The business lot number remains a suggestion built from the configured
  mask; the internal `Lot.code` stays the unique identity, and the user
  can always type a different business lot.

### Customer-owned material (capability 35)

- A component declares a **supply responsibility**: `VERIDI` (default) or
  `CUSTOMER`. This is intent, frozen in the version and copied onto the
  Production Order requirement — never re-read from the current formula.
- A version with a `CUSTOMER` component cannot be activated while the
  Product has no Customer: without a customer the formula is ambiguous.
  The DRAFT stays freely editable.

---

# 18.1 Users, authentication and controlled documents (capability 36)

- Every GMP-relevant action records **who** and **when**. The user comes
  from the session, always. No service accepts `executedBy` as free text
  from the frontend, and a payload trying to name another operator is
  ignored.
- Historical records keep a **name snapshot** next to the user id:
  renaming or deactivating a user never rewrites a document that was
  already printed.
- A user is never deleted — with GMP history behind them, deleting would
  destroy traceability. Deactivating blocks login and invalidates open
  sessions immediately.
- Controlled documents (`R.PRO.002` Production Order, `R.COQ.003` Recipe
  Sheet) exist as **revisions**, not as a document manager. A revision is
  immutable; a new revision deactivates the previous one of the same type
  and the old one stays as history.
- Printed documents show code, revision, revision date, prepared by and
  approved by, plus a "generated by the system" footer. That footer is a
  generation stamp, **not a digital signature**, and the system never
  claims GMP certification or ANVISA compliance.

---

# 19. Production Orders

Suggested lifecycle:
- DRAFT;
- PLANNED;
- RELEASED;
- IN_PRODUCTION;
- COMPLETED;
- BLOCKED;
- CANCELLED.

An OP stores:
- product;
- planned quantity;
- exact formulation version;
- requirements;
- availability/shortages;
- planned lot allocations;
- reservations;
- actual consumption;
- production execution/output events;
- output lot(s).

An OP may be created/planned without sufficient stock.

Default MVP rule:
**insufficient Available stock prevents RELEASE**.

## Durable rules confirmed at implementation (DRAFT/PLANNED slice)

- An OP always preserves the exact `FormulationVersion` used — the
  version reference (plus a historical snapshot of product/finished item/
  version number/customer) is frozen at the moment the OP transitions to
  `PLANNED`, never at creation. While `DRAFT`, the OP always reflects the
  product/formulation's *current* state, live-joined, so the user is
  never shown a stale preview before committing.
- Only `DRAFT → PLANNED` and `DRAFT`/`PLANNED → CANCELLED` are executable
  in this slice; `RELEASED` onward requires Material Reservation and is
  not implemented yet. There is no free-form status PATCH.
- A `DRAFT` referencing a formulation version that stopped being `ACTIVE`
  (a newer version was activated meanwhile) never plans silently against
  the obsolete version — planning fails with an explicit error, and the
  user must update the DRAFT to the current `ACTIVE` version.
- `PLANNED` may exist with shortage — insufficient stock never blocks
  planning, only the future `RELEASE`.
- Cancelling requires a reason and never deletes historical Requirements.

---

# 20. Material requirement calculation

Requirement is derived from:
`formulation component quantity × production factor`

Include:
- raw materials;
- applicable packaging.

For every requirement show:
- Required;
- On Hand where useful;
- Reserved;
- Available;
- On Order where useful;
- Shortage.

On Order is informational and must not satisfy a release requirement until physically received.

Do not hide shortages.

## Durable rules confirmed at implementation

- A Requirement persists only the frozen technical need
  (`requiredQuantity`, normalized to the item's stock unit via the same
  UOM service used by Formulations — no second conversion service). On
  Hand/Reserved/Available/On Order/Shortage are never stored columns —
  always calculated live from the same `inventory-ledger.ts` used by the
  Inventory overview and FEFO, so the contract never diverges across
  screens.
- `Reserved` is real from Material Reservation onward — sum of
  `MaterialReservationLine` rows belonging to `ACTIVE` reservations.
  `RELEASED` (a reservation that was let go, e.g. cancelling a `RELEASED`
  OP) never counts. A `RELEASED` OP's own requirement rows never count
  its own reservation as competing against itself — Available shown for
  its own requirements adds back what it already secured, so a
  successfully released OP never displays a false shortage against its
  own already-reserved materials.
- `shortage = max(required - available, 0)`. On Order is shown alongside
  but never reduces shortage — material in transit is not physically
  available.
- No automatic operational rounding is applied to a requirement quantity
  in this phase (e.g. a mathematical need of 4.5 units stays 4.5, never
  silently becomes 5). Closed-packaging/box-multiple rounding is deferred
  to a future phase, only if actually needed.
- The FEFO/FIFO lot suggestion shown per requirement reuses the existing
  allocation service unchanged — a recommendation only, never persisted,
  never a reservation, never altering stock.

---

# 21. Reservation

Reservation happens when an OP is RELEASED.

Reservation reduces Available, not On Hand.

Example:
- On Hand = 100 kg;
- Reserved = 30 kg;
- Available = 70 kg.

Reservation does not equal physical consumption.

Unused reservation must be released.

Reservation creation/release must be transactional.

## Durable rules confirmed at implementation

- Only `PLANNED → RELEASED` executes reservation in this slice; `DRAFT`
  never releases and `RELEASED` never releases twice. There is still no
  free-form status PATCH.
- RELEASE requires every Requirement to be 100% covered by real
  `AVAILABLE` stock (`On Hand - Reserved`, respecting lot eligibility) —
  On Order never counts toward that coverage. If any Requirement is
  short, the whole RELEASE fails and nothing is reserved (no partial
  reservation ever survives).
- FEFO/FIFO is recalculated at RELEASE time against the *current* stock
  state (never the suggestion the UI showed earlier) — same allocation
  service used everywhere else, just run once more, inside the RELEASE
  transaction, under lock.
- Reservation never touches On Hand and never creates an
  `InventoryMovement` — it is a commitment dimension, not a physical
  movement. It is per-lot when the item controls lot (persisting the
  official allocation, `MaterialReservationLine.lotId`) and per-item when
  it doesn't (`lotId` null, never a fabricated lot).
- Concurrency: RELEASE locks every `Item` row involved (`SELECT ... FOR
  UPDATE`, deterministic ascending-id order to avoid deadlock) before
  recomputing availability — two OPs racing for the same limited stock
  can never both succeed; the loser fails with a shortage error and
  nothing is reserved for it.
- Cancelling a `RELEASED` OP requires a reason, moves its `MaterialReservation`
  to `RELEASED` (not deleted — kept historical) in the same transaction as
  the OP's own cancellation, and creates no `InventoryMovement` — nothing
  physical ever happened, so nothing physical needs reverting. Availability
  recovers automatically because `Reserved` only ever sums `ACTIVE`
  reservations.
- Manual stock adjustments/loss and Stock Count can never consume
  reserved stock: outbound movements are bounded by Available (`On Hand -
  Reserved`), and a Stock Count whose counted quantity would fall below
  the currently reserved quantity is rejected outright — the system never
  auto-cancels a reservation to make an adjustment fit.
- A lot with an `ACTIVE` reservation cannot be blocked in this phase — a
  `RELEASED` OP may be counting on it; blocking would silently corrupt
  that commitment. The OP/reservation is never auto-cancelled to allow
  the block.
- Manual unreserve, lot substitution, or editing a reservation's
  allocation do not exist in this slice — a reservation is only born at
  RELEASE and only stops counting when its OP is cancelled. Those
  operations arrive with Picking.

---

# 22. QR picking

Released OP workflow:
1. show expected item;
2. show FEFO suggested lot(s);
3. operator scans internal QR;
4. system validates scanned lot;
5. operator confirms quantity;
6. mismatch is shown explicitly;
7. approved substitution may continue with traceability.

The flow must work on tablet/mobile browser.

If scanned lot differs:
- show expected lot;
- show scanned lot;
- show warning;
- require explicit action;
- record actual lot used.

Never silently accept a mismatch.

## Durable rules confirmed at implementation

- Picking confirms the **whole** `MaterialReservationLine` at once in this
  phase — no partial picking. It never creates an `InventoryMovement` and
  never re-reserves; it only records `pickedAt`/`pickedBy` on the line.
  Reusing the existing QR normalization/lookup (`LOT:<code>` or the bare
  code) — no second lot-resolution path.
- The reserved lot's eligibility (status/expiry) is revalidated again at
  Picking time, not just at RELEASE — a lot that expired or got blocked
  between RELEASE and Picking blocks the confirm even if the operator
  scans exactly the expected code, with an explicit error pointing at
  substitution as the resolution.
- A mismatch (scanned lot ≠ reserved lot) never substitutes silently: it
  surfaces both codes and requires an explicit "use different lot" action.
  Substitution only proceeds before any Picking/consumption on that line,
  and only when a single alternate lot (same item, `AVAILABLE`, not
  expired, not the same lot, with enough net Available) can cover the
  *entire* reserved quantity — no splitting one line across several
  alternate lots in this phase.
- Substitution never overwrites history: the original line is marked
  `releasedAt` (freed, no longer counted in Reserved) and a new line is
  created pointing back to it via `replacesLineId` — genealogy is always
  reconstructable. The new line is born already Picking-confirmed (the
  act of choosing the alternate lot *is* the physical confirmation).
  Reserved for the item as a whole does not change — it is the same
  quantity, just moved to a different lot; only that lot's own
  Reserved/Available shift.
- Substitution is transactional and lock-protected the same way RELEASE
  is (lock the `Item` row before recomputing the alternate lot's net
  Available) — two substitutions racing for the same alternate lot can
  never both succeed.

---

# 23. Actual consumption

Final material deduction is based on **actual confirmed consumption**.

Example:
- reserved = 30 kg;
- consumed = 28 kg;
- consume 28 kg from On Hand;
- remaining 2 kg stays reserved while the OP is still in production (see
  durable rules below — it is not auto-released in this phase).

Actual consumption stores:
- OP;
- item;
- actual lot;
- quantity;
- user/time.

## Durable rules confirmed at implementation

- Consumption requires Picking to already be confirmed on that
  `MaterialReservationLine` — there is no path from Reservation straight
  to Consumption without physical conference (for a no-lot item,
  confirming the separation itself satisfies Picking).
- Consumption can be partial and repeated any number of times, but the
  accumulated quantity for a line can never exceed what that line still
  has reserved (`quantity - already consumed`) — overconsumption is
  rejected outright in this phase, never silently capped.
- Every confirmed consumption creates exactly one `ProductionConsumption`
  (immutable, never edited/deleted) and exactly one `InventoryMovement`
  `PRODUCTION_CONSUMPTION` (outbound, real 1:1 relation) — never a
  generic adjustment endpoint. The lot (when the item controls one) is
  revalidated again at consumption time, independent of what it was at
  Picking time.
- Consuming already-reserved stock never double-counts against
  Available: Reserved (remaining) and On Hand drop by the same amount, so
  Available for the rest of the system stays exactly where it was before
  the consumption — this is centralized in the same `inventory-ledger.ts`
  functions used everywhere else, never a Production-only calculation.
- The **first** confirmed consumption of an OP is what transitions
  `RELEASED → IN_PRODUCTION` (recording `startedAt`/`startedBy`) — there
  is no separate "start production" action in this phase.
- Whatever remains reserved after consumption (e.g. 2 kg of a 30 kg line)
  stays reserved while the OP is `IN_PRODUCTION` — it is never
  auto-released mid-production. Releasing an unused remainder is deferred
  to the future OP-completion flow.
- An OP cannot be cancelled once it reaches `IN_PRODUCTION` in this phase
  — physical consumption already happened, and reversing it needs a
  return/reversal flow that does not exist yet.
- Consumption is concurrency-protected the same way RELEASE is (lock the
  `Item` rows, deterministic order, before computing remaining reserved
  quantity) — two requests racing to consume the same line's remainder
  can never together exceed it.

---

# 24. Partial production

Partial production is allowed.

An OP may contain multiple production/output records.

Example:
- planned 1,000;
- output event 1 = 600;
- output event 2 = 390;
- final produced = 990;
- variance = 10.

Do not force completion after first output.

---

# 25. Finished product

Finished product is inside MVP.

A production output creates finished-product inventory by lot.

Finished-product lot preserves:
- product;
- immutable internal ID;
- Veridi/output lot number;
- OP;
- produced quantity;
- production date;
- expiry when known;
- availability status when applicable.

Automatic Veridi finished-product lot-number generation is deferred until the business rule is formally defined.

---

# 26. Bidirectional traceability

MVP traceability is both backward and forward.

## Backward
Finished-product lot
→ OP
→ actual consumed raw-material/packaging lots
→ suppliers/receipts where available

## Forward
Raw-material lot
→ OP consumption records
→ finished-product lots produced

This is a core MVP requirement.

## Durable rules confirmed at implementation (§24-26, Delivery 15)

- Produced quantity is always `sum(ProductionOutput)` for the OP — never
  a second manual/aggregated column. An Output is only accepted while the
  OP is `IN_PRODUCTION`, must be `> 0`, and can never push the cumulative
  total above `plannedQuantity` (checked under the same row lock used to
  serialize concurrent Outputs on the same OP).
- Every `ProductionOutput` generates exactly one physical stock movement
  (`FINISHED_GOOD_PRODUCTION`), never zero, never more than one.
- Finished product reuses the existing internal `Lot` infrastructure
  (new `origin: RECEIPT | PRODUCTION`) — never a second, parallel lot
  table. A produced lot never requires a Supplier/Receipt and never gets
  a fabricated one.
- The Veridi/commercial lot number (`businessLotNumber`) is always
  user-entered and historical — it never replaces the immutable internal
  `Lot.code`, and is never confused with a supplier lot. No automatic
  generation algorithm exists yet (deferred, per §25).
- A second Output can join an existing finished lot only when it was
  created by the *same* OP, for the *same* Finished Product Item, and is
  not blocked/expired — and, when the item requires Quality release, only
  while that lot has not yet been released (new unreleased production
  never gets mixed into an already Quality-released lot; a new lot is
  created instead).
- The Finished Product Item's Quality gate (`requiresQualityRelease`)
  drives the produced lot's initial status exactly like a received lot —
  `AWAITING_RELEASE` or `AVAILABLE` — reusing the same release/block
  flow; there is no second Quality module for finished goods.
- Completing an OP (`IN_PRODUCTION → COMPLETED`) never requires
  `producedQuantity == plannedQuantity` — partial completion is the
  normal path. Any variance requires an explicit reason. On completion,
  any still-`ACTIVE` reservation for that OP is released in the same
  transaction (historical `RELEASED` status, never deleted) — On Hand
  never changes, only `Available` rises; releasing a reservation never
  creates an `InventoryMovement`.
- Bidirectional genealogy (backward and forward) is built **strictly**
  from real `ProductionConsumption` and `ProductionOutput` rows — never
  from planned Requirement, MaterialReservation, or a FEFO suggestion. A
  lot that was only ever reserved and never actually consumed must never
  appear as "used" in another lot's traceability.

---

# 27. Corrections and auditability

Do not delete or rewrite operational history to hide mistakes.

For material changes preserve:
- who;
- when;
- what;
- why when required.

Inventory corrections use adjustment/reversal behavior.

---

# 28. Deferred/non-blocking decisions

These should not stop early development until their feature is reached:
- exact expiry-warning threshold;
- detailed permission matrix;
- exact Quality-release responsibility;
- finished-product automatic lot-code algorithm;
- loss/yield categories;
- printer/label dimensions;
- detailed report layouts.

---

# 29. Customer Orders & Fulfillment Plan (Block D)

Customer Order, Fulfillment Plan, Finished-Product Reservation and
Suggested Production Orders (22-25) are implemented as of Delivery 16 —
see "Durable rules confirmed at implementation" below. Purchase
suggestion (26), Shipping (27) and Invoicing (28) remain future/not
started.

## Customer Order
Launched internally — there is no customer-facing portal in MVP. Will
eventually hold: customer, products, requested quantities, relevant dates,
status, history. Detailed schema not defined now.

## Fulfillment Plan
Concept: turns commercial demand into an operational view. For each
product conceptually shows: Product, Ordered, Available stock, Reserve,
Produce, Situation. Default behavior: use available finished product
first, produce only the deficit; the user may change the proposal before
confirming operational decisions.

**The Fulfillment Plan is an analysis/projection, never a second source of
truth for stock quantities.** Real facts are always recorded through
reservations, Production Orders, receipts, production, movements and
shipments.

## Finished-Product Reservation
Reserving finished product for a Customer Order removes it from other
orders' availability. Will be linked to the Order and to the
Item/finished product, must use real available stock, must prevent
over-reservation, and must be traceable. When finished-product lot control
exists, physical allocation must also be traceable by lot.

## Deficit and suggested production
When requested quantity exceeds available finished product, the
Fulfillment Plan computes the deficit to produce and may suggest/create
Production Orders in DRAFT. It never auto-releases an OP, never
auto-starts production, never auto-consumes stock — the user reviews and
confirms through the normal Production flow. Suggested OPs keep a link
back to their originating Customer Order.

## Production Order origin (future field)
An OP will be able to identify its origin as `CUSTOMER_ORDER` /
`STOCK_PRODUCTION` / `MANUAL` (displayed as "Pedido do Cliente" / "Produção
para Estoque" / "Manual"). An OP originating from a Customer Order keeps a
reference to it. Do not change the current OP schema until this feature is
actually implemented.

## Material impact
Suggested OPs use the applicable active Formulation to compute raw
material/packaging needs. The Fulfillment Plan should eventually show,
per material: Required, Available, Reserved, On Order, Shortage. "On
Order" stays informative — material not yet received never counts as
available for production release (consistent with section 14/20).

## Durable rules confirmed at implementation (§22-25, Delivery 16)

- A Customer Order is commercial demand only — it is never a source of
  truth for stock quantities. `DRAFT` is freely editable; `CONFIRMED`
  freezes customer/products/quantities via a historical snapshot (same
  pattern as Purchase Order) and is the only status from which the
  Fulfillment Plan becomes available; `IN_FULFILLMENT` happens only when
  a Plan is applied. No free-form status change.
- The Fulfillment Plan is pure analysis/projection — reading it (`GET
  .../fulfillment-plan`) never persists a reservation or an OP. Default
  proposal is stock-first: `reserve = min(ordered, available)`,
  `produce = ordered - reserve`. The user may rebalance reserve/produce
  per line before applying, as long as they sum to exactly the ordered
  quantity — this delivery requires 100% coverage between the two, no
  partial plan.
- Applying the Plan (`POST .../apply-fulfillment-plan`) always
  revalidates availability at that moment under lock — it never trusts a
  client-supplied `available`/`reserve` number as truth. It is fully
  transactional: reservation and generated OPs succeed or fail together,
  never partially applied.
- Finished-product reservation lives in its own context
  (`CustomerOrderReservation`/`Line`) — never reuses `MaterialReservation`
  (which stays raw-material/packaging of a Production Order only). Both
  feed the same central `Reserved` calculation, never a parallel
  calculation per module; finished-goods reservation never creates an
  `InventoryMovement`. Lot allocation for the reservation reuses the
  exact same FEFO/FIFO allocation service used everywhere else in the
  system — no second, finished-goods-only allocation service.
  Blocked/awaiting-release/expired/zero-balance lots are excluded exactly
  like any other reservation, and "On Order" never counts toward
  reservable availability.
  A deficit generates at most one DRAFT `ProductionOrder` per Customer
  Order line (never more, never auto-split), with `origin:
  CUSTOMER_ORDER` and a link back to both the order and the specific
  line. It is created even when the Product has no ACTIVE Formulation
  version — shown as a visible pending item rather than silently blocked
  or silently skipped. The generated OP never auto-PLANs or
  auto-RELEASEs; it follows the exact same manual lifecycle as any other
  OP, and never reserves raw material by itself (raw-material reservation
  still only happens when the user releases the OP through the normal
  flow).
  Material impact simulation for the Plan reuses the exact same
  formulation/basis-quantity/UOM-conversion math used to compute a real
  OP's Requirements (extracted into a shared `computeFormulationRequirements`
  function) — never a second implementation of that math. The same
  material appearing in more than one Product's suggested production
  within the same order is aggregated into a single row. The Plan never
  reserves raw material — it only shows the impact so the user can judge
  feasibility before applying.
- `IN_FULFILLMENT` cannot be cancelled through the simple cancel flow
  while an `ACTIVE` finished-goods reservation or a generated
  `ProductionOrder` still exists — operational commitments already exist
  and must be resolved first; nothing is auto-released or auto-cancelled
  in cascade. A full operational cancellation/replanning flow is future
  work.

## Purchase suggestion (implemented, Delivery 17)
When raw material/packaging is short, the system generates a purchase
suggestion/draft. It never confirms a Purchase Order automatically.
Flow: shortage → purchase suggestion → user reviews/picks Supplier and
quantity → PO DRAFT created (grouped by Supplier) → user confirms the PO
later through the normal Purchase Order flow.

### Durable rules confirmed at implementation

- The Purchase Suggestion is analysis only — `operationalShortage`
  (physical shortage) and `suggestedAdditionalPurchase`/
  `newSuggestedPurchase` (purchase recommendation) are distinct concepts,
  never persisted as source of truth. Both are always recomputed live
  from the real `ProductionOrderRequirement`s of the Customer Order's
  linked, non-cancelled/non-completed Production Orders — never a
  parallel formula recalculation (Requirement is already the OP's
  official technical need), net of real consumption.
- A Production Order's own active material reservation for that specific
  need counts as guaranteed coverage for its own Customer Order — never
  treated as unavailable to itself, matching the same principle already
  used for OP Requirement availability since Delivery 12.
- `On Order` (confirmed POs only, `ORDERED`/`PARTIALLY_RECEIVED` — never
  `DRAFT`) never resolves/reduces physical shortage; it only reduces the
  *suggested additional purchase* (a planning recommendation, not
  physical truth) — the UI must keep these two numbers visually distinct.
- DRAFT Purchase Order lines already linked to a Customer Order are
  always read live (current line quantities, never a frozen snapshot of
  the original suggestion) specifically to avoid suggesting/creating the
  same purchase repeatedly. Cancelling that linked PO hands the need
  back to the suggestion; confirming it moves the same coverage from
  "draft" into "On Order" automatically, with no special integration
  code — both read the current `PurchaseOrder`/`PurchaseOrderLine` state.
- The system never chooses a Supplier automatically (no last-used/
  cheapest/most-frequent heuristic) — the user always picks Supplier and
  quantity per material; quantity is editable and may exceed the
  suggestion (e.g. buying ahead for stock) without being blocked.
- Generation always creates `PurchaseOrder` rows in `DRAFT` status,
  grouped one PO per chosen Supplier (never one PO per item) — reusing
  the exact same `PurchaseOrder` entity/lifecycle, never a second
  purchasing module (`SuggestedPurchaseOrder`/`ProcurementOrder` etc.).
  The generated PO carries `origin: CUSTOMER_ORDER` and a link back to
  the order, navigable in both directions (Order ↔ PO).

## Shipping (implemented, Delivery 18)
When finished product is available: Order → separation (Shipment DRAFT) →
confirmed Shipment. Partial delivery is supported. No advanced
logistics/WMS.

### Durable rules confirmed at implementation (§27)

- Three distinct concepts, never conflated: **reservation** (stock
  committed to the order), **separation** (what a given Shipment DRAFT
  intends to send) and **confirmed shipment** (what physically left).
  Only a CONFIRMED Shipment changes stock — a DRAFT never touches On
  Hand, Reserved or the order's status, and cancelling a DRAFT changes
  nothing.
- A Shipment can only draw from quantity currently reserved **to that
  same Customer Order** — never free stock, never another order's
  reservation, never a production MaterialReservation, never
  On-Order/planned-to-produce quantity. Finished product that was
  produced later must be **explicitly reserved** to the order first; it
  is never auto-reserved just because a ProductionOutput was recorded.
- Confirming a Shipment creates exactly one `SHIPMENT_OUT` inventory
  movement per shipment line (real 1:1 relation), reducing On Hand and
  Reserved together — so shipping already-reserved stock never reduces
  Available twice. `Reserved` from a Customer Order contributes only its
  *remaining* (not-yet-shipped) quantity, computed centrally in the
  inventory ledger, never in a parallel per-module calculation.
- `shippedQuantity` (per order line) and `reservedRemaining` (per
  reservation line) are always **derived** from confirmed ShipmentLines —
  never mutable columns.
- The Customer Order becomes `PARTIALLY_SHIPPED`/`SHIPPED` strictly as a
  consequence of real confirmed shipments; there is no manual "mark as
  shipped" action and no free-form status PATCH. `SHIPPED` means every
  order line had its full ordered quantity physically shipped, and any
  still-active reservation is released in that same transaction
  (`ORDER_SHIPPED`) — never leaving a live commitment behind, and never
  creating an inventory movement for the release.
- Lot eligibility is **revalidated at confirmation time**: a lot that
  expired, was blocked or is awaiting Quality release cannot ship even if
  the reservation predates that change. Physical On Hand is checked too —
  a shipment can never exceed the lot's real balance.
- A reservation whose lot became ineligible can be **explicitly
  reallocated** for its not-yet-shipped remainder (FEFO/FIFO, same
  allocation service). The original line is never deleted — it is marked
  released and the new lines point back via `replacesLineId`; already
  shipped quantity keeps referencing the original line and lot, so
  genealogy is preserved.
- A lot with remaining reserved quantity — from *either* a production
  MaterialReservation or a Customer Order reservation — cannot be
  blocked. Both commitments are checked through the same central
  calculation, never just one of them.
- A CONFIRMED Shipment is historical and immutable: it cannot be edited,
  re-confirmed or cancelled. Undoing a physical exit would require an
  explicit return/re-entry flow, which is future work.
- Future Invoicing is based on **what was actually shipped**
  (`ShipmentLine` quantities of CONFIRMED shipments) — never on the
  originally ordered, reserved or planned quantity.

### Lot identity and shipment verification (Delivery 22)

- A `Lot` belongs to exactly **one** `Item` — structurally, through the
  relation. `LT-PA-001` can never simultaneously represent two different
  finished products.
- A **component lot** (raw material/packaging) may feed several
  Production Orders, and that genealogy is preserved through
  ProductionConsumption → OP → ProductionOutput. It never makes the
  component lot shippable: a shipment of the finished product only
  accepts the **finished product lot** that was reserved to that order.
- A **finished product lot** may serve several Customer Orders at the
  same time. The lot never carries a customer or an order
  (`Lot.customerId`/`Lot.customerOrderId` deliberately do not exist) —
  the commercial context comes from the Shipment
  (Shipment → CustomerOrder → Customer → ShipmentLine → ReservationLine
  → Lot). The same QR is legitimately read on two different shipments.
- `Lot.code` is the unique physical identifier and the QR payload stays
  `LOT:<Lot.code>` — one single pattern for every lot origin. The QR
  carries **nothing else**: no customer, order, shipment, quantity,
  balance, location, status or cost. `businessLotNumber` ("Lote Veridi")
  is a business-facing label shown on the label and screens, never the
  system identity.
- A lot label may show the **produced quantity** (sum of the lot's
  ProductionOutputs). That is history, never the current balance — the
  balance always comes from the inventory ledger.
- FAST MVP **does not serialize units**: there is no QR per pot, capsule
  or unit. 400 units of a lot are one scan plus an explicit quantity, not
  400 reads. A future logistics unit/volume is backlog only.
- A shipment line for a lot-controlled item with quantity > 0 requires
  **physical lot verification** before the shipment can be confirmed.
  Verification answers only "is the right lot physically here?" — it
  never creates an InventoryMovement, never changes On Hand / Reserved /
  Available and never changes the order status.
- Quantity stays a separate decision: the QR says *which lot*, the
  shipment line says *how much*. Quantity is never inferred from a scan.
- A wrong lot is never silently accepted or swapped. The system states
  the expected and the informed lot; changing lots requires the existing
  explicit reservation reallocation.
- Verification is audit only (`verifiedAt`/`verifiedBy` on the shipment
  line) — deliberately not a generic ScanEvent entity. Confirming the
  shipment remains the single physical write-off, and lot eligibility is
  still revalidated at that moment even when verification already
  happened.

## Invoicing (implemented, Delivery 19)
Invoicing reflects what is actually delivered, not the originally ordered
quantity (e.g. order 1000, deliver 600 → invoice 600). Partial invoicing
is supported through multiple shipments. Commercial invoicing and
Brazilian fiscal NF issuance are related but distinct concepts and are
**not** merged — fiscal integration remains its own future evolution (see
`docs/ROADMAP_POST_MVP.md`).

### Durable rules confirmed at implementation (§28)

- Billing is a **commercial/operational** document, never a fiscal one:
  no NF-e, DANFE, XML, SEFAZ, taxes, receivables or payment. The entity
  is deliberately named `Billing` (UI "Faturamento"), never
  `FiscalInvoice`/`NFe`, and the issue dialog states explicitly that the
  action does not issue a Nota Fiscal.
- The billable quantity always comes from a **CONFIRMED Shipment**
  (`ShipmentLine.quantity`) — never from the ordered, reserved, planned
  or produced quantity, and never recalculated from the Customer Order.
  A shipment that is still DRAFT or was cancelled can never be billed.
- In the FAST MVP each Shipment is billed **in full** by one Billing —
  partial billing inside a single shipment is an explicit future
  evolution. A Customer Order still supports partial billing naturally,
  because it can have several shipments (one Billing each). A Billing
  never consolidates multiple shipments in this phase.
- At most **one active Billing (DRAFT or ISSUED) per Shipment**,
  guaranteed by a partial unique index — a CANCELLED billing frees the
  slot so a new draft can be prepared.
- Billing lines are never free: the frontend cannot add/remove a line or
  change quantity, lot, product or unit. While DRAFT only `unitPrice`,
  notes and the external reference are editable; once ISSUED the whole
  document is immutable (correction after issuing is future work).
- **Price is optional and never a gate for issuing.** The MVP has no
  reliable commercial price on the order, so a quantitative billing is
  valid without any price; a price is never invented, and never taken
  from a Purchase Order (cost is not sale price). Prices are BRL when
  informed.
- A total amount only exists when **every** line has a price
  (`hasCompletePricing`) — summing only some lines and presenting it as
  the document total would be misleading. This is the semantics the
  future dashboard relies on: *billed quantity* is always trustworthy,
  *billed value* only when pricing is complete.
- `billedQuantity` per order line is always derived from `BillingLine`s
  of **ISSUED** billings — DRAFT and CANCELLED never count, and it is
  never a mutable column. `unbilledShippedQuantity = shipped - billed`.
- The Customer Order's billing state (`NOT_READY`/`PENDING`/
  `PARTIALLY_BILLED`/`BILLED`) is **derived**, never persisted and never
  merged into `CustomerOrder.status`, which keeps representing only the
  operational/logistics flow. Likewise each confirmed Shipment derives
  `PENDING`/`DRAFT`/`ISSUED`.
- Billing **never** creates an inventory movement and never changes On
  Hand/Reserved/Available: the physical exit already happened as the
  shipment's `SHIPMENT_OUT`. It also never changes the Shipment or the
  Customer Order status.
- A shipment of an order that is only `PARTIALLY_SHIPPED` can be billed
  normally — a fully shipped order is not a precondition.
- Navigation stays bidirectional: Order → Shipment → Billing and back.

## Automation principle
The system may **analyze and suggest** automatically. It must never
**execute irreversible operational actions** automatically. Examples: an
order may suggest a reservation; a deficit may suggest an OP DRAFT; a
material shortage may suggest a purchase/PO DRAFT. Users remain
responsible for confirming reservations, Purchase Orders, OP release,
consumption, production, shipping and invoicing.

## Conceptual flow (not an implementation plan)
Customer Order → check finished-product stock → reserve available product
→ identify deficit → suggest production → generate draft OPs → calculate
raw-material/packaging needs → identify shortages → suggest purchases →
produce → make finished product available → picking/shipping → invoicing.

---

# 33. Industrial master data v2 (implemented, Delivery 25)

First capability of Block F. Enriches Customer, Item and Product with the
attributes the real private-label operation already uses. Master data only:
no formulation maths, no costing, no regulatory rule.

## Durable rules confirmed at implementation

- **`Item.defaultPurityPercent` is only a DEFAULT.** It seeds new
  formulations and nothing else. Capability 34 will freeze
  `purityPercentApplied` on the formulation component, so changing the item
  later must never alter a historical formulation or production order.
- **A null purity means UNKNOWN, never 100%.** No screen, export, print or
  calculation may silently substitute a default. Accepted range when
  informed: `0 < x <= 100`.
- `packagingSubtype` exists only for `type = PACKAGING`; the backend
  rejects it on raw material and finished product.
- `sourceName` (chemical form actually used) and `declaredNutrient`
  (nutritional denomination) are distinct from `Item.name` and from each
  other; packaging normally has neither.
- `Product.shelfLifeMonths` is a **default reference**. It changes no
  existing lot; capability 36 may use it to *suggest* an expiry date at
  production time.
- Industrial product attributes (dosage form, presentation, dose, doses per
  package, units per shipping box, minimum batch) never alter history
  automatically and never block a production order in this capability.
- The dose carries its own unit (`doseUomCode`) because it may differ from
  the finished item stock unit. `minimumBatchQuantity` deliberately has
  **no** unit of its own: it always uses the finished product item unit.
- **`targetAgeGroup` carries no regulatory rule.** It is descriptive master
  data. RDI, %DV, minimum/maximum limits and ANVISA validation belong to
  Block H, which cannot start without a new domain/regulatory validation
  from Product Ownership.
- The Customer address is structured and entirely optional; `zipCode` is
  stored digits-only and formatted for display. A confirmed Customer Order
  freezes the address in its own snapshot, so editing the customer later
  never rewrites an existing document; documents confirmed before this
  capability keep null and are never back-filled.

---

# 30. Block E — Management, Reports & Exports (Dashboard: Delivery 21; Reports: Delivery 23; Exports: Delivery 24)

Product Ownership decision registered during Delivery 18. A **transversal
layer** (steps 29–31), executed only **after** Purchase Suggestion (26),
Shipping (27) and Invoicing (28), and **before** end-to-end validation /
final demo. Nothing here is implemented yet — see `docs/MVP_PLAN.md` for
the official roadmap ordering.

## Durable principles

- Dashboards and reports are **never a source of truth**. They read the
  operational entities that already are.
- KPIs derive from operational entities (orders, lots, movements,
  production, shipments) — never from a parallel aggregate table
  maintained by hand.
- Always distinguish **current state** (On Hand today, open orders now)
  from **period metrics** (produced this month, shipped last week). Mixing
  the two is the classic source of misleading numbers.
- Prefer an **operational cockpit** over complex BI: few charts, mostly
  dense tables and clear numbers that drive a decision today.
- Export rules by surface type:
  - tabular listing → CSV;
  - report → CSV + print/PDF;
  - transactional document → print/PDF;
  - traceability → print/PDF;
  - editing surface → no export.
- Print/PDF output is a **real PDF generated in the browser**
  (`@react-pdf/renderer`, see Printing policy); only physical labels keep
  `window.print()`.
- CSV export always respects the currently applied filters and exports the
  **complete filtered result**, not just the visible page.

## Durable rules confirmed at implementation (Dashboard, §30)

- One read model per management surface (`GET /dashboard?from=&to=`)
  instead of the screen orchestrating a dozen calls. No aggregate table,
  no persisted dashboard field, no cache layer.
- Every period metric counts **documents/events** and uses the document's
  own operational date (`createdAt` for orders, `receivedAt` for
  receipts, `completedAt` for production orders, `confirmedAt` for
  shipments, `issuedAt` for billings) — never `updatedAt`, and never a
  proxy entity (a receipt with five lines is one receipt, not five
  `RECEIPT_IN` movements).
- A monetary aggregate is published **only when every document feeding it
  is complete**. With any incomplete document the aggregate is `null` and
  the surface states that values are incomplete, alongside how many
  documents are complete. A partial sum is never displayed as a total.
- The attention list is fully **derived**: no `Attention` table, no
  persisted severity, no configurable rule engine. Severity comes from a
  fixed map, ordering is severity → date → code (deterministic), and the
  list is capped with the real total shown next to it.
- A lot only becomes an attention item while it still has balance; a
  zeroed lot is history, not a pending problem. Expiry is always the
  effective date, never a persisted status.
- Cost-quality indicators report **how many** documents have incomplete
  cost — they never show money derived from incomplete data.
- The client always sends explicit temporal bounds, so "today" is the
  operator's day rather than the server timezone's.

## Durable rules confirmed at implementation (Reports, §31)

- Every report is a read model over the existing operational entities. No
  report table, no persisted aggregate, no warehouse, no configurable BI.
- **Filters and pagination are separate concepts**: filters define the
  result (and the reported total is the whole filtered result), pagination
  only the returned slice. Exports must ask the same services for the
  complete filtered result — never rebuild output from a rendered page.
- A number shown in two places has exactly one implementation. Material
  shortage lives in a single shared calculation used by both the
  production order document and its report; the order's billing status
  comes from the same derivation the order screen uses.
- Each report filters by the operational date of its own domain (movement
  `occurredAt`, receipt `receivedAt`, consumption `consumedAt`, production
  `completedAt` when completed, shipment `confirmedAt`, billing
  `issuedAt`, order `orderDate`) — never `updatedAt`, and never two date
  meanings mixed silently inside one report.
- Reports never invent a relationship: they navigate the ones that already
  exist. Genealogy is always real consumption and real output.

## Durable rules confirmed at implementation (Exports, §32)

- Export policy by surface: tabular listing → CSV; report → CSV + print;
  transactional document → print; traceability → print; create/edit form →
  no export at all.
- Exporting never creates a source of truth. No export/report record, no
  stored file, no cached CSV: every export runs the same read model with
  the same filters at request time.
- **CSV is generated server-side and always contains the complete filtered
  result** — never the rendered rows, never only the current page. The UI
  page-size cap applies to navigation only; exports use an explicit
  unpaginated path, never an oversized `pageSize`.
- CSV format is fixed for Brazilian spreadsheets: UTF-8 with BOM, `;`
  separator, CRLF, Portuguese headers, pt-BR dates and decimals. Decimals
  come from the stored decimal string, never through a JS float.
- Business codes, CNPJ, barcodes and lot numbers are exported as text and
  never replaced by a technical UUID; file names are readable and
  deterministic.
- User-provided text is neutralized against spreadsheet formula injection
  on export only — the stored value is never altered.
- PDF is generated in the browser by `@react-pdf/renderer` (real A4 file,
  deterministic layout — see Printing policy). FAST MVP has no backend PDF
  engine, no headless browser and no stored PDFs.
- Printed reports carry the whole filtered result, plus the report name,
  the filters actually applied and the generation timestamp. No user name
  is invented while there is no authenticated identity.
- Printed documents show the historical snapshot the document already
  froze, never the current master data; a DRAFT prints clearly marked as
  such; and the Billing print always states that it is not a Nota Fiscal.
- Unknown money is never printed or exported as zero: the CSV cell stays
  empty and the print shows "—". Incomplete pricing/cost keeps its
  semantics — a known subtotal is labelled a subtotal and the cost quality
  travels with the number.

---

# 31. Material cost foundation (implemented, Delivery 20)

Operational costing base, established **before** any dashboard/report
tries to show money. Deliberately stops short of accounting/finance.

## Three distinct concepts — never collapsed

1. **PO price** (`PurchaseOrderLine.unitPrice`) — expected/negotiated.
2. **Effective acquisition cost** (`ReceiptLine.actualUnitCost`) — the
   real cost reference of the material actually received.
3. **Amount actually paid** — future financial layer (accounts payable),
   explicitly out of scope. Never inferred from cost or from the PO.

Guiding principle: *first know what the material/product cost; only later
evolve to know when and how much money actually left the cash register.*

## Durable rules confirmed at implementation

- The PO price is **never** copied into real cost automatically, and
  **never** used as a silent last-resort fallback. It may be shown as a
  visual reference while receiving (and an explicit "use the PO price"
  action is acceptable), but cost only becomes real when a human states
  it. If there is no real cost history, the answer is `NO_COST` — not the
  PO price.
- Cost is **always optional**: a physical receipt never fails for lack of
  cost, and the effective cost can be informed later, through a costing
  operation that never reopens the physical document (it can never change
  quantity, item, lot or supplier).
- Unknown cost is `null`, **never `0`**. A `0` is an explicitly informed
  value (e.g. a bonus shipment) and is never reinterpreted as unknown.
  Negative costs are rejected.
- Cost is expressed **per the item's stock unit**, and updating it never
  creates an inventory movement and never touches On Hand / Reserved /
  Available / On Order. Cost and physical quantity are different
  dimensions.
- Fallback hierarchy, with no other silent step:
  `REAL → ESTIMATED_30D → ESTIMATED_90D → LAST_REAL_COST → NO_COST`.
- Averages are **weighted by received quantity**, never simple averages
  (10 kg @ 10 + 90 kg @ 20 is 19, not 15), and only ever consume
  ReceiptLines whose cost was actually informed — never PO prices,
  earlier estimates, billing prices or finished-goods costs.
- The reference date is always respected: receipts **after** it never
  enter the calculation, so a historical query (e.g. the cost of an old
  consumption) never uses purchases that happened later. For a production
  consumption the reference date is its own `consumedAt`, never "today".
- Production material cost is computed strictly from the
  `ProductionConsumption` actually recorded — never from Requirements,
  Reservations, FEFO suggestions or the planned formulation. **The lot
  actually consumed wins**: its effective cost is the absolute priority
  (`REAL`), and only when that lot has no informed cost does it fall back
  to the item's history. A consumption with no lot can never be
  classified as `REAL` — there is no traceability to a specific
  acquisition.
- A formulation cost is **always an estimate**, even when every component
  has a recent real reference — a formula is a plan, not an outcome. It
  is never persisted inside the version: the formula is historical and
  immutable, the cost reference is not.
- Cost quality is always explicit (`REAL`/`ESTIMATED`/`PARTIAL`/
  `NO_COST`) and **a partial cost must never look complete**: when some
  items lack a cost, the known subtotal is reported separately and the
  total stays unavailable rather than under-reporting.
- Material cost per produced unit always divides by the **actually
  produced** quantity (sum of `ProductionOutput`), never by the planned
  quantity — that is what makes yield/loss show up naturally. With no
  production yet, the unit cost is unavailable rather than a division by
  zero.
- Improving data is allowed and desirable: informing an acquisition cost
  later automatically upgrades the quality of past production costs. The
  old estimate is never frozen just to prevent that improvement.
- All costing arithmetic uses Decimal, never JS floats. Prices are BRL.
- Finished-product cost comes from its Production Order — never from a
  Billing sale price. Cost and sale price are never mixed, and **no
  margin/profit is computed** in this phase (other cost components are
  still missing).
- Freight/landed cost is not modelled yet; the concept is deliberately
  named *effective acquisition cost* so goods + attributable freight +
  directly attributable expenses can be folded in later without breaking
  the schema. Packaging is normal material cost, exactly like raw
  material.

---

# 34. Commercial provenance: accepted quote → customer order (implemented)

## The question the model must answer

"Why was this order closed at this price?" — months later, without anyone
reconstructing the negotiation from memory. The chain is
Order → Quote → Quote line → Pricing tier (when applicable) → Cost calculation,
navigable in both directions.

## Durable rules

- **The order never recalculates.** It does not look up the current pricing
  version and does not rebuild the deal from today's CMV. A newer pricing
  version, a newer cost calculation or a fresh purchase never rewrite what the
  customer accepted. Confirming an order applies the operational lifecycle
  only — it touches no commercial snapshot.
- **MANUAL stays MANUAL.** A line priced by hand keeps `MANUAL` as its origin.
  No pricing version is matched retroactively, because none took part in the
  negotiation.
- **The global discount is not spread across lines, and is appropriated in the
  billing header** (qualified by Product Ownership, 2026-09-09,
  BILL-DISCOUNT-01b). `agreedUnitPrice` stays true: no line ever carries a net
  price nobody agreed to, and line prices, discount, subtotal and total remain
  side by side on the order. What changed is that the discount now *reaches*
  the invoice. Each Billing appropriates its share in the header
  (`discountAmount`), and the Billing that **closes the order commercially**
  absorbs whatever is left so the active billings reconcile exactly with the
  agreed net total.
  - "Closes" is coverage, not chronology: it is the document after which every
    order line's billed quantity reaches the ordered quantity, counting only
    ACTIVE billings (ISSUED, not cancelled). It is computed at issue time and
    never persisted as a flag.
  - Appropriation is **cumulative**, never `round(gross × percent)` per
    document: each billing appropriates the discount the order should have
    reached by its accumulated gross, minus what previous ones already
    appropriated. A hundred R$ 0,01 invoices at 50% appropriate R$ 0,50 in
    total, not R$ 1,00.
  - The closing document also carries `commercialAdjustmentAmount` — positive,
    zero or negative. It is **not** discount and is never hidden inside it. It
    exists because every line closes at two decimals: splitting `3 × 33,3333`
    across three documents yields 99,99 against the order's 100,00 **even with
    zero discount**. One reconciliation covers both sources.
  - An ISSUED billing is immutable: its appropriation is frozen and never
    recomputed when later documents appear. A cancelled billing leaves the
    active set, and whichever document restores full coverage becomes the new
    closing one.
  - A **price override** is a deliberate commercial exception, and the gap
    between agreed and billed is its evidence. Reconciliation targets
    `agreed total + override delta`, so the closing adjustment absorbs
    rounding only — never the decision.
  - Durable invariant: for an order fully billed by active billings,
    `Σ Billing.totalAmount == CustomerOrder.agreedTotalAmount`, exactly, with
    no epsilon. Where the order carries no frozen commercial condition
    (typed-in order, no quote), nothing is appropriated and the document is
    worth what its lines sum.
- **The payment plan is frozen as its result, not its parameters.** The
  parameters live on the quote and no longer change after acceptance, but the
  arithmetic translating them into instalments is code. Recomputing years
  later under a different formula would produce a plan nobody signed. This is
  provenance, not accounts receivable — no financial module is implied.
- **One accepted quote yields at most one order.** The invariant lives in the
  database as a unique index over a nullable column, so manual orders (null)
  never collide. Repeating the action reopens the existing order rather than
  raising a conflict the user did not cause.
- **Gates.** The quote must be ACCEPTED and the project APPROVED. The second
  is not bureaucracy: `Product.lifecycle` only becomes operational on
  approval, and generating earlier would bypass it.
- **Scope.** Only lines of the accepted quote enter. A product marked
  OUT_OF_SCOPE at approval stays out.
- **Units must match.** If the quote's unit differs from the finished
  product's, the operation stops. Converting would change the quantity without
  changing the agreed unit price, and the order would stop representing the
  agreement.
- **A derived order does not renegotiate.** Product and quantity are frozen —
  changing them means a new quote version. Delivery date and internal notes
  stay editable; they are operational, not part of the deal.
- **Manual orders remain first-class.** Creating an order directly is still
  valid and requires no retroactive quote; it simply has no commercial origin.
- **Confidentiality.** Identity travels to the order (quote code, pricing
  code, tier). Cost, margin, markup and commission do not — those stay the
  quote's internal economics.

---

# 35. Formulation templates (implemented)

## The rule

**Um Template de Formulação é uma matriz técnica versionada usada para criar
Formulações de Produto. O uso de um template gera uma cópia independente.
Alterações posteriores no template nunca modificam automaticamente
Formulações, CMV, Estruturas de Custos, Precificações, Orçamentos, Pedidos ou
OPs existentes.**

## Why copy and not link

Pointing several products at the same live formulation would have cost less
code. It was refused because the first change one customer asked for would
rewrite another customer's recipe, and the discovery would happen in
production — the one place where a wrong batch cannot be undone.

## Durable rules

- **Using a template copies.** New rows, new ids. Nothing is shared with the
  template or between products that used it. There is no sync, no bulk update
  and no "apply to all products" — those features would break the rule above.
- **Versions.** DRAFT edits, ACTIVE is history, ARCHIVED leaves the library.
  Changing an active version means creating a new one; the previous stays,
  because formulations point at it. One ACTIVE version per template, enforced
  by a partial unique index. One DRAFT at a time — two would be two technical
  truths in edit, and the second activation would silently erase the first.
- **Only ACTIVE versions can be used.** A draft is work in progress nobody has
  reviewed.
- **The empty V1 is filled, not bypassed.** A technical product is born with an
  empty draft; using a template fills it. If the target already has components,
  a new version is created and the previous one is left untouched — never
  overwritten.
- **Supply responsibility is a suggestion.** Who supplies each material changes
  per customer. The copy carries the template's value as a starting point and
  the product can change it without touching the library.
- **Units are catalog codes, in the Item's dimension (FORM-UOM-01).** The
  template's base unit and every component unit are `UnitOfMeasure` codes —
  never free text. A component unit has the dimension of the Item's stock
  unit, the same `isUomCompatible` rule the product formulation applies; the
  template has no output Item, so any catalog code serves as its base. The API
  refuses the rest by name, activation re-checks every component, and the API
  never picks a unit for the caller: changing the Item while keeping an
  incompatible unit is refused, not corrected.
- **Applying a template preserves the base's physical quantity
  (TEMPLATE-APPLY-BASE-UOM-01).** The formulation reads its base in the
  finished Item's unit. Same unit: the number is copied. Same dimension: it is
  converted through the catalog factors, in Decimal — 1 kg becomes 1000 g,
  never 1 g. Different dimension: the application is refused and nothing is
  created; mass never becomes count or volume without a rule (density, weight
  per unit) the domain does not have. Per-base components are copied as they
  are — they describe a proportion of the base. What counts per finished unit
  (per-dose or per-unit components, doses per package) cannot cross a unit
  change without changing physical size, so that application is refused too.
- **Nothing commercial travels.** No customer, no project, no quote, no cost
  structure, no calculation, no pricing, no order. A matrix meant to be reused
  across customers cannot carry the name of one of them, so the template's name
  is chosen by whoever creates it.
- **Saving a formulation as a template is a copy too.** The original does not
  move, convert or change owner, and the template starts as a DRAFT so someone
  reviews before it is reused.
- **Provenance, not a channel.** `FormulationVersion.originTemplateVersionId`
  records where the recipe came from, with code and number frozen alongside so
  the label survives the link. Changes never flow back through it.
- **A newer template version is announced, never applied.** There is no
  "update to V4" that overwrites: overwriting would rewrite a recipe that may
  already have backed a cost, a price and a production order. The path is
  compare, then create a new formulation version.
- **The cost engine never reads a template.** CMV, cost structures, pricing,
  quotes and orders keep reading Product → FormulationVersion. A test asserts
  that no operational table carries a foreign key to the template tables.
- **Legacy.** Formulations created before this capability keep a null origin.
  No backfill, no template invented from the existing corpus.

## Deliberately not built

Parameterised templates — placeholders, 30/60/90 variables, configurable
formulas, dynamic fields, sub-templates, inheritance, a product configurator.
A template is a versioned structured copy. See the backlog entry.

---

# 36. Cost structure and pricing policy templates (implemented)

## The two rules

**Um Template de Estrutura de Custos é uma configuração industrial
reutilizável. Ele não contém preços, tarifas ou valores calculados. Ao ser
aplicado, gera uma Estrutura de Custos independente do Produto.**

**Uma Política de Precificação é um conjunto reutilizável de regras
comerciais (faixas, margem alvo, comissão). Ela não contém preços. Preços
são sempre calculados sobre o custo real do Produto.**

## What each library holds — and what it refuses to hold

A cost template (TEC) carries the base output quantity, which resources are
used and how much of each, the energy mode and its resource, plus the typed
premises of the structure (services, overheads, secondary packaging). It does
**not** carry a tariff, a price per hour, or any computed cost. It says "use
the encapsulator for 4 hours"; what an hour is worth is resolved by
`IndustrialResourceRate` on the calculation's reference date.

A pricing policy (TPP) carries quantity bands, target contribution margin and
commission. It does **not** carry a price. Price is produced by the same
pricing engine the manual path uses, over that product's own CALC.

## Why the exclusions are the point

A tariff frozen into a template would be a number with no date. Copied into
ten products and read six months later, it would quote machine time at last
year's rate while the resource registry showed the correct one, and nothing on
screen would explain the gap. Keeping the tariff out means an old template
still produces a current cost.

A price frozen into a policy is worse: it is another product's cost wearing a
commercial decision's clothes. The same policy on a product whose input costs
R$ 10/kg and on one at R$ 25/kg must give different prices — that is the whole
reason a policy is a rule and not a table of numbers.

## Consequences that hold

- **Applying copies.** A cost template application creates a new
  `IndustrialCostVersion` in DRAFT with its own code and its own resource
  usage rows. A policy application creates a new `PricingVersion` over a CALC
  the user chose. Neither is a link.
- **Copies carry no snapshot.** The copied usage rows have no
  `rate*Snapshot`. Those are frozen where they have always been frozen: when
  the *structure* is activated.
- **Manual price is never a policy.** Saving a pricing version as a policy
  keeps only the bands priced by target margin. Bands with a typed price are
  dropped, and the screen says why: a typed price is a decision about one
  negotiation, not a reusable rule. A version with no rule-based band is
  refused outright.
- **No price without a preview.** Applying a policy shows, before writing
  anything, the prices it would produce *for this product* over the chosen
  CALC — computed by `computePrice`, so preview and application cannot drift.
- **A busy draft is not overwritten.** A product may hold one cost draft. If
  one is open, applying a template returns `cost_draft_in_use` (409) naming
  it, instead of silently replacing work in progress.
- **Provenance, not a channel.** `IndustrialCostVersion.originCostTemplateVersionId`
  and `PricingVersion.originPricingPolicyVersionId` record where each came
  from, with code and number frozen alongside. Nothing flows back.
- **A newer version is announced, never applied.** Both screens offer compare
  and create-a-new-version. There is no in-place update: the current version
  may already explain a cost, a CMV, a price and an order.
- **The engines never read a library.** Cost calculation, CMV, pricing,
  quotes and orders keep reading Product → structure → CALC. A test asserts
  that no operational table carries a foreign key to the template tables.
- **Legacy.** Structures and pricing versions created before this capability
  keep a null origin. No backfill.

## Deliberately not built

A "Product Blueprint" that would bundle formulation + cost structure + pricing
policy into one applicable package. Each library stands alone; composing them
is a later decision. See the backlog entry.

## §37 — Formulation assumptions are never implicitly zero

Found by the real operational audit VAL-LEG-01, in production. A formulation
version in `FIXED_BASIS` mode carried four `PER_DOSE` components and a null
`dosesPerPackage`. The engine read the assumption as `dosesPerPackage ?? 0`,
every component resolved to zero required quantity, and the industrial cost
calculation reported **"Complete — real purchase references"** with a material
subtotal of R$ 0.00. Hand arithmetic for that batch says R$ 370.42.

The durable rule:

> **Mandatory formulation assumptions never receive an implicit zero. When
> components depend on doses per package, `dosesPerPackage` must be explicitly
> informed and positive before activation and before calculation.**

What follows from it:

- **The component's basis decides, not the version's mode.** A `FIXED_BASIS`
  version with one `PER_DOSE` component needs doses. Reading only the version
  mode is what let the original defect through, and the same mistake existed
  in the formulation template guard.
- **Absence is refused, not priced.** `computeComponentRequirement` throws
  `FormulationContextIncompleteError` rather than returning a quantity. A
  number that looks like a requirement and is not one is worse than an error.
- **Three barriers, not one.** Activation refuses the version; the cost
  structure raises a `FORMULATION_DOSES_MISSING` blocking pendency; the
  calculation fails closed — no material lines, no `COMPLETE_*` quality, no
  direct industrial cost. A legacy version activated before the gate existed
  still cannot produce a complete cost.
- **A misleading calculation is not persisted.** Saving returns 409. A partial
  calculation that says what it does not know is a legitimate document; one
  that never asks the price of material is not.
- **Drafts may be incomplete.** That is where the assumption gets informed.
  The screen shows the pendency; `ACTIVE` is never born invalid.
- **Nothing is inferred.** Not from the project, not from the product name,
  not from the basis, not from history. `createNewVersionFrom` keeps copying
  the legacy null forward — the recovery path is V1 ACTIVE → V2 DRAFT → inform
  → activate V2, with V1 preserved exactly as it was.
- **No destructive migration.** Existing active versions are not deactivated
  and no doses are invented for them.

## §38 — Operational rules from the VAL-LEG-01 hardening

### A new cost version copies assumptions, never results

`IndustrialCostVersion` created from an existing one carries the reference
base, the manual cost lines, the resource usages, the energy calculation mode
**and the resource chosen to price derived kWh**. It carries no rate snapshot,
no calculation, no cost result and no reference date — those belong to the
activation and to the calculation date, and copying them would freeze
yesterday's tariff into tomorrow's document.

The energy resource was the one assumption left out. The consequence was
measured in production: the new version reported `Completa`, the calculation
came back `PARTIAL` with energy `—`, and the operator had to create a further
version to re-pick the same resource. Related: derived energy with no tariff
resource is now a **blocking pendency**, because kWh without a tariff is a
quantity, not a cost.

### Purchasing does not depend on project approval

A purchase order can be created and confirmed while its project is still in
development. Raw material enters generic stock, not a project reservation, and
buying is driven by stock, lead time, MOQ, aggregate need and commercial
opportunity — none of which wait for a quote to be accepted. There is no
`Project APPROVED → PurchaseOrder` gate, and adding one would model a
constraint the business does not have.

### Historical import never renews an expiry date

A 2023 expiry stays 2023. The importer does not shift dates forward so that
legacy lots become usable, because a lot that expired did expire — the
inventory would then offer material that no one decided to accept.

Two contexts, never mixed: **historical import** preserves the original date;
**simulation** may create a future date, entered explicitly by the operator and
labelled synthetic. Opening balance refuses to bring an expired lot in as
`AVAILABLE` (`EXPIRED_OPENING_LOT`) — the balance may enter, the availability
may not.

### Unparseable address data gets no false precision

The legacy address is one string; the ERP wants street, number and district.
The importer parses the patterns the corpus actually uses and stops there.
What it cannot assert stays `null` and raises `ADDRESS_PARSE_REVIEW_REQUIRED`,
with the original text preserved in the migration notes.

No `S/N`, no number `0`, no district "unknown". A field that looks answered is
never revisited, so false precision costs more than an empty one.

### Availability explains itself

When physical is greater than available, the inventory row states which lots
are holding the difference and why — awaiting quality release, pending CoA,
blocked, expired or reserved. Causes come from the real lots and follow the
domain's own precedence; an expired lot is not "awaiting quality" merely
because it is also unreleased. Nothing is inferred from `available === 0`.

### A registration form asks for what its grid shows

Item × Supplier is created with qualification, preference, price and minimum
order in the same action, inside one transaction, with everything validated
before the first write. All four stay optional — a relation with no offer is a
legitimate record, and the screen says "sem oferta cadastrada" rather than
implying completeness. The offer remains its own immutable entity; what
changed is when it may be informed, not how it is stored.

Qualification history records what happened: a relation born approved is one
`null → APPROVED` event, not an invented `PENDING` that never existed.


## §39 — Rules from the first end-to-end case (VAL-LEG-01)

The first real order went from customer to invoice through the published UI.
It passed, and it left three places where the domain was right but the system
gave the operator no way to say so.

### Consuming beyond the reservation is explicit, never automatic

Real consumption stays capped by what is reserved. That cap is what stops one
order from helping itself to free stock and to stock another order is holding.

What was missing was the legitimate path for the most ordinary variance on a
shop floor: a little more was weighed than the formula called for. That event
now has an act of its own — the operator asks for the extra material, states
why, and the system checks the genuinely free balance of the lot before
enlarging that order's reservation. Only then can it be consumed.

Free stock is never consumed automatically, and stock reserved by another
operation is never touched. Eligibility is the same notion used at release:
owner, quality, expiry. The original reservation line is never rewritten — the
enlargement is a new line beside it, carrying reason, author and timestamp, so
planned, reserved, enlarged and actually consumed all stay readable at once.

Enlarging a reservation is not consuming: no stock moves until the consumption
itself is recorded. Completing or cancelling the order releases an unconsumed
enlargement exactly like any other reservation — nothing is left stranded.

### Billing inherits the price the customer agreed to

A billing line is created with `agreedUnitPrice` copied from the order line —
the price frozen when the quote was accepted. Not today's pricing version, not
a recalculation from current cost. A later PREC, a new CALC or a future
negotiation never rewrite what was already agreed.

`unitPrice` is what is actually billed. It is born equal to the agreed price
and only differs after an explicit override, which requires a commercial or
administrative role and a mandatory reason, and which preserves the agreed
price beside it. The difference between the two is the evidence; replacing one
with the other would destroy it. Billing exactly the agreed amount is not a
divergence, so returning to it clears the override rather than recording one.

Where no price was agreed, the quantitative billing document remains valid and
the price is informed by hand, as before. Nothing is invented to fill the gap.

### Partial fulfilment keeps its balance and offers a way to close it

Shipping less than ordered leaves the order partially fulfilled, and every
view says so. The order now also offers the next step: a production order for
the balance that still needs to be *made*.

That balance is not "ordered minus shipped". Quantity already covered by
reserved finished goods, by an open production order, or by goods those orders
have already produced and not yet reserved, is not pending production —
suggesting an order for it would produce twice. The planned-minus-produced of
a *completed* order is production variance, not a promise, and does not count
as coverage.

It is never automatic. Shipping partially generates no order by itself; the
operator decides. The new order hangs from the same order line as the first,
so an order can show several production orders without losing provenance.

### Traceability shows destination without polluting genealogy

A finished lot's traceability reaches the customer order, customer, project
and the shipments that carried that lot — in a section of its own. Commercial
destination is not material origin, and merging the two would read as if the
customer had supplied something.

## §40 — Rules from the pre-client hardening round

Three deep cases (VAL-LEG-01, 02, 03) ran end to end before this round. What
follows are the rules their findings turned into.

### Customer-supplied material only ever sees its own owner's stock

For a component whose `supplyResponsibility` is `CUSTOMER`, availability,
shortage, FEFO and reservation are computed **only over lots belonging to the
same customer**. Veridi stock of the same item never substitutes, and another
customer's stock never counts.

This was already true where it reserves — the Production Order — and was not
true where it projects. The Fulfilment Plan summed every lot of the item
regardless of owner: 1.5 kg belonging to customer A plus 1.0 kg belonging to
customer B was presented to A's order as 2.5 kg available and "no shortage",
while the OP created moments later found 1.5 and the shortage. A projection
that promises material the factory cannot use is worse than no projection.
Both readings now come from the same owner scope, and a test holds them equal.

A customer material with no resolvable customer has **no** eligible stock —
the shortage is the whole requirement. Nothing is quietly covered by someone
else's lot.

### A Veridi purchase order never covers a customer material

`On order` is a Veridi commitment. For `CUSTOMER` components it is always
zero, and the plan shows "—" rather than a number that would suggest the gap
is already being closed by a purchase we made.

### Customer material has no Veridi acquisition cost, and none can be recorded

Material the customer sends is physically consumed and physically necessary,
and it carries **no** acquisition cost of ours. Screens say "não aplicável",
never "sem custo informado" — the second reads as a field someone forgot to
fill.

The action to set a cost does not exist on a customer-supplied receipt line,
and the service refuses it: *"Materiais fornecidos pelo cliente não recebem
custo de aquisição Veridi."* A number recorded there would enter reporting as
a purchase we never made.

### Genealogy names the owner, not an empty supplier

A consumed customer lot appeared in traceability with supplier "—", which
reads as *unknown supplier*. The material origin column now says "Material do
cliente" with the owner's name, distinct from a Veridi supplier — in the
screen and in the printed document.

### Money is never re-derived from a formatted number

Agreed prices carry four decimals; screens show two. Any total recomputed
from the displayed value disagrees with the document the server will issue —
147 × 9,7203 is R$ 1.428,88, not R$ 1.428,84. The line total and the document
total come from the same server value, and the draft shows what issuing will
produce. A local preview exists only where the operator is typing the price,
and there the typed value *is* the precision.

### An expanded reservation is auditable on screen

Extra consumption records reason, author and timestamp. Those three fields
were persisted and shown nowhere, which made the mandatory justification
invisible to whoever audits. The reservation line now carries a "Consumo
extra" marker with the added quantity, reason, author and time — on the order,
in picking, in the consumption table and in the printed order. Ordinary lines
show none of it: no empty audit columns.

### Shortage offers the path to purchasing where it is detected

When the plan finds a Veridi shortage it offers the same supplier analysis
the purchase suggestion already provides — qualified suppliers, preferred
one, current offer, MOQ — without leaving the order. It is planning, not
buying: no purchase order is created. Customer-material shortage gets no
purchase call to action, because buying does not resolve it.

### An empty optional number means "not informed", never zero

Optional integer fields treat an absent key as *no change*, an empty string or
`null` as *cleared*, and `0` as an error. Coercing `""` to `0` made a product
born without units-per-box impossible to edit at all — the failure named a
field the user had not touched.


---

## §41 — Cliente: identificação, contato e autoria

### CNPJ tem duas formas válidas, e nenhuma delas é "14 dígitos"

Desde a IN RFB nº 2.229/2024 circulam o CNPJ numérico e o alfanumérico, cujas
12 primeiras posições podem conter letras (`00.000.000/E08G-12`). Os dois
dígitos verificadores continuam numéricos.

Um único algoritmo atende aos dois: o módulo 11 de sempre, com o valor de cada
posição sendo `código ASCII − 48`. Isso mantém `'0'..'9'` valendo `0..9`, então
o numérico é caso particular do alfanumérico.

Consequências que não podem ser desfeitas por conveniência:

- **normalizar nunca remove letras.** `replace(/\D/g, "")` transformava um CNPJ
  alfanumérico válido em oito caracteres sem sentido, gravados como identidade
  de alguém;
- **o campo é texto**, nunca `type="number"`;
- **o dígito verificador é conferido.** Contar 14 posições aceitava qualquer
  transposição de dígito, e o número errado seguia para documento e
  faturamento;
- a busca por CNPJ vale para as duas formas.

O que isto **não** afirma: que a empresa existe. Não há consulta à Receita, e
validade estrutural não é prova cadastral.

### Contato preenchido tem que ser contato

E-mail e telefone continuam **opcionais**. Preenchidos, precisam ser reais:
e-mail com formato válido, telefone brasileiro **com DDD** — 10 dígitos para
fixo, 11 para celular. Guardados só com dígitos, como CEP e CNPJ; a máscara é
da tela. A tela valida para o operador ver o erro ao lado do campo; o servidor
revalida porque o formulário não é a única porta de entrada.

### Serviço externo não decide se um cadastro pode existir

O endereço é preenchido a partir do CEP por consulta externa. Toda falha —
CEP inexistente, timeout, indisponibilidade, rede — termina em "preencha
manualmente", nunca em cadastro bloqueado.

O preenchimento automático toca apenas campo vazio ou campo que a consulta
anterior escreveu; o que o operador digitou é dele. **Número nunca é
preenchido automaticamente**: a consulta não sabe qual é, e um número errado
com aparência de correto é pior que um campo vazio — a mesma razão que já vale
para o endereço legado (§38).

### Autoria vem da sessão, e ausência de autor não vira palpite

`createdBy`/`updatedBy` do Cliente saem do usuário autenticado, nunca de campo
enviado pelo cliente HTTP. Visualizar não altera autoria; ativar/inativar
altera, porque é alteração persistida.

Registro anterior a esta capacidade, ou importado do legado, fica **sem autor**
e a tela diz "Não disponível". Atribuir esses registros a quem rodou a
migration inventaria um fato auditável.


---

## §42 — Consulta do Cliente: o contexto não se perde por clique

### Dentro da Consulta, o Cliente é a raiz da navegação

Um clique comum em Projeto, Pedido ou Faturamento abre o detalhe **dentro do
contexto daquele Cliente** — o cabeçalho continua na tela e a trilha volta
para a lista daquele Cliente, nunca para a lista global do módulo. A saída
para a tela operacional acontece **apenas por ação explícita** ("Abrir …
completo").

A alternativa — clique comum levando ao módulo — é o comportamento dos
atalhos de "Ver relacionados", que continuam existindo e continuam levando
ao módulo. São duas intenções diferentes: acompanhar o Cliente e ir trabalhar
no módulo. Nenhuma das duas substitui a outra.

### O contexto vive na URL, nunca em estado global

O Cliente da Consulta é o `:customerId` da rota. Refresh, deep link, aba nova
e o Voltar do navegador funcionam por consequência, e nenhum módulo
operacional passa a carregar a noção de "cliente atual" — estado global de
cliente contaminaria Pedidos, Estoque e Produção com um contexto que não é
deles.

### O id da URL nunca basta

Uma entidade só aparece sob um Cliente se pertencer àquele Cliente. Endereço
bem formado apontando para registro de outro Cliente responde **404** — o
mesmo 404 de "não existe", porque distinguir os dois casos entregaria a
informação que o recorte existe para proteger. O escopo de dono do material
do Cliente é o já existente, nunca um filtro paralelo.

### A Consulta é somente leitura

Nada de editar, confirmar, produzir, expedir, emitir ou liberar lote. Ações
transacionais continuam nos módulos operacionais, que continuam sendo a única
autoridade sobre elas. A Consulta também não recalcula dinheiro: total
faturado nasce linha a linha no módulo de Faturamento e não é somado aqui em
paralelo.


---

## §43 — Produto e o seu item de produto acabado

### Produto pertence a um Cliente

Um Produto tem um dono, e só um. Dois Clientes com o mesmo produto técnico
— "Cafeína 60 cápsulas" para os dois — são dois Produtos, cada um com o seu
item de produto acabado. O reuso entre Clientes acontece por **Template de
Formulação**, nunca compartilhando Produto ou item.

A exigência vale na **criação**. Produto importado do legado sem cliente
resolvido continua editável: exigir o vínculo na edição tornaria
inalteráveis registros que já estão em uso.

### O Produto cria o seu item de estoque

No fluxo normal ninguém cadastra o item de produto acabado à mão. Ele nasce
com o Produto, na mesma transação, com código da sequence oficial
(`PA-000123`), controle de lote, validade e liberação da Qualidade. Item e
Produto continuam entidades separadas — o item responde por estoque, o
Produto por cliente, formulação, custo e preço —, mas o usuário só cadastra
um dos dois.

Vincular um item existente continua possível pela API, para importação e
migração, e é validado: precisa ser do tipo produto acabado, estar ativo e
não pertencer a outro Produto. O banco garante o 1:1.

### Produto em uso não muda de Cliente

Havendo pedido, ordem de produção, orçamento ou origem em projeto, o
Produto não migra para outro Cliente: isso reescreveria em silêncio de quem
era aquele histórico. O caminho é cadastrar um Produto do outro Cliente.
Produto ainda sem uso pode ser corrigido.


---

## §44 — Consulta do Cliente e navegação

### A Consulta responde por produtos e por estoque, não só por documentos

Além de projetos, pedidos e faturamentos, a Consulta do Cliente mostra os
**Produtos** daquele Cliente e o **Estoque** ligado a ele, em duas visões que
não se misturam:

- **Produtos acabados** — estoque da Veridi produzido para aquele Cliente. É
  da Veridi até ser expedido.
- **Materiais do cliente** — material de propriedade DELE guardado aqui.

Matéria-prima da Veridi não aparece em nenhuma das duas. Ela é da Veridi, e
listá-la sob o cabeçalho de um Cliente afirmaria que pertence a ele. MP
continua visível em formulação, ordem de produção e rastreabilidade, onde a
pergunta é outra.

Físico, reservado e disponível vêm do inventory ledger — as mesmas funções do
resto do sistema. Um segundo cálculo seria um segundo número para a mesma
pergunta.

### Breadcrumb global é hierarquia, não histórico

Fora da Consulta, o breadcrumb das telas mostra a **hierarquia lógica** do
sistema — `Produtos > PROD-000001`, `Ordens de Compra > OC-000011` —, não por
onde a pessoa passou. Pai só existe quando a rota realmente carrega esse
contexto; inventar um pai falso ensina uma estrutura que o sistema não tem.

### Dentro da Consulta, a raiz continua sendo o Cliente

O Customer Shell é a exceção deliberada: ali a trilha é `Cliente › Produtos ›
PROD-…`, contextual, e não a canônica `Produtos > PROD-…`. Trocar uma pela
outra devolveria ao operador exatamente o problema que a Consulta existe para
resolver — perder de vista de quem se está falando.

---

## §45 — Ajuda contextual e rótulos de ação

### A ajuda de uma tela explica a própria tela, e começa pela ação

Cada tela do ERP tem uma ajuda alcançável pelo botão "Como funciona", que
abre um modal. Ela responde, **nesta ordem**:

1. o que esta tela faz;
2. quando usar;
3. próximo passo;
4. antes de começar;
5. passo a passo;
6. o que o sistema faz sozinho;
7. atenção;
8. termos;
9. exemplo;
10. saiba mais.

Os três primeiros itens formam o **nível 1**, sempre visível e limitado a 80
palavras: é o que responde "o que eu faço aqui?" em cinco segundos. Os itens 4
a 6 ficam abertos logo abaixo. Do 7 em diante é consulta, recolhida.

**Por que esta ordem, e o que ela substitui.** A versão anterior desta regra
mandava começar pelo conceito e apresentar o glossário antes do caminho. Ela
corrigiu um defeito real — uma versão ainda mais antiga explicava só onde a
tela ficava numa cadeia maior ("Produto › Formulação › Custo › Preço") e não
dizia o que a tela na frente da pessoa fazia. A correção, porém, produziu
outro defeito: a auditoria UX-HELP-01 mediu 31 mil palavras de ajuda em que a
resposta útil chegava depois de nove a treze termos de dicionário.

A ordem acima preserva a lição — a **primeira frase** diz o que a tela **é** —
e move o dicionário para onde ele é consultado em vez de lido. O termo difícil
continua explicado dentro do passo em que aparece ("Ative a versão — a partir
daqui ela não muda mais"), e o ⓘ continua no campo.

Tela com mais de um caminho diz **quando** cada um vale — "qual desses é o meu
caso?" é a pergunta que vem antes de qualquer etapa. No modelo novo isso é
"Quando usar"; no modelo anterior, fluxos nomeados.

**Tamanho.** Todo tópico declara uma classe: `S` até 250 palavras, `M` até
500, `L` até 800, e o nível 1 até 80 em qualquer uma. Os tetos são testados.

**Conceito compartilhado.** Ideia que serve a mais de três telas é escrita uma
vez em `apps/web/src/help/concepts/` e citada, nunca copiada.

O conteúdo vive em `apps/web/src/help/content/`: um arquivo por módulo para os
tópicos ainda no modelo anterior, um arquivo por tela para os já migrados. Os
dois modelos convivem e o painel reconhece qual está lendo; a migração é por
tela. Testes de contrato e de padrão editorial cobram cada modelo pela sua
estrutura.

Como se escreve um tópico está em [`UX_HELP_GUIDE.md`](UX_HELP_GUIDE.md).

### Toda tela roteada abre um "Como funciona", e ele descreve a tela que está aberta

Cada tela do menu — lista, documento e tela de criação — abre uma ajuda. A tela
de criação abre a **mesma** ajuda da lista, porque é o fluxo "cadastrar" dela
que descreve o formulário. Lista e documento com ações diferentes têm tópicos
diferentes: a fila de faturamento não emite, a lista de ordens não libera.

Duas exceções, aprovadas em UX-HELP-02:

- **Tela de criação com fluxo próprio ganha tópico próprio.** "Receber
  material do cliente" não tem ordem de compra, não tem fornecedor e não tem
  custo; abrir nela a ajuda do recebimento de compra apresenta como primeiro
  caminho um que não existe ali.
- **Seção com decisão própria ganha painel próprio**, com rótulo que diz o
  quê ("Como funciona o Orçamento"). São seções onde a pessoa decide dinheiro
  ou compromete estoque e cuja explicação não cabe no tópico da tela inteira:
  o Orçamento dentro do Projeto, "Reservar Produto Acabado" dentro do Pedido,
  "Alterar preço de faturamento". O painel da tela continua sendo o primeiro
  do arquivo, e é ele que o teste de contrato confere.

A ajuda cobre os componentes **visíveis** daquela tela — filtros, colunas,
selos, botões, ações de linha, painéis de cálculo, anexos, histórico — e não
descreve componente que a tela não tem. Vocabulário de usuário final, em
português: nada de termo de código na ajuda.

Três testes sustentam isso sem ler frase por frase: o inventário lê as rotas de
`App.tsx` e exige `<ContextHelp>` em toda página da casca; cada tópico precisa
de resumo, vocabulário, caminho e ressalvas; e uma lista curta de termos
técnicos é proibida em todo texto de ajuda. Uma tela nova sem ajuda, ou uma
ajuda que explique o código em vez da tela, quebra antes de chegar a alguém.

### `InfoHint` explica termo; `ContextHelp` explica tela

O ⓘ pequeno ao lado de um rótulo ou cabeçalho de coluna explica **aquele
termo** ("o que é overage", "o que é reservado"). O painel explica a tela. Os
dois se complementam e não se substituem: hint sozinho nunca ensina a tela, e
painel sozinho não responde à dúvida que nasce em cima de um campo.

A bolha do ⓘ é ancorada ao viewport, não ao elemento: o lugar mais comum do
ícone é o cabeçalho de uma tabela, e o container da tabela recorta o eixo Y.

### Qual dos controles do item o Produto decide

O item de produto acabado nasce controlando lote, controlando validade e
exigindo liberação da Qualidade. Esses três são padrão da casa e a tela do
Produto **não** os oferece como opção — oferecer sugeriria que dá para
produzir acabado sem lote, o que o sistema não permite.

`Exige CoA / Laudo` é o único que varia de produto para produto, e por isso é
o único que a criação do Produto pergunta. Fica desligado por omissão: exigir
laudo sem que ninguém tenha pedido travaria a liberação de todo lote
produzido.

Os quatro controles aparecem em leitura na tela do Produto. Alterá-los depois
é operação do cadastro de Itens, com as travas dele — um item que já tem lote
e histórico não muda de regime por formulário de produto.

### Vocabulário de ação

O botão que confirma diz o que ele faz, e diz igual em toda tela:
`Criar <coisa>` para criar, `Salvar alterações` para editar, `Salvar <parte>`
quando o botão grava um pedaço de um documento maior, `Salvar rascunho`
quando o estado salvo é mesmo rascunho.

Em diálogo de confirmação o botão carrega o **verbo curto** e o título
carrega a pergunta. Repetir ali o rótulo inteiro do botão que abriu faz o
confirmar parecer o mesmo botão de novo, e quem lê rápido não sabe se
avançou. A exceção é o cancelamento: "Cancelar" sozinho é lido como
"desistir", que é a ação oposta, então o objeto fica.

---

## §46 — Criar entidade sem perder o formulário

Campo de busca de entidade criável oferece a criação ali mesmo, e devolve a
entidade nova **selecionada pelo id** — nunca pelo texto digitado, que casaria
com o registro errado sempre que dois nomes se parecerem.

O caminho é a TELA OFICIAL de cadastro da entidade — `/cadastros/clientes/novo`
e irmãs. Não existe segundo formulário: os campos vivem num módulo só, usado
pela página e pelo modal de edição. Um cadastro paralelo fica atrás do oficial
em validação e regra, e a divergência só aparece meses depois, num registro
que passou por onde não devia.

O formulário de origem não perde nada. Quem monta um pedido, descobre no meio
que o cliente ainda não existe e o cadastra, volta com data, condição,
observação e linhas como estavam. Cancelar devolve ao mesmo ponto, com o
rascunho de pé e nada selecionado.

Navegar de verdade é o que dá as três coisas que um modal não tem: a tela de
cadastro **sobrevive a um F5**, vale como link e entra no histórico do
navegador. O preço é que o rascunho da origem precisa ser guardado enquanto a
pessoa está fora — vive em `sessionStorage`, por token de uso único levado na
URL, com validade de horas. Não é dado do domínio: é estado de navegação, e
morre com a aba.

A trilha da tela de cadastro permanece canônica nos dois caminhos. De onde a
pessoa veio é caminho de volta — oferecido como ação secundária, "← Voltar
para Pedido" — e não um nível da hierarquia.

### Onde a criação NÃO é oferecida

Não é ausência de recurso; é regra de domínio, e cada caso tem motivo:

- **Contagem física** — a contagem existe contra o saldo do sistema. Item
  recém-criado tem saldo nulo e nenhum lote: não há o que contar.
- **Consumo de amostra** — o serviço recusa consumo acima do disponível.
  Item novo tem zero, então a criação levaria a uma falha garantida.
- **Produto no vínculo de Projeto** — o bloco já tem, ao lado, um modo de
  criar produto que nasce vinculado ao projeto e ao cliente dele, em
  desenvolvimento. Oferecer criação no campo de busca duplicaria o caminho
  vizinho com outra semântica.
- **Produto na Ordem de Produção** — produto novo não tem formulação ativa, e
  a ordem nasceria travada em rascunho. A tela já avisa; criar ali é beco sem
  saída.
- **Filtro de listagem** — criar um cliente para filtrar por ele devolve uma
  lista vazia.

A regra geral: só se oferece criação onde a entidade recém-nascida é
utilizável naquele campo. Onde o domínio a recusaria, a ausência da ação é a
mensagem correta.

---

## §47 — Produção na Consulta do Cliente

A Consulta do Cliente mostra as ordens de produção daquele Cliente, e só as
dele. O filtro é o `customerId` da própria ordem — resolvido na escrita, que
recusa gravar quando o cliente do produto discorda do cliente do pedido.

**Ordem sem cliente não aparece em Consulta nenhuma.** Produção manual sem
pedido pode existir sem dono, e é a maioria do histórico. Mostrá-la sob o
cabeçalho de um Cliente afirmaria que pertence a ele; escolher um dono
provável seria pior ainda. A ausência é a resposta correta, e a tela diz isso
em vez de fingir que não há nada.

### A consulta lê, a ordem completa opera

O que a Consulta mostra é o que responde "o que este cliente tem em
produção": código, situação, produto, pedido de origem, planejado, produzido,
saldo, datas e os lotes acabados com a situação de Qualidade.

Fica de fora, de propósito, a necessidade de material — reserva, consumo,
falta e sugestão de lote. Aquilo responde a outra pergunta, "dá para liberar
esta ordem?", que é ato operacional e mora na ordem completa. Liberar,
apontar, consumir e cancelar não existem aqui: a saída para o módulo é
explícita, nunca um botão de ação embutido na consulta.

### Produzido é soma, saldo não é dívida

Quantidade produzida é a soma dos apontamentos, nunca uma segunda coluna
mantida à mão. Saldo é `planejado − produzido` e **nunca é negativo**:
apontar acima do planejado é variação de produção, não falta — um número
negativo na tela leria como "ainda falta produzir".

### Lote acabado é lista

Uma ordem pode gerar mais de um lote. Hoje não gera, e é por isso mesmo que a
consulta trata como lista: escrever um-para-um transformaria um dado que o
banco aceita num campo que a tela perderia em silêncio no dia em que
acontecesse.

A situação mostrada é a do lote — o material pode ser usado —, não a do
laudo. Aprovar o CoA não libera o lote sozinho, e usar o estado do documento
como se fosse o do material diria que há produto disponível quando não há.

### "Em aberto", não "em andamento"

O recorte de ordens ainda vivas é o que o domínio já tem: rascunho,
planejada, liberada e em produção — o mesmo conjunto que o painel e os
relatórios usam. Não existe um agrupamento chamado "em andamento", e criar um
aqui daria dois números para a mesma pergunta, que divergiriam no dia em que
uma situação nova aparecesse.

---

## §48 — Integridade do que a tela mostra

Duas regras que valem para qualquer tela, e que existem porque as duas foram
violadas em silêncio — o pior modo de falha que um ERP tem, porque o operador
não descobre no momento em que dá para consertar.

### Ativar nunca descarta o que está na tela

Ativar uma versão de formulação grava o que está no formulário antes de
ativar. Ninguém pode ativar uma versão diferente daquela que acredita estar
vendo.

A gravação é **condição** da ativação, nunca efeito colateral dela: se falhar
por validação, por item inválido, por unidade incompatível ou por rede, a
ativação não acontece e a versão continua rascunho, com o erro no campo. Meia
ativação seria pior que o defeito que a regra corrige — versão ativa é
documento histórico, e o que entra errado ali não se conserta, só se substitui
por uma versão nova.

Sem alteração pendente, ativar continua sendo uma operação só. E "pendente" se
mede contra o que o servidor devolveu, não contra "alguém digitou": reeditar
até o valor original não é alteração.

### Enviar nunca congela o que a tela não mostra

QUOTE-SEND-DIRTY-01, 2026-09-10. O envio do Orçamento congela o que está
GRAVADO — condições, preços, cliente —, e isso está certo: o servidor não sabe,
nem deve saber, o que alguém digitou e não salvou. A regra é da interação:
**enquanto houver condição comercial alterada e não salva, a proposta não se
envia.** Ninguém pode ver a condição B na tela e mandar ao cliente a A.

Aqui a regra difere de propósito do "ativar" acima: ativar grava o formulário
como condição da ativação; enviar NÃO grava nada. Salvar e enviar são duas
decisões comerciais, e o envio não oferece "enviar mesmo assim" nem salva
sozinho — ele espera o gravado alcançar a tela, e diz isso ao lado do botão.

"Alterada" é a mesma pendência de "Alterações não salvas", medida por VALOR
contra o que o servidor devolveu: `10,0` sobre 10 não é alteração e não
bloqueia. Salvamento em andamento também bloqueia; salvamento que falha mantém
o bloqueio.

**A regra vale para as linhas também** (QUOTE-SEND-LINE-DRAFT-01, 2026-09-10).
Quantidade, preço e unidade da linha gravam ao sair do campo, e o salvamento
pode falhar. Quando falha, o campo MANTÉM o digitado — a pessoa precisa ver o
que tentou informar, junto do erro —, e é exatamente por isso que o envio não
pode acontecer: a tela mostra um valor que o servidor não tem. Uma linha nessa
situação segura o orçamento inteiro, desde a primeira tecla diferente do
gravado até o gravado alcançar a tela. Pendência é valor contra o gravado, não
foco: o campo focado com o valor gravado não segura nada. Não se descarta o
digitado para destravar, e não se salva por conta própria para enviar.

### Entrada inválida nunca equivale a "não informado"

QUOTE-INT-FIELDS-01, 2026-09-10. Campo vazio é "não informado", e limpar um
campo opcional é decisão legítima. Texto que a tela não consegue ler é outra
coisa, e **nunca vira vazio, zero, número truncado ou arredondado, nem campo
omitido**: fica no campo como foi digitado, com o erro ao lado, conta como
alteração pendente e trava salvar até a pessoa corrigir ou apagar de propósito.
Antes, `abc` no prazo virava `NaN`, o JSON escrevia `null`, e salvar apagava o
prazo gravado.

A tela recusa o que o servidor recusaria, com os MESMOS limites, tirados de uma
fonte só — e o servidor continua recusando por conta própria.

A regra é de toda tela, não do Orçamento: PROJECT-INT-FIELDS-01 (2026-09-10)
aplicou a mesma leitura às doses por embalagem e à vida útil do Projeto. Ali o
limite da API é só "inteiro maior que zero", sem teto numérico a compartilhar.

### Busca de entidade enxerga o conjunto elegível inteiro

Um campo que parece pesquisar o catálogo não pode pesquisar apenas os
primeiros N registros carregados. Item que existe e é elegível tem de ser
encontrável, esteja ele na primeira página ou na décima.

O motivo não é conforto: campo que esconde o que existe, oferecendo "+ Novo"
logo acima, produz **cadastro duplicado** — e duas matérias-primas iguais com
saldos separados são um erro de estoque que ninguém rastreia até a origem.

Achar não é o mesmo que poder usar. A busca torna encontrável quem já era
elegível; ela não altera regra de elegibilidade nenhuma — tipo, situação,
proprietário e saldo continuam decidindo o que o campo aceita, e continuam
decidindo no servidor.

---

## §49 — Reconciliação de material e identidade de documento

### Ordem de Produção não conclui com material por reconciliar

Concluir uma OP passou a exigir que **todo requisito tenha resposta**. Cada
material planejado precisa estar numa de duas situações:

- **consumo real registrado** que cobre a necessidade; ou
- **diferença justificada** — alguém declarou explicitamente por que se gastou
  menos do que a fórmula pedia, e a justificativa fica no documento com autor e
  data.

Antes disso a ordem olhava só para o que SAIU — exigia um apontamento de
produção, e motivo quando se produzia menos que o planejado — e nunca para o
que ENTROU. Uma OP com seis requisitos e um consumo concluía normalmente.

O custo disso não é só rastreabilidade. São três coisas ao mesmo tempo: o lote
de produto acabado nasce declarando seis componentes com registro de um; os
cinco materiais nunca baixam do estoque, então o saldo em livro passa a
divergir do chão **sem nenhum ajuste que registre a diferença**; e o snapshot
de custo congela uma produção que, no papel, quase não consumiu nada.

**"Ninguém clicou em confirmar" e "o material não foi consumido" produziam o
mesmo registro: nenhum.** A regra existe para separar as duas coisas.

### Não há tolerância, e isso é decisão

Consumo abaixo da necessidade exige resposta, qualquer que seja a diferença.
Uma folga percentual sumiria com a diferença pequena, que é como a grande
começa — e o domínio já tomou posição contrária em `RecipeWeighing`:
*diferença é registrada, nunca escondida*.

Consumo **acima** da necessidade não pede nada: sobra explicada não é problema,
e ampliar a reserva já tem caminho próprio com justificativa.

### Motivo de material não é motivo de produção

São perguntas diferentes e as respostas não se substituem. O motivo da
conclusão explica ter **produzido menos que o planejado**; o motivo da
diferença de material explica ter **gasto menos material do que a fórmula
pedia**. Uma OP pode fechar 100% do planejado com falta de material, e
vice-versa. Nunca compartilham campo.

### O portão é do servidor

A tela repete a decisão antes do clique — lendo o mesmo dado que o servidor
usa, para nunca oferecer um botão que o servidor recusa —, mas quem decide é o
servidor. Integridade que depende de quem chamou não é integridade.

### Documento histórico não é reconciliado retroativamente

A regra vale para **concluir**, não para reescrever o que já fechou.
Reconciliar uma OP concluída inventaria uma justificativa que ninguém deu.

### Prefixo de código identifica uma entidade só

O código é o identificador humano: o que se fala, o que se escreve no papel, o
que se digita na busca. Dois tipos de documento com o mesmo prefixo e sequences
separadas produzem códigos idênticos para coisas diferentes — e "confere o
REC-000002" vira uma frase ambígua.

Todo prefixo canônico mora no pacote compartilhado, nunca dentro de um serviço.
Não é organização: foi por estar fora do lugar onde a comparação acontece que
`REC` acabou nomeando Recebimento e Recurso Industrial ao mesmo tempo, por
meses. Um teste de contrato garante as duas coisas — unicidade e localização.

### Entrada decimal em português

O sistema é em português e a pessoa digita `0,85`. Campo decimal aceita vírgula
e ponto; **separador de milhar é recusado**, porque `1.234` é ambíguo e
adivinhar erra por um fator de mil em silêncio, num campo que costuma ser preço
ou peso. Um separador só, seja qual for, é sempre a casa decimal.

A tela normaliza antes de enviar e o servidor valida com autoridade — as duas
coisas, não uma. E a recusa **diz qual é o formato aceito**: "Erro de
validação" foi exatamente o que fez a pessoa redigitar o mesmo valor esperando
outro resultado.

Conta feita no navegador sobre texto digitado passa pelo mesmo tradutor. O pior
caso encontrado não recusava nada: `Number("12,50")` virava `NaN`, a linha
sumia da soma, e o total da Ordem de Compra aparecia **menor do que a ordem
vale** — sem nenhum sinal de linha faltando.

### Mensagem de erro precisa ser ouvida

Erro visível e mudo é erro que não chegou. Toda mensagem de falha carrega
`role="alert"`; condição persistente que explica por que uma ação está
indisponível carrega `role="status"`. A distinção não é decorativa: usar
`alert` para o que fica parado na tela ensina a ignorar o alerta seguinte, que
pode ser de verdade.

## §50 — Precisão do dinheiro, rastreabilidade física e opção de filtro

**Preço unitário e total são dois números com precisões diferentes.** As colunas
de preço unitário são `Decimal(14,4)` e a exibição mostra de 2 a 4 casas,
conforme o preço: `4,0500` lê `R$ 4,05`, `4,0531` lê `R$ 4,0531`. Total de linha
e de documento ficam sempre em 2 casas.

O preço nunca é arredondado antes da aritmética, e nunca é arredondado no banco:
um pedido fechado a `4,0531` guarda `4,0531`, porque esse é o valor histórico do
acordo. Arredondar para melhorar a aparência do documento falsifica o que o
cliente aceitou.

**O total do documento é a soma das linhas impressas**, não a soma dos produtos
cheios. Somar tudo e arredondar uma vez no fim é correto em estatística e errado
num documento: o que o cliente confere são as linhas, e `Σ round(linha)` difere
de `round(Σ linha)` em até um centavo por linha.

Um documento tem de fechar na mão de quem confere. Exibir `R$ 4,05` ao lado de
um total calculado com `4,0531` produz uma diferença que não sai de nenhuma
conta possível com o papel na mão.

**Rastreabilidade de lote é física.** A pergunta "para onde este lote foi?" é
respondida pela relação de saída — `ShipmentLine.lotId` — e nunca pelo Pedido
associado à Ordem de Produção que o produziu. Estoque acabado é fungível: um
lote produzido para um pedido pode legitimamente atender outro, e tratar isso
como anomalia faz a tela responder que o lote não saiu quando ele saiu. Essa é
a pergunta de recall, e ela nunca pode receber uma negativa falsa.

Origem comercial e destino físico aparecem separados: o pedido de origem pode
não existir, e cada saída mostra o pedido realmente atendido, o cliente, a data
e a quantidade.

**Filtro de lista deriva da lista canônica do domínio**, nunca de uma cópia à
mão dentro do schema da rota. Uma tela que oferece uma opção que a consulta
recusa devolve `400` e mantém a tabela anterior com o contador intacto — o
operador lê um resultado que não corresponde ao filtro escolhido. Aceitar
qualquer valor não é a saída: valor inventado continua sendo recusado.

Consultar todo tipo de movimento é auditoria; **criar** qualquer tipo é
falsificação. O schema de criação de ajuste segue restrito a ajuste e perda.

**Quem muda a quantidade em estoque tem nome e papel.** Ajuste e contagem
gravam o usuário real, como recebimento, consumo, produção e expedição já
faziam, e exigem papel — a operação que muda a quantidade não pode estar mais
aberta que a que muda o status do lote.

**Liberação afirma que o lote pode ser usado.** Lote vencido não é liberável:
o status ia para Disponível e a listagem imprimia "Vencido" por cima, com
disponível zero — uma liberação registrada sobre material inutilizável.

## §51 — A referência externa não manda no modelo

O sistema segue o **modelo matemático correto**. Quando a planilha de
referência diverge do sistema, a pergunta é qual dos dois está certo — e a
resposta vem de aritmética, nunca de autoridade. Planilha não é especificação.

**Nunca ajustar o motor de cálculo para "bater" com a planilha.** Um cálculo
alterado para reproduzir um número externo deixa de ser cálculo: vira uma
constante disfarçada, que passa a errar em silêncio em todo caso que não seja
aquele.

Divergência conferida e atribuída a erro da referência é registrada como
`EXTERNAL_DATA_FINDING`, separada de `BUG` no backlog. As duas classes exigem
prova; só uma delas exige mudança de código.

**Caso que originou a regra.** A rodada adversarial comparou o CMV da Coenzima
Q10 — sistema ≈ R$ 11 mil por 1000 potes contra ≈ R$ 2,4 mil na planilha — e
deixou aberta a hipótese de o motor estar errado por um fator de quatro.

Medido depois: `cmv_precificacao.csv` repete `custo_por_1000_unid = 2431.872`
nos **nove** produtos, inclusive na linha chamada `CMV modelo`. Valores
distintos na planilha inteira: um. Creatina, de um componente, não custa o mesmo
que Magnésio Treonato, de lote 20.000 — a aba de precificação nunca foi
recalculada por produto.

Somando os próprios componentes da planilha (`kg_lote × preço_brl_kg`), a
Coenzima Q10 dá **R$ 9.708,23** de material por 1000 unidades. A planilha
contradiz a si mesma, e o número que servia de referência era o do modelo.

Ajustar o motor para R$ 2,4 mil teria quebrado o cálculo de todos os produtos
para reproduzir um valor que a própria fonte não sustenta.

**Como conferir uma divergência:** refazer a conta a partir dos dados brutos —
quantidade, pureza, preço por quilo, tamanho de lote — e comparar os dois
resultados com esse terceiro número. Quem diverge do terceiro está errado,
independentemente de ser o sistema ou a planilha.

## §52 — Quantidade física do componente, e o que a Formulação manda

Cada componente versionado declara **o que a sua quantidade significa**, e a
declaração é explícita porque as duas leituras convivem no dado real e são
indistinguíveis pelo valor: `224,4898 mg` já corrigidos por pureza e `220 mg`
teóricos são o mesmo número para o banco, e a diferença entre eles é 2% de
material.

**Física direta** — a quantidade já é a que a fábrica pesa. Pureza e overage,
quando preenchidos, ficam como documentação auditável e não disparam recálculo.
É o default de componente novo.

**Teórica com ajustes** — a quantidade é a base, e o sistema calcula a física
aplicando **somente** os ajustes marcados:

```
físico = teórico ÷ (pureza/100) × (1 + overage/100)
```

**Registrar um ajuste não é autorizá-lo.** Preencher a pureza deixou de aplicar
a correção sozinho. A regra existe porque o caminho oposto já causava dupla
correção em silêncio: num componente cuja quantidade já vinha corrigida de fora,
preencher a pureza dividia de novo.

Pureza ausente nunca vira 100%, pureza zero não divide, e overage ausente nunca
vira zero implícito — ausência de premissa é cálculo inválido, não resultado
conveniente.

A matemática vive em **um lugar só** e os seis consumidores — plano de
atendimento, tela da Formulação, cálculo industrial, custo da precificação,
estimativa de custo da Formulação e Ordem de Produção — a chamam. Explicação na
tela mostra essa conta; nunca recalcula por conta própria, senão passa a poder
discordar do número que manda.

**Conversão de unidade não substitui o motor.** Converter `mg` para `kg` é uma
ETAPA da matemática, e quem para nela fica sem o fator da base e sem os ajustes.
A estimativa de custo da Formulação fazia exatamente isso: multiplicava o custo
unitário pela quantidade declarada convertida, e num produto de 60 doses
anunciava um material sessenta vezes menor que o que a Ordem de Produção separa
— na mesma tela que mostrava a quantidade certa logo acima. Onde duas telas
representam a MESMA grandeza, o número nasce da mesma chamada; onde representam
grandezas diferentes — por unidade acabada e para a base da versão —, o rótulo
diz qual é qual, porque duas colunas que divergem sem explicação são lidas como
erro mesmo quando as duas estão certas.

Esse lugar é `packages/shared/src/formulation-quantity.ts`, e
`apps/api/src/lib/formulation-math.ts` delega para ele. A conta subiu para o
pacote compartilhado quando a tela da Formulação passou a mostrar o físico
**enquanto se digita**: quem decide a quantidade precisa ver o efeito antes de
gravar, e a alternativa — reimplementar a fórmula no navegador — criaria um
segundo motor cuja resposta seria justamente a que a fábrica vê e ninguém usa.
Não é cópia sincronizada: os dois lados chamam a mesma função, sobre a mesma
biblioteca decimal.

Base que o motor não reconhece **bloqueia**: devolve o motivo, não um número.
Zero ali seria a resposta mais perigosa possível, porque "não precisa de
material" é plausível e ninguém confere.

### O modo é a autoridade; a marca sozinha não autoriza nada

`applyPurityAdjustment` e `applyOverageAdjustment` só têm efeito sob **teórica
com ajustes**. Guardar uma marca ligada sob **física direta** é registro que
mente — o cálculo a ignora, e voltar o modo depois religaria a correção sem
ninguém ter marcado nada. Por isso a marca é desligada ao sair do modo teórico,
na tela **e** no servidor: um cliente que mande a combinação incoerente não
consegue gravá-la. Nenhum resultado de cálculo muda com isso.

O modo viaja em toda gravação da versão. Omiti-lo fazia o servidor reaplicar o
default, e um componente marcado como teórico voltava a físico direto ao salvar
qualquer outra edição — a mudança silenciosa de receita que esta regra existe
para impedir, entrando pela porta dos fundos.

### A Formulação vigente define o futuro; o documento guarda o passado

Uma Ordem de Produção **congela** a necessidade no momento em que nasce, junto
com a versão que a originou, o teórico e os fatores aplicados. Ativar uma versão
nova **não recalcula ordem existente**, e cálculo de CMV salvo não muda.

Duas ordens do mesmo produto com necessidades diferentes é o resultado **certo**
quando nasceram de versões diferentes — não é divergência a investigar. O que
seria defeito é o contrário: a ordem que a fábrica já está separando mudar de
quantidade porque alguém editou a receita.

CMV e Ordem de Produção usam a **mesma** quantidade física quando nascem da
mesma versão e da mesma base. Documentos históricos podem divergir
legitimamente da versão vigente de hoje.

## §53 — Fonte de custo do material: seleção automática, referência manual e substituição por cálculo

### A ordem canônica, num lugar só

O custo unitário de um material num cálculo prospectivo — cálculo padrão da
estrutura, CMV, tela do item, estimativa de custo da Formulação — vem da
**primeira fonte disponível** nesta ordem, e a ordem é regra durável:

1. compra real dos últimos 30 dias (média ponderada por quantidade);
2. compra real dos últimos 90 dias (idem);
3. última compra real;
4. oferta válida de fornecedor homologado;
5. referência manual de custo do Item;
6. desconhecido.

A implementação vive em `apps/api/src/lib/cost-source-selection.ts`
(`selectItemCostSource`) e **reusa** os passos 1–3 da fundação de custos
(`getItemCostReference`), sem reescrever a média nem a `referenceDate`. Nenhum
outro serviço repete a ordem; a tela lê a lista de `@veridi/shared` para
mostrá-la.

**A prioridade é entre categorias.** Ambiguidade dentro de uma categoria de
prioridade maior **não** autoriza pular em silêncio para a seguinte. Dentro
da categoria "oferta válida":

- exatamente uma oferta válida → usa essa oferta;
- várias, e exatamente um preferencial → usa o preferencial;
- várias e nenhum preferencial → **ofertas disponíveis, seleção necessária**
  (`AMBIGUOUS_SUPPLIER_REFERENCE`): custo desconhecido, sem escolher o menor
  preço e sem cair para a referência manual;
- mais de um preferencial → dado inconsistente, tratado igual: ambíguo.

Nesse estado a referência manual só entra **forçada** — escolha explícita no
cálculo, com motivo, usuário, data/hora e a fonte automática registrada como
ambígua no documento. A tela diz o que fazer: definir a oferta preferencial em
Item × Fornecedor, ou escolher explicitamente outra fonte para este cálculo.

Custo do material **realmente consumido** numa OP continua com a regra da
fundação: custo efetivo do lote consumido primeiro, depois o histórico de
compra do item na data do consumo. Referência manual não entra em custo
realizado.

### Referência manual é estimativa, com histórico por vigência

A referência manual (`ItemCostReference`) é uma estimativa declarada por gente:
valor em Decimal, unidade de medida da mesma dimensão do item, válido desde,
observação, quem e quando. Não é compra, recebimento, custo real histórico nem
valor pago. Alterar **insere** uma vigência nova; nada é atualizado nem apagado.
A referência válida numa data é a de maior "válido desde" até aquele dia — um
cálculo histórico encontra a referência que valia na sua data. Duas
referências podem ter o mesmo "válido desde" (corrigir o valor no mesmo dia);
o desempate é canônico e testado (`COST_REFERENCE_VALIDITY_ORDER`): a criada
por último vence, e no empate de instante o `id` maior — arbitrário, mas
estável. Histórico salvo nunca é reinterpretado.

Três estados que nunca se confundem na tela: referência existente ("R$ X /
unidade"), sem referência ("Não informado") e custo não aplicável ("Não
aplicável", material do cliente). Ausência nunca vira R$ 0,00. A tela do item
mostra a referência **e** a fonte que a seleção automática usaria hoje — é
assim que se lê que uma compra real vence a referência.

Definir referência é papel de COMMERCIAL ou ADMIN. Criar o item já com
referência inicial é opcional e atômico: referência recusada não deixa item
criado pela metade.

### Substituição forçada é exceção por cálculo e por componente

O usuário pode forçar a referência manual num cálculo mesmo existindo fonte de
prioridade maior. A substituição é **por documento e por material**: nada
marca o item, a ordem global não muda, e o próximo cálculo nasce automático.
Salvar exige motivo; a prévia pode mostrar o impacto antes do motivo. Forçar
sem referência vigente é recusado; material do cliente não tem custo a
substituir e também é recusado.

O cálculo salvo congela, na própria linha do material: fonte usada
(`MANUAL_REFERENCE_FORCED`), valor e unidade, referência escolhida, fonte
automática que teria sido usada com o seu valor, subtotal automático, impacto
(mesma aritmética da linha: quantidade × custo), motivo, usuário e data/hora.
Reproduzir o cálculo nunca depende da referência de hoje.

### O que a referência manual faz com a qualidade e com o histórico

Cálculo que usa referência manual — automática ou forçada — é **completo com
estimativas**, nunca "referências reais de compra". A qualidade continua vindo
de `REAL_REFERENCE_SOURCES`, que não inclui referência manual nem oferta.

Cálculo salvo não muda: referência alterada depois, ou compra real que entrou
depois, não reescrevem o documento. Um cálculo novo pode usar a fonte nova.

Material de propriedade do cliente continua **não aplicável** mesmo que o Item
tenha referência manual: a referência pertence ao Item; o custo de aquisição da
OP e do CMV depende também de quem é o dono do material.

## §54 — Prévia e número gravado nunca se confundem

Se uma tela permite editar operandos antes de salvar ou confirmar, todo número
derivado exibido junto deles é, inequivocamente, uma de duas coisas:

1. **prévia** — recalculado ao vivo com os valores atuais da tela, pela mesma
   função que o servidor usa (função pura em `@veridi/shared`, ou o endpoint de
   prévia do próprio recurso quando a conta depende do servidor);
2. **gravado** — identificado como pertencente ao último salvamento
   ("Gravado", "Valor do último salvamento", "Atualizado após salvar").

É proibido mostrar dois números de momentos diferentes sem dizer qual é qual.
A prévia nunca persiste, nunca move estoque, reserva ou linha, e nunca é
enviada ao servidor como se fosse dado: quem grava é a ação explícita
(salvar, confirmar, adicionar), e o servidor recalcula ao gravar. Operando
ausente ou ilegível não vira zero na prévia — fica fora e é dito. Vale para a
Ordem de Compra (total previsto), a Expedição (já expedido × expedindo agora ×
restante), a Precificação (prévia da faixa), o Faturamento (total da linha e do
documento antes de confirmar a alteração de preço) e o Orçamento (total da
proposta na versão em rascunho), e é o padrão para as demais telas do
BACKLOG #8.

Onde a prévia depende de operandos já presentes na tela e de uma função pura
compartilhada, ela é calculada localmente — sem requisição por tecla. Endpoint
de prévia é para quando a conta depende de dado ou regra que só o servidor tem.

## §55 — O subtotal comercial fecha com as linhas apresentadas

O total monetário de uma **linha** comercial é `quantidade × preço unitário`
arredondado em **duas casas** — é o número impresso, o que o cliente confere.
O **subtotal do documento** é a soma desses totais de linha **já
arredondados**:

    subtotal = Σ round(quantidade × preço unitário, 2)

e nunca `round(Σ das linhas ainda não arredondadas)`. Com preço de quatro
casas as duas contas divergem em centavos, e o documento tem de fechar
exatamente com as linhas que estão nele: um rodapé que não bate com a soma da
página destrói a confiança no documento inteiro. Nada é arredondado antes da
multiplicação — o preço unitário guarda as quatro casas.

A conta é uma só, em `@veridi/shared`, usada pela API e pela prévia da tela:
`calcularTotaisOrcamento` (Orçamento e o Pedido dele originado) e
`calcularTotaisFaturamento` (Faturamento, incluindo o resumo que aparece
dentro do Pedido). Vale para os documentos **comerciais**. A **Ordem de Compra
segue a mesma forma desde 2026-09-06**, com função própria e regra própria:
§61.

**Documento originado de acordo aceito preserva o acordo.** Quando um
Orçamento aceito origina um Pedido, o Pedido congela exatamente os valores
comerciais daquele Orçamento — preços das linhas, quantidades, desconto,
subtotal, total e plano de pagamento —, calculados pela mesma função que
montou a proposta. O Pedido não recalcula o acordo por outra fórmula, não
consulta a precificação vigente e não usa o CMV atual.

Documento histórico **não é recalculado**: proposta enviada, aceita, rejeitada
ou superada, e Pedido já existente, mantêm o valor que congelaram. Uma regra
nova vale da sua data em diante e nunca em backfill — o valor congelado de um
acordo não muda porque a fórmula mudou depois. Um Orçamento aceito antes da
regra que origina um Pedido depois dela entrega o snapshot daquele Orçamento,
não uma reinterpretação dele.

## §56 — Ausência esperada é estado, não recurso inexistente

Quando o negócio prevê que algo pode não existir — produto sem precificação
vigente, período sem movimento, fila vazia —, a consulta responde **200** com
o estado vazio dentro do envelope do próprio contrato (`{ "pricing": null }`,
coleção vazia), e a tela renderiza o estado vazio normal. **404** fica
reservado para o recurso que de fato não existe.

Responder 404 para um estado normal deixa um erro no console do navegador a
cada consulta de uma tela sã, e uma auditoria de console passa a reprovar uma
página correta. Ausência também não vira valor: nada de `R$ 0,00` no lugar de
"sem preço". E o inverso é igualmente proibido — 403, 404 de recurso ausente e
erro interno continuam distintos, nunca mascarados como "estado vazio".

## §57 — Precisão de armazenamento não é precisão de apresentação

Decisão de Product Ownership de 2026-09-05, sobre a auditoria
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md).

**O banco preserva a precisão que o domínio produz; a tela mostra a que a
pessoa precisa ler.** São duas coisas distintas e nunca se determinam.

Mudar quantas casas a interface exibe:

- não altera dado armazenado;
- não exige migration;
- não recalcula histórico;
- não muda regra de negócio.

**Invariante de campo editável.** Um valor armazenado como `4.053187640000`
pode ser lido na tela como `4,0532`. Mas abrir o campo, não editar e salvar
preserva `4.053187640000` — exatamente, casa por casa. A máscara visual nunca
destrói casa oculta. Um campo que devolve ao servidor o que a máscara mostrou
está errado, mesmo que o número pareça certo.

**Valor técnico nunca nasce de valor arredondado para apresentação.** Custo,
CMV, quantidade física, conversão e precificação são calculados sobre o valor
íntegro. O arredondamento é a última operação, na saída, e o resultado dela não
volta a ser operando.

**Preferência de exibição alcança apresentação e nada mais.** Ela não grava,
não recalcula e não altera regra. Totais documentais fechados seguem o domínio,
nunca o perfil do usuário: um Pedido com Total acordado de `R$ 172,84` continua
`R$ 172,84` para quem escolheu modo técnico.

**Documental fechado não contamina técnico.** Que um total comercial tenha duas
casas por regra de acordo — §55 — não autoriza reduzir a duas casas o preço
unitário, a quantidade, o custo, o CMV ou os fatores que o produziram.

**Campo com teto: o número exibido tem que poder ser redigitado.** Decisão de
Product Ownership de 2026-09-07, sobre o F-08-1. Quando a tela mostra um limite
— reserva remanescente, saldo reservado, disponível — ela mostra o valor
arredondado, que pode ficar acima ou abaixo do real. Comparar o que foi digitado
diretamente contra o limite exato faz a tela recusar o próprio número que
imprimiu.

A regra é de **ida e volta**: digitar exatamente o valor exibido significa "usar
todo o limite", e o que vai ao servidor é o valor **canônico**, íntegro. Digitar
menos continua sendo uso parcial e vai como foi digitado; acima do exibido é
recusado.

Arredondar o teto para baixo **não** é alternativa: consumir menos que a reserva
deixa resíduo, e a reconciliação de material não tem tolerância, por decisão.
Epsilon, `1e-6` e `Math.abs` continuam proibidos — a folga é de leitura, na
borda da interface, e nunca no domínio. A comparação canônica é
`resolverQuantidadeContraLimite`, em `apps/web/src/lib/quantity-limit.ts`;
`Number(digitado) > Number(limite)` na tela reabre o defeito e viola §66.

## §58 — Matriz de precisão numérica por categoria

Decisão de Product Ownership de 2026-09-05, derivada da auditoria. É a
referência para toda coluna numérica nova e para o widening futuro. **Aplicada
ao schema em QUANTITY, FACTOR, TECHNICAL_RESULT persistido (PREC-MIG-A),
UNIT_COST (PREC-MIG-B), PURITY / OVERAGE (PREC-MIG-C), o UNIT_PRICE
operacional da Ordem de Compra (PREC-MIG-P / PREC-P-01) e o UNIT_PRICE técnico
da precificação (PREC-P-TECH: `PricingTier.manualUnitPrice`,
`.suggestedPriceSnapshot`, `.selectedPriceSnapshot` e
`QuoteLine.pricingSelectedUnitPriceSnapshot`), o TECHNICAL_RESULT residual da
precificação (PREC-MIG-D: `PricingTier.commissionPerUnitSnapshot`,
`.contributionPerUnitSnapshot` e `QuoteLine.contributionPerUnitSnapshot`) e o
último elo estreito da cadeia técnica (PREC-MIG-E / PREC-E-01:
`QuoteLine.industrialCostPerUnitSnapshot`).** A matriz está **aplicada ao schema
inteiro**: `14,6` deixou de existir, e o único `18,6` que sobrou é o dado
importado do legado sobre o qual ninguém calcula.

**As colunas em `DECIMAL(14,4)` não são pendência.** Decisão de Product
Ownership de 2026-09-06, na aprovação do PREC-MIG-E: os totais de precificação,
a composição do custo industrial e do CMV **permanecem** em `14,4`, como
TECHNICAL_TOTAL (§63). O que faltava ali era fronteira de fechamento, não
escala. Preço contratual e tarifa continuam em `14,4` por suas próprias regras.

| Categoria | Tipo aprovado |
|---|---|
| QUANTITY | `DECIMAL(24,12)` |
| UNIT_COST | `DECIMAL(20,8)` |
| UNIT_PRICE técnico | `DECIMAL(20,8)` |
| UNIT_PRICE contratual | precisão definida pelo documento comercial |
| PERCENTAGE comercial | `DECIMAL(7,4)` enquanto suficiente |
| PURITY / OVERAGE | `DECIMAL(9,6)` |
| FACTOR / conversão de unidade | `DECIMAL(24,12)` |
| MARKUP / fator comercial | precisão atual enquanto suficiente |
| TECHNICAL_RESULT persistido | `DECIMAL(24,12)` |
| TECHNICAL_TOTAL persistido | `DECIMAL(14,4)` |
| COMMERCIAL_TOTAL fechado | `DECIMAL(14,2)` |

**UNIT_PRICE contratual não é ampliado automaticamente.** Snapshot histórico de
acordo comercial não sofre widening por decisão técnica: o valor que está no
documento assinado é o valor do documento. Decisão de Product Ownership de
2026-09-06, na aprovação do PREC-P-TECH: `QuoteLine.unitPrice`,
`CustomerOrderLine.agreedUnitPrice` e os dois preços de `BillingLine`
**permanecem em `DECIMAL(14,4)`** — quatro casas são a precisão do documento
comercial, e ampliá-las seria decisão comercial, não de precisão.

**MARKUP e percentual comercial não são ampliados sem necessidade
demonstrada.** Quatro casas decidem margem e comissão; mais casas não mudam
decisão nenhuma.

**`DECIMAL(30,12)` foi recusado como baseline.** Não por excesso de casas
decimais, mas por excesso de parte inteira e por incompatibilidade com o motor:
ver §59.

**Precisão acima do scale é RECUSADA, nunca arredondada em silêncio.** Decisão
de Product Ownership de 2026-09-06, na aprovação do PREC-MIG-C, e vale para toda
categoria já migrada. Até o scale da coluna, o valor é aceito e preservado
inteiro; acima dele a fronteira da API responde **HTTP 400** com a mensagem
`Valor com precisão acima do suportado: no máximo N casas decimais.` Aceitar e
deixar o PostgreSQL arredondar é o defeito que a fundação numérica existe para
eliminar — o operador digitava um número e o banco gravava outro sem dizer.
A mudança visível é intencional: um valor mais longo que a coluna passa a falhar
onde antes passava calado.

**Precisão de armazenamento e faixa de negócio são regras independentes.**
`DECIMAL(9,6)` suporta 999,999999 e isso não autoriza pureza acima de 100:
pureza segue `0 < x <= 100` e overage segue `>= 0`. Ampliar uma coluna nunca
amplia um limite de domínio, e nenhuma migration de precisão altera unidade ou
semântica — `98` continua significando 98%, jamais 0,98.

**A recusa vale nos dois sentidos.** O teto não é só do campo técnico: preço
COMERCIAL acima de quatro casas também responde HTTP 400, em vez de ser aceito
e cortado pelo PostgreSQL. Vale para a linha do Orçamento, o preço faturado e o
override de faturamento. Um teto que existe só do lado preciso deixa o defeito
inteiro do lado do documento.

## §59 — Uma configuração canônica de Decimal

Decisão de Product Ownership de 2026-09-05.

A precisão computacional do `decimal.js` deve ser elevada para **40 dígitos
significativos**. O default é 20, e a auditoria mediu a consequência: uma
coluna de 24 dígitos totais guardaria um número que a aritmética do sistema não
é capaz de produzir.

Quarenta é margem sobre os 24 dígitos da maior persistência técnica planejada,
porque as operações intermediárias — multiplicação, divisão, média ponderada,
conversão de unidade, pureza, overage, CMV e precificação — encadeiam antes de
qualquer arredondamento.

**A configuração é uma só, canônica, e não se espalha.** `Decimal.set()` não
aparece em módulo de domínio: existe um ponto de configuração, carregado por
`@veridi/shared` e por `apps/api`, e todo o resto herda. Duas configurações
divergem por definição, e a que está fora do caminho principal é a que fica
para trás.

**Ordem obrigatória.** A elevação da precisão vem antes ou junto do primeiro
widening de coluna. Ampliar a coluna sem ampliar o motor cria coluna que o
sistema não consegue preencher.

## §60 — Preço técnico e preço comercial são dois números, e a passagem entre eles é deliberada

Decisão de Product Ownership de 2026-09-06, na aprovação do PREC-P-TECH.

A precificação produz um **preço técnico**. O documento comercial congela um
**preço comercial**. Não são o mesmo número com formatação diferente: são dois
valores, com precisões diferentes, guardados lado a lado de propósito.

| | Guarda | Responde a pergunta | Onde vive |
|---|---|---|---|
| Preço técnico | 8 casas, `DECIMAL(20,8)` | "qual preço a faixa de precificação produziu?" | `PricingTier.manualUnitPrice`, `.suggestedPriceSnapshot`, `.selectedPriceSnapshot`, `QuoteLine.pricingSelectedUnitPriceSnapshot` |
| Preço comercial | 4 casas, `DECIMAL(14,4)` | "qual preço unitário foi congelado no documento?" | `QuoteLine.unitPrice`, `CustomerOrderLine.agreedUnitPrice`, `BillingLine.agreedUnitPrice` e `.unitPrice` |

Uma linha de Orçamento com `pricingSelectedUnitPriceSnapshot = 4,05318764` e
`unitPrice = 4,0532` **está correta**. O primeiro é proveniência técnica —
interna, nunca apresentada ao cliente como preço contratado e nunca operando de
total. O segundo é o preço do acordo.

**A redução de 8 para 4 casas é FECHAMENTO, não perda.** Um acordo tem a
precisão do documento que o registra. Por isso ela não pode acontecer:

- por scale de coluna do PostgreSQL;
- por formatter de apresentação;
- por conversão para `Number`;
- incidentalmente, num `.toFixed()` que ninguém sabe explicar.

Ela acontece **em código de domínio, num ponto nomeado** — hoje
`fecharPrecoUnitarioComercial`, no vínculo da faixa com a linha do Orçamento. Um
corte de precisão que não se distingue de um defeito acaba "corrigido" por
engano na capability seguinte; um corte com nome e teste é uma decisão que se lê.

**As duas fronteiras declaram `ROUND_HALF_UP`.** Decisão de Product Ownership de
2026-09-06, no hardening do PREC-P-TECH:

- **A.** preço técnico persistido em 8 casas — `ROUND_HALF_UP` **explícito**;
- **B.** preço técnico → preço comercial em 4 casas — `ROUND_HALF_UP`
  **explícito**;
- **C.** nenhuma das duas depende do rounding **default** do `decimal.js`. A
  configuração canônica continua mexendo só em `precision` (§59); o modo viaja
  na chamada.

Metade para cima, afastando-se do zero — o mesmo critério que o PostgreSQL
aplica ao gravar, e nunca banker's rounding. Confiar no default bastava enquanto
o arredondamento era detalhe de biblioteca; virou regra de domínio, e regra de
domínio não pode mudar porque outra capability trocou uma configuração global de
carona. O comportamento publicado é o mesmo: o que deixa de existir é a
dependência.

**Depois do fechamento, ninguém volta.** Pedido e Faturamento recebem cópias
exatas do preço comercial — nenhum elo adiante recupera as oito casas, e
nenhum deles arredonda de novo. O total do documento continua saindo de §55,
sobre o preço comercial: `subtotal = Σ round(quantidade × preço unitário, 2)`.

**Antes do fechamento, ninguém corta.** Toda a cadeia técnica — motor, faixa,
ativação, congelamento da proveniência, CMV, relatórios e prévias — trafega e
serializa as oito casas. Cortar mais cedo destruiria a informação que a
migration existe para guardar; cortar mais tarde faria o documento comercial
prometer precisão que ele não tem.

## §61 — O total da Ordem de Compra fecha com as linhas que estão na página

Decisão de Product Ownership de 2026-09-06, sobre [`BACKLOG.md`](BACKLOG.md)
#18.

O valor monetário de uma **linha** da Ordem de Compra é
`quantidade × preço unitário` arredondado em **duas casas** — é o número
impresso, o que se confere. O **total do documento** é a soma desses valores de
linha **já arredondados**:

    orderTotal = Σ round(quantidade × preço unitário, 2)

e nunca `round(Σ valores brutos, 2)`. Com preço de oito casas as duas contas
divergem em centavos: `10 × 4,05318764`, `1 × 0,125` e `5 × 0,025` imprimem
`40,53 + 0,13 + 0,13`, que quem confere soma como **`40,79`** — e a conta
antiga fechava `40,78`. Quem confere está certo, e um rodapé que não bate com a
soma da página destrói a confiança no documento inteiro.

**O operando não é arredondado.** A multiplicação usa o preço íntegro de
`DECIMAL(20,8)` e a quantidade de `DECIMAL(24,12)`; o único fechamento é o da
LINHA. Precisão do operando não é precisão do total — §57. O modo de
arredondamento é `ROUND_HALF_UP` **declarado na chamada**, pela mesma razão de
§60: o critério que decide o centavo de um documento não pode depender de um
default global.

**A conta é uma só.** `calcularTotaisOrdemCompra`, em `@veridi/shared`, serve o
documento da API, a prévia da tela, o relatório de Compras e a OC vinculada
dentro do Pedido do Cliente. Cada superfície que somava por conta própria era
uma chance de o mesmo documento valer dois números.

**O total documental NÃO é fonte de custo técnico.** Ele existe para ser lido e
conferido, e nada o consome: custo de aquisição é `ReceiptLine.actualUnitCost`,
informado por pessoa no Recebimento, e o seletor canônico recusa explicitamente
o preço da OC como fallback — sem custo real o resultado é ausência, nunca o
preço da compra. Média ponderada, custo do lote, CMV e precificação continuam
lendo operandos precisos, nunca o valor fechado do documento.

**A OC não persiste dinheiro.** Não há coluna de total em `PurchaseOrder` nem
em `PurchaseOrderLine`: o valor é sempre derivado na leitura.

**Consequência histórica, aprovada pelo PO em 2026-09-06.** Uma Ordem de Compra
antiga que aparecia como `R$ 40,78` pode passar a aparecer como `R$ 40,79`,
quando as suas linhas somadas documentalmente derem `40,79`. **Isso é
intencional e NÃO é mutação de dado histórico:** nenhum registro foi alterado no
banco, nenhum snapshot foi recalculado, nenhum backfill foi executado. O total
nunca esteve gravado — ele é derivado a cada leitura, e o que mudou foi a conta
que o deriva. Documento antigo passa a exibir o número que a própria página
sempre somou.

Onde o valor é **congelado** — Orçamento, Pedido e Faturamento, §55 — a história
não se move: lá o total é persistido, e regra nova vale da sua data em diante.

## §62 — Resultado técnico persistido fecha em doze casas, e não é preço

Decisão de Product Ownership de 2026-09-06, na aprovação do PREC-MIG-D.

Um **resultado técnico** é valor DERIVADO por unidade — saída de motor, não
número digitado nem acordo assinado. Comissão por unidade
(`preço selecionado × comissão%`), contribuição por unidade
(`preço − comissão − custo industrial`), custo industrial por unidade e CMV por
unidade produzida são resultados técnicos. Todos guardam **doze casas**,
`DECIMAL(24,12)`, §58.

**Resultado técnico não é preço, mesmo quando é dinheiro por unidade.** A
categoria é o PAPEL do valor no domínio, não a sua unidade: uma contribuição de
`R$ 0,650524111111` por unidade não é um preço acordado nem vira operando de
total. Por isso ela não desce para `DECIMAL(20,8)` só por ser dinheiro por
unidade, e o preço técnico não sobe para doze casas só por ser vizinho de bloco.

**A fronteira de persistência é explícita, e é a TERCEIRA.** §60 nomeou duas —
preço técnico em oito casas e fechamento comercial em quatro. Esta é a mesma
regra numa escala acima:

- **D.** resultado técnico persistido em 12 casas — `ROUND_HALF_UP`
  **explícito**, em `fecharResultadoTecnicoPersistido`;
- o PostgreSQL **nunca** é a primeira camada a decidir 40 dígitos → 12 casas.
  Era: até o PREC-MIG-D a ativação gravava o valor de 40 dígitos numa coluna de
  seis, e `0,2026593333333333` virava `0,202659` sem `.toFixed()` no código e
  sem registro;
- o modo viaja na chamada, nunca herdado do default do `decimal.js` (§59).

**Entrada de usuário e resultado calculado seguem regras opostas.** Valor
DIGITADO acima do scale é recusado com HTTP 400 (§58). Resultado CALCULADO com
mais de doze casas é normal — o motor trabalha em 40 dígitos (§59) — e é fechado
na fronteira, nunca recusado. Um resultado interno longo não é erro do operador.

**A cadeia move-se inteira.** `PricingTier.contributionPerUnitSnapshot` é
copiada para `QuoteLine.contributionPerUnitSnapshot` no ENVIO da proposta:
alargar só a faixa trocaria um corte silencioso por outro, no congelamento.

**Antes do fechamento, ninguém corta.** Motor, faixa, prévia, ativação,
congelamento da proveniência, CMV e relatórios técnicos trafegam e serializam as
doze casas, como string — nunca como número JSON. A **tela** continua mostrando
duas, quatro ou seis casas conforme o formatter: apresentação não é
armazenamento (§57), e nenhum caminho da tela devolve resultado derivado ao
servidor.

**Widening não reconstrói o passado.** Uma faixa ativada ou uma proposta enviada
antes desta capability continua valendo o que valia: `0,202659` passa a ser
representado como `0,202659000000`, e as casas que nunca foram persistidas não
existem. Sem backfill, sem recálculo. `null` continua `null` — ausência de
resultado nunca vira zero — e contribuição **negativa** continua sendo
informação comercial legítima, persistida com o mesmo sinal e a mesma precisão.

## §63 — Total técnico fecha em quatro casas, e a escala é a do consumidor

Decisão de Product Ownership de 2026-09-06, na aprovação do PREC-MIG-E.

Um **total técnico** é o valor econômico AGREGADO de um cenário: custo total da
faixa, custo por mil, subtotal conhecido, receita bruta, comissão total,
contribuição total, e a composição do custo industrial e do CMV. Ele é lido e
conferido; **nunca é operando de outro cálculo**. Guarda **quatro casas**,
`DECIMAL(14,4)`, §58.

**Quatro, e não doze — e o motivo é o consumidor, não o número.** Ampliar essas
colunas para `DECIMAL(24,12)` guardaria doze casas que a própria API corta em
duas na saída: o DTO da faixa e o do cálculo de custo servem todos esses campos
em moeda. Precisão que nenhum consumidor recebe não é precisão, é ruído com
custo de migration. **A escala de uma coluna acompanha o papel do valor e o
alcance real do dado, não a escala da coluna vizinha.**

**O que faltava era FRONTEIRA.** Até o PREC-MIG-E a ativação da precificação
gravava o resultado de 40 dígitos do motor direto numa coluna de quatro casas, e
quem decidia o corte era o `UPDATE` — o mesmo defeito de forma que §60 e §62
corrigiram nas outras duas escalas. Agora:

- **E.** total técnico persistido em 4 casas — `ROUND_HALF_UP` **explícito**, em
  `fecharTotalTecnicoPersistido`;
- o PostgreSQL **nunca** é a primeira camada a decidir 40 dígitos → 4 casas;
- o modo viaja na chamada, nunca herdado do default do `decimal.js` (§59).

São agora **quatro fronteiras nomeadas**, uma por categoria: resultado técnico
em doze casas (§62), preço técnico em oito (§60 A), total técnico em quatro
(esta), e o fechamento comercial em quatro (§60 B). O número de casas do total
técnico coincide com o do preço comercial; a regra, não. Categorias diferentes
não compartilham função só porque a escala coincide hoje.

**Armazenamento não é exibição.** A coluna guarda quatro casas e o DTO serve
duas: `123,4567` armazenado aparece como `R$ 123,46`. Nenhuma das duas escalas
deve ser mudada por causa da outra — §57.

**Nove colunas ficaram intocadas de propósito.** `IndustrialCostCalculation` e
`ProductionOrderCostSnapshot` já recebem o valor **fechado em duas casas pelo
próprio motor**, antes de o banco vê-lo. A coluna de quatro casas recebe um
número de duas: não há corte a corrigir e widening não recuperaria nada. Quatro
delas nem sequer são lidas de volta — o DTO vem do JSON do snapshot. Estão
registradas como `CURRENTLY_REDUNDANT`, **não** como candidatas a remoção:
apagar coluna é outra decisão, com outra rodada.

## §64 — Fronteiras diferentes não se reproduzem entre si, e isso é a regra

Decisão de Product Ownership de 2026-09-06, na aprovação do PREC-MIG-E.
Formaliza os achados **F-2** e **F-3** da auditoria.

Grandezas de categorias diferentes fecham em escalas diferentes. Portanto, **um
valor persistido não precisa ser reproduzível a partir de outro valor
persistido, casa por casa, depois da fronteira**. Isso é comportamento
esperado, não defeito, e as duas ocorrências conhecidas são:

**F-2 — o resultado por unidade não sai de dividir o total persistido.**
`IndustrialCostCalculation.costPerUnit` (`24,12`) é calculado pelo motor a
partir do total em **precisão interna cheia**, antes do fechamento monetário; a
coluna `totalIndustrialCost` guarda esse total já fechado em centavos. Dividir a
coluna pela quantidade de referência devolve um número **próximo**, não
idêntico. O caminho preciso é o do motor; o total persistido existe para ser
lido.

**F-3 — por unidade vezes quantidade não reproduz o total persistido.**
`PricingTier.contributionPerUnitSnapshot` guarda doze casas (§62) e
`.contributionTotalSnapshot` guarda quatro (§63). Logo
`contribuiçãoPorUnidade × quantidade` diverge de `contribuiçãoTotal` além da
quarta casa. O mesmo vale para comissão e receita bruta.

**O que NÃO é permitido: divergência VISÍVEL.** A assimetria é técnica e vive
dentro da fronteira. Na precisão em que o número é **apresentado**, tudo tem de
reconciliar: a mesma grandeza comercial final não pode aparecer como
`R$ 100,00` numa tela e `R$ 100,01` em outra. Se isso acontecer, o defeito é
real e não se explica por esta regra — §55 e §61 continuam valendo, e a
diferença de fronteira nunca pode ser usada para justificar um documento que não
fecha.

**Por que escrever isto.** Uma auditoria futura que compare colunas duas a duas
encontrará essas diferenças e as tratará como erro de arredondamento, e a
"correção" seria reduzir a precisão do valor por unidade — apagando exatamente o
que as fundações A a E construíram. A divergência é a consequência de uma
decisão, e uma consequência que ninguém registrou volta como bug.

## §65 — A apresentação decide as casas; o float não decide nada

Decisão de Product Ownership de 2026-09-06, na aprovação do PREC-FMT-01.
Fecha a fundação numérica: schema, persistência, serialização e agora
formatação.

**Formatação é escolha, não sobra.** Quantas casas o usuário vê é decisão de
apresentação, e ela é legítima: um custo de `DECIMAL(20,8)` pode e deve
aparecer como `R$ 3,14`. O que não pode é a redução acontecer **antes** de
alguém decidi-la — e era o que acontecia, porque todo formatter convertia o
decimal para `Number` antes de formatar.

Um `double` tem 53 bits de mantissa. `9007199254740993,12` não existe lá
dentro: vira `9007199254740994`. A tela mostrava um número que o banco nunca
guardou, e nenhuma casa decimal estava envolvida — o erro era na parte
inteira.

**A regra:** decimal chega do servidor como **string** e vira texto sem passar
por número de ponto flutuante. Arredondar para exibir usa `ROUND_HALF_UP`
sobre os dígitos, o mesmo critério das quatro fronteiras de persistência (§60,
§62, §63). Nada de `Number`, `parseFloat`, `Math.round` ou `Intl.NumberFormat`
no caminho de um valor.

**Armazenamento, transporte e exibição são três escalas independentes** (§57), e
a de exibição é a única que pode ser menor sem perder nada — desde que a
escolha seja do formatter.

| Categoria | Storage | API | Display | Arredondamento |
|---|---|---|---|---|
| QUANTITY / FACTOR | `24,12` | íntegro | até 6, sem milhar | HALF_UP; abaixo de `10^-6` mostra `≈ 0` |
| TECHNICAL_RESULT | `24,12` | 12 casas | 2, ou até 6 se sumir | HALF_UP |
| UNIT_COST | `20,8` | 8 casas | 2, ou até 6 se sumir | HALF_UP |
| UNIT_PRICE técnico | `20,8` | 8 casas | 2 a 4 | HALF_UP |
| TECHNICAL_TOTAL | `14,4` | 2 ou 4 casas | 2 | HALF_UP |
| UNIT_PRICE comercial | `14,4` | 4 casas | 2 a 4 | HALF_UP |
| COMMERCIAL_TOTAL | `14,2` | 2 casas | 2 | HALF_UP |
| PERCENT | `7,4` | 4 casas | até 2 | HALF_UP |
| RATE | `14,4` | íntegro | 2 | HALF_UP |

**Quantidade não agrupa milhar, e isso é decisão.** `1.000 un` é o português
correto e é veneno para copiar: o campo decimal deste sistema lê um separador
único como casa decimal. Quantidade é número que se confere contra balança e se
redigita. Dinheiro agrupa, porque ninguém o copia de volta.

**Desconhecido não é zero, na tela também.** `null` aparece como `—`, nunca
como `R$ 0,00`. E um valor pequeno demais para a escala de exibição abre casas
até aparecer, em vez de virar zero: dizer `R$ 0,00` para uma cápsula de
`R$ 0,0032` afirmaria que ela é de graça.

**Conferência de apresentação pode usar `Number`.** `CalcHint` refaz a conta
escrita na tela para comparar com o valor que o servidor mandou, dentro de uma
tolerância derivada das casas exibidas. Ele nunca produz o valor mostrado nem
o valor salvo — é alarme, não motor. Uso classificado como
`SAFE_PRESENTATION_CHECK`; qualquer `Number` que **produza** um valor exibido,
enviado ou persistido continua proibido.

## §66 — Decimal de domínio não se compara por `Number`

Decisão de Product Ownership de 2026-09-06, na aprovação do PREC-CMP-01.

**Igualdade e ordenação de valor `Decimal` de domínio usam a comparação do
próprio `Decimal`** — `equals`, `comparedTo`, `greaterThan` —, nunca conversão
para `Number`. Vale para quantidade, custo, preço, resultado técnico e total: a
regra é da representação, não da categoria.

Um `double` guarda ~15 dígitos significativos, e uma quantidade
`DECIMAL(24,12)` tem vinte e quatro. `999999999999,000000000001` e
`999999999999,000000000002` são duas quantidades diferentes que viram o mesmo
`999999999999` na conversão.

**O dano não é visual, é de decisão.** Onde a comparação responde "este já
existe?", a colisão faz o sistema pular em silêncio um registro que deveria
criar — foi o que acontecia ao aplicar uma política de precificação: a política
declarava duas faixas e a versão nascia com uma.

**A comparação é numérica, não textual.** `"1000"`, `"1000.0"` e
`"1000.000000000000"` são o mesmo número e a mesma faixa. Comparar strings
resolveria o float e criaria um erro pior.

`Number` continua legítimo sobre `Int` — contadores, número de parte, contagem
de lotes — e em verificação de apresentação (§65).

**A aritmética que produz payload também é `Decimal`.** Decisão de Product
Ownership de 2026-09-08, no FIX-01b. A regra não alcança só a comparação: onde
a tela CALCULA uma quantidade que será enviada — o complemento de um plano, o
restante de uma ordem —, a conta é `Decimal` do começo ao fim. `Math.max(
Number(pedido) - Number(digitado), 0)` devolvia ao servidor um número com ruído
na décima sexta casa, e o plano deixava de fechar com o pedido por um dígito
que ninguém digitou. Quando o servidor já entrega o número pronto — como
`remainingQuantity` —, refazê-lo na tela é errado duas vezes: em ponto
flutuante e em duplicidade.

**E sai em notação decimal comum.** `Decimal.toString()` escreve `1e-12` abaixo
de certa magnitude, e a fronteira do servidor recusa exponencial por regex
(`decimal-schema.ts`). Quantidade que vai no corpo da requisição usa
`toFixed()`: mesmo valor, formato que o outro lado aceita.

## §67 — Documento impresso não recalcula; reusa a fonte autoritativa

Decisão de Product Ownership de 2026-09-06, no fechamento do #21.

**Documentos e impressos não recalculam valor `Decimal` de domínio por
JavaScript `Number`.** Eles reusam o resultado autoritativo que o servidor já
entrega ou, quando a transformação é documental e inevitável, a aritmética
`Decimal` canônica — a mesma função que a operação executa, nunca uma cópia.

O documento **não decide regra e não inventa precisão**: escolhe casas para
leitura (§65) e nada mais. Cálculo e formatação são duas etapas — `Decimal`
exato primeiro, formatador depois.

**A cópia da fórmula é o defeito, não o float.** A Ordem de Produção impressa
dividia a necessidade pelas partes por conta própria e anunciava `X × N`. O
motor da produção nunca dividiu assim: ele trunca as N-1 primeiras partes na
escala operacional e dá o resto à última, para a soma fechar com o total. Com
2 kg em 3 partes o plano é 0,666666 / 0,666666 / 0,666668, e o papel dizia
0,666667 nas três — um valor que parte nenhuma seria pesada. A Folha de Receita
trazia os números certos, e os dois documentos GMP da mesma ordem discordavam.

**Onde os dois lados precisam da mesma conta, a função sobe para
`@veridi/shared`** e a API delega para ela — como já acontece com a quantidade
física do componente. Não é cópia sincronizada: é a mesma função. Duas contas
para o mesmo número acabam discordando, e a que aparece no papel é a que
ninguém consegue conferir.

## §68 — Faixa de precificação é identificada pela quantidade física

Decisão de Product Ownership de 2026-09-07, no PREC-CMP-02.

**Faixas de precificação são identificadas pela quantidade física normalizada
na unidade canônica do Produto.** Representações equivalentes em unidades
compatíveis não criam faixas distintas: `1 kg` e `1000 g` são a mesma faixa, e
`0,5 kg` e `500 g` também. `500 g` e `500 kg` são duas.

A identidade **não** é a `quantity` isolada, **não** é `quantity` + `uomCode`
como texto e **não** é `Number(quantity)` (§66).

**A unidade canônica é a do Item de produto acabado do Produto** — não qualquer
unidade válida do catálogo. Uma política em `kg` não se aplica a um produto
vendido por unidade só porque `kg` existe no ERP; a recusa é erro de domínio com
mensagem em português, nunca faixa ignorada em silêncio, convertida para zero ou
gravada inconsistente. Produto sem Item de produto acabado usa `un`.

**Compatível não é igual.** Compatibilidade responde "posso converter?";
igualdade responde "depois de converter, é a mesma quantidade física?". São duas
perguntas, e a segunda só é feita quando a primeira responde sim. Massa e volume
não se convertem: o domínio não guarda densidade.

**O template preserva a sua unidade; a aplicação adapta a cópia para a unidade
canônica do Produto.** Uma política que declara `1 kg` continua declarando
`1 kg` na biblioteca — é a intenção comercial de quem a escreveu —, e num
produto que trabalha em gramas ela nasce como `1000 g`. Assim a versão inteira
fala uma língua só, e "qual faixa é esta?" deixa de depender de conversão na
leitura. Faixa histórica não é recalculada.

A conversão é a oficial (`convertUomDecimal`, sobre o `toBaseFactor` da
`UnitOfMeasure`), em `Decimal` de ponta a ponta e sem truncar antes de comparar:
uma diferença na décima segunda casa é uma faixa diferente. Nenhum fator de
conversão vive fora da `UnitOfMeasure`.

## §69 — Projeto aprovado continua vendendo, e cada compra é um orçamento novo

`Project.APPROVED` significa que o **desenvolvimento técnico e comercial
inicial** foi aprovado — não que a relação com o cliente terminou. O projeto
segue recebendo novas propostas para os produtos que ele aprovou. Recompra não
abre projeto: quem comprou em janeiro e volta em março negocia no MESMO projeto,
com a mesma história técnica, os mesmos custos e a mesma formulação.

`Project.CANCELLED` continua fechado. Ali a negociação acabou.

**Todo novo compromisso de compra tem a sua própria QuoteVersion.** Primeira
compra, recompra, cliente que compra todo mês, compra avulsa depois de um ano —
todas passam pelo mesmo caminho: proposta nova, enviada, aceita. Não existe
"pedido recorrente" no sentido de agendamento: nada gera Pedido sozinho no dia
X.

Num projeto já aprovado, a proposta nova só usa produtos com
`ProjectProduct.APPROVED`. O que ficou `OUT_OF_SCOPE` na aprovação não volta
por uma linha de orçamento — voltaria sem passar pela decisão que o excluiu.

## §70 — Proposta aceita que virou Pedido nunca é superada

Aceitar uma versão continua superando as versões **aceitas em aberto** do mesmo
projeto: proposta aceita e ainda não materializada é oferta viva, e a versão
nova a substitui.

Mas a aceita que **já gerou Pedido** permanece `ACCEPTED`. Ela é a origem
daquele Pedido, e marcá-la `SUPERSEDED` porque o cliente comprou de novo
reescreveria a história do que já foi vendido. A evidência de materialização é a
relação existente com o `CustomerOrder` (`sourcedCustomerOrder`) — não um status
novo.

Consequência: um projeto pode ter várias versões `ACCEPTED` ao mesmo tempo, cada
uma ligada ao seu Pedido. Onde a tela mostrar "o orçamento aceito" do projeto,
ela mostra o **último** — os anteriores continuam legíveis no histórico, com o
Pedido que originaram.

A cardinalidade não muda: uma QuoteVersion gera no máximo um CustomerOrder
(`sourceQuoteVersionId` é único), e gerar duas vezes devolve o mesmo Pedido.

## §71 — A validade fecha a janela de aceite, e o dia inteiro conta

`validUntil` deixa de ser decoração:

- **rascunho** pode não ter validade — é trabalho em andamento;
- **enviar exige validade**. Documento comercial sem prazo é oferta que nunca
  vence, e o preço nele foi calculado sobre o custo de uma data;
- **proposta enviada e vencida não é aceita.** A recusa é erro de domínio em
  português, nunca 500 e nunca aceite silencioso. O caminho é uma versão nova,
  com preço e validade revistos.

**"Vencida" é estado derivado**, calculado a cada leitura: `validUntil` menor que
o dia corrente. Não existe status `EXPIRED`, nada varre o banco à meia-noite, e
o documento vencido continua inteiro no histórico.

**"Válido até 15/09" vale o dia 15 inteiro, na operação brasileira.** A
validade é uma DATA CIVIL, não um instante: o campo é um `<input type="date">`,
e a coluna guarda a meia-noite UTC do dia escolhido como MARCADOR do dia. A
pergunta do domínio — "o dia 15 já acabou na Veridi?" — se responde comparando
DIAS: o dia de hoje em `America/Sao_Paulo` contra o dia escrito na proposta, os
dois em `YYYY-MM-DD` (`lib/business-day.ts`).

Nenhum instante é fabricado, e as duas tentativas de fabricar um erraram em
direções opostas: comparar contra o PRIMEIRO instante do dia vence a proposta um
dia antes do impresso; comparar contra o FIM DO DIA EM UTC a vence às 21h de São
Paulo do próprio dia — três horas antes, e só à noite, que é o pior horário para
descobrir. O fuso vive numa constante só, e nunca como offset fixo `-03:00`: o
horário de verão voltaria a errar em silêncio.

**Aceita não vence retroativamente.** A validade controla o ACEITE; depois do
"sim" existe acordo. O Pedido pode ser materializado semanas depois, com o preço
intacto — `createOrderFromAcceptedQuote` não consulta `validUntil`.

## §72 — O fuso operacional é `America/Sao_Paulo`

**Salvo quando uma regra de domínio disser explicitamente o contrário, toda
interpretação humana e de negócio de data/hora usa `America/Sao_Paulo`.** Vale
para "hoje" e "ontem", início e fim do dia, filtros por período, KPIs, validade,
aceite, aprovação, recebimento, estoque, produção, expedição, faturamento,
auditoria e documento impresso.

Isso **não** significa converter o que está guardado. Três conceitos, e só três:

1. **Instante** — `createdAt`, `acceptedAt`, `shippedAt`. Continua persistido em
   UTC; a LEITURA é no fuso operacional. `2026-09-09T01:30:00Z` aparece como
   `08/09/2026 22:30`.
2. **Data civil** — `validUntil`, data de documento, vigência, validade de lote.
   É `YYYY-MM-DD` e não ganha semântica de instante: a meia-noite UTC gravada é
   o MARCADOR do dia, e o dia são os seus componentes UTC (§71).
3. **Dia comercial** — o dia civil da Veridi e os instantes que o limitam. É o
   que "hoje" significa numa consulta: de 00:00:00.000 a 23:59:59.999 em São
   Paulo.

**Uma definição no monorepo** — `packages/shared/src/business-timezone.ts`.
Nenhum outro arquivo escreve o nome do fuso, e nenhuma tela escolhe o seu.

**Offset fixo é proibido**: `-03:00`, `UTC-3`, somar ou subtrair três horas. O
Brasil já teve horário de verão e pode ter de novo; quem decide o deslocamento
de cada data é a base de fusos do `Intl`.

**O comportamento não depende do relógio da máquina.** `new Date().getDate()`,
`getFullYear()` e afins leem o fuso do processo — em Railway, UTC. Onde a
pergunta for de negócio, o dia vem do dia comercial, nunca dos componentes
locais.

**Cálculo com semântica explicitamente UTC continua em UTC** e fica dito no
código: a janela de referência de custo, a vigência de referência manual e a
aritmética de meses trabalham sobre datas civis lidas em UTC, de propósito.
Log técnico do servidor também continua em UTC — a regra é de produto, não de
observabilidade.

## §73 — A validade do lote é inclusiva: o dia inteiro vale

**Data de validade de lote é inclusiva: o lote permanece válido durante todo o
dia civil informado e vence no início do dia seguinte, considerando
`America/Sao_Paulo`.** Um lote com validade 15/09/2026 pode ser consumido até
23:59:59 de 15/09 e está vencido a partir de 16/09 às 00:00.

`Lot.expiryDate` é DATA CIVIL, como `validUntil` (§71) e pelos mesmos motivos:
quem recebe o material escolhe o dia num `<input type="date">` e nunca escolhe
hora; a coluna guarda a meia-noite UTC como MARCADOR do dia. A pergunta do
domínio é "o dia da validade já acabou na Veridi?", respondida entre DIAS —
nunca entre o marcador e o relógio. Comparar com o instante atual vencia o lote
às 21h do dia ANTERIOR ao impresso no rótulo, e o defeito não aparecia em
teste manual de manhã.

**Uma interpretação, todos os módulos.** A pergunta se responde num lugar só —
`isLotExpired`, em `lib/inventory-ledger.ts`, sobre o mesmo `venceuEm` da
validade comercial (`lib/business-day.ts`). Disponibilidade, FEFO, reserva,
separação, consumo, amostra, expedição, liberação da Qualidade, painel de
atenção e relatório de validade leem daí. Nenhum módulo inventa exceção: um
lote elegível numa tela é elegível em todas, no mesmo instante.

**Validade não é bloqueio antecipado.** Quem quiser impedir o consumo antes do
vencimento usa os estados de Qualidade que já existem — `BLOCKED`,
`AWAITING_RELEASE`, laudo pendente. Antecipar a data de validade para travar
material corrompe o dado que vai ao rótulo e à rastreabilidade.

**"Vence hoje" não é "vencido".** No próprio dia da validade o lote continua
disponível e aparece como proximidade de vencimento — `LOT_NEAR_EXPIRY` no
painel, `daysToExpiry = 0` no relatório. Só na virada do dia ele passa a
`LOT_EXPIRED` e entra na janela "Vencidos". Chamar de vencido o lote do dia
manda descartar material que a operação ainda pode usar.

**"Vencido" continua estado derivado**, calculado a cada leitura: nenhum job
carimba `EXPIRED`, e nenhuma rotina noturna varre a tabela. O backend é a
autoridade — a tela apresenta `isExpired` e `daysToExpiry` vindos da API e não
recalcula vencimento por conta própria.

## §74 — O preço do orçamento novo é FORMADO, e a origem fica registrada

Um projeto aprovado volta a comprar, e a proposta nova precisa dizer de onde
saiu cada preço. **A decisão é POR LINHA**, e são quatro:

1. **manter a condição acordada** — o preço que o cliente já aceitou;
2. **reajustar a condição** — a mesma base, mais um percentual;
3. **usar a precificação atual** — a faixa vigente, com o custo de hoje;
4. **preço manual** — exceção comercial explícita.

Um mesmo orçamento pode manter o preço do produto A, reajustar o do B, aplicar
a precificação atual no C e digitar o do D. **Não existe escolha global.**

**A condição anterior é uma QuoteLine de proposta ACEITA** do mesmo Projeto e
do mesmo Produto — não existe preço no Projeto e não existe tabela de acordo
comercial. A escolha é determinística: `acceptedAt` mais recente, empate por
`versionNumber` e depois por `id`. Ter virado Pedido não a invalida como
histórico: ela É o acordo daquele Pedido.

**Aceita para sempre, vigente por prazo.** Uma proposta aceita vale
indefinidamente como acordo do Pedido que originou. O que expira é a sua
utilidade como condição para uma negociação NOVA, e quem responde isso é o
`validUntil` dela — data civil, dia inteiro em `America/Sao_Paulo` (§71, §73).

**Quantidade é parte da condição.** `10.000 un a R$ 12,50` não é
silenciosamente `500 un a R$ 12,50`. A comparação é da quantidade FÍSICA
normalizada na unidade canônica do produto, em `Decimal` exato — a mesma regra
da faixa de precificação (§68): `1 kg` e `1000 g` são a mesma condição.

**Só um caso vem selecionado**: condição vigente E mesma quantidade física.
Nesse caso a versão nova nasce com o preço acordado e com a proveniência, e a
validade da condição vem SUGERIDA no documento novo — sugerida, não imposta: o
prazo é do documento novo, e COM-CORE continua exigindo validade antes do
envio. Em qualquer outro caso a linha nasce SEM preço, e quem negocia decide.

**Exceção é permitida, em voz alta.** Manter EXATAMENTE a condição quando a
quantidade é outra, ou quando ela venceu, exige confirmação e MOTIVO
obrigatório. O motivo fica gravado na linha. Reajustar não exige motivo em
nenhum dos dois casos: reajustar não afirma que o acordo antigo vale hoje —
cria um preço novo usando a condição como base de cálculo.

**Reajuste não abaixa preço.** O percentual é maior ou igual a zero; `0%` é
aceito e devolve o mesmo preço. Vender abaixo do acordo é preço manual ou o
desconto comercial do orçamento — mecanismos que já existem, e que aparecem em
lugares diferentes do documento. `novoPreço = preçoAnterior × (1 + p ÷ 100)`,
fechado em quatro casas com `ROUND_HALF_UP` pela fronteira comercial (§60). **A
conta é do servidor**: a tela mostra prévia, nunca autoridade.

**Proveniência obrigatória.** A linha guarda a decisão (`priceOrigin`), a
QuoteLine reutilizada (`inheritedFromQuoteLineId`), o percentual aplicado e o
motivo da exceção. O vínculo aponta para a condição EFETIVAMENTE reutilizada —
se a V3 herdou da V2, é a V2 que fica registrada; resolver até a V1 apagaria a
negociação do meio. O backend valida a fonte sempre: mesmo Projeto, mesmo
Produto, proposta ACEITA e com preço. Id que a tela mande sem passar por isso
gravaria uma frase falsa.

**Dois enums, duas perguntas.** `priceSource` responde "tecnicamente veio de
faixa ou foi digitado?"; `priceOrigin` responde "qual decisão comercial formou
este preço neste ciclo?". Preço herdado é `INHERITED_AGREEMENT` com
`priceSource = MANUAL` — nunca apontando falsamente para a precificação atual.
`priceOrigin` nulo é LEGADO: linha gravada antes da regra, sem proveniência
suficiente para classificar, e nada é classificado retroativamente por chute.

**Provenance não mente.** Mudar a quantidade de uma linha herdada ou reajustada
solta o vínculo E o preço: aquele número era o acordo de outra quantidade, e a
linha volta a "não precificado" — o envio já recusa linha sem preço. Digitar o
preço à mão passa a origem para `MANUAL`. Produto nunca herda preço de outro
produto.

**Mudar é valor diferente, não campo presente.** Só uma alteração REAL de
quantidade ou de unidade solta o preço, e só um preço diferente do gravado
passa a origem para `MANUAL`. A mesma quantidade em outra escrita decimal, a
mesma unidade ou o mesmo preço — num pedido que apenas os repete — não mudam
nada na linha: nem preço, nem origem, nem vínculo (QUOTE-LINE-NOOP-BLUR-01).

**Preço herdado, custo de hoje.** O envio congela a economia CORRENTE também
nas linhas que não vieram de faixa: a referência é a faixa da precificação
ATIVA cuja quantidade física é a mesma da linha. Sem faixa equivalente não há
custo corrente a congelar, e o envio acontece do mesmo jeito — o preço do
acordo não depende dele para valer. Copiar o CMV antigo junto com o preço faria
o documento novo descrever a economia de um documento velho.

**COM-03 intocado.** Depois do envio e do aceite, precificação nova, custo novo
ou proposta nova não mexem no que foi acordado: Pedido e Faturamento continuam
congelados.

## §75 — Entrega programada é promessa; Expedição é execução

**A entrega programada registra QUANDO cada parte do Pedido foi prometida ao
cliente. Ela não move nada.** Criar uma programação não reserva estoque, não
escolhe lote, não gera movimento de estoque, não abre Ordem de Produção, não
cria Expedição e não fatura. Cada uma dessas ações continua acontecendo no
fluxo que já era dono dela.

Um Pedido de 3.000 com 1.000 em outubro, novembro e dezembro passa a ser
representável: um Orçamento, um Pedido, um preço e três promessas com data. Não
é pedido recorrente — não existe agendador, assinatura nem geração automática.

**O Plano de Atendimento não muda.** Ele continua cobrindo o Pedido inteiro de
uma vez, e a reserva continua sendo dele. O cronograma informa a dimensão
temporal e não divide o Plano: dois motores de reserva seriam duas verdades
sobre o mesmo saldo.

### Quem executa é a Expedição CONFIRMADA, e o vínculo é explícito

**A quantidade atendida de uma entrega programada é a soma das linhas de
Expedição CONFIRMADA ligadas a ela** — `ShipmentLine.customerOrderDeliveryLineId`.
Rascunho de Expedição é separação em curso e não atende nada; Expedição
cancelada nunca atendeu.

O vínculo é uma coluna, nunca uma dedução: duas Expedições do mesmo produto no
mesmo Pedido podem servir promessas diferentes, e adivinhar qual delas seria
inventar história. A coluna é anulável — Pedido anterior a esta capacidade,
Pedido sem cronograma e Expedição que não corresponde a promessa nenhuma
continuam válidos.

### Dois fluxos de Expedição, duas regras de alocação

**Separação aberta pela ENTREGA** (`Shipment.originDeliveryId` preenchido).
Aquela Expedição REPRESENTA aquela promessa. A proposta nasce limitada ao que
ela pedia, e passar disso é **recusa** — nunca transbordo para a promessa
seguinte, mesmo que exista saldo nela. Quem precisa expedir mais abre outra
separação. A origem é **persistida**, nunca deduzida dos vínculos das linhas:
uma separação geral que coubesse inteira numa promessa só seria confundida com
esta.

**Separação aberta pelo PEDIDO** (sem origem). A quantidade **atravessa
promessas**, na ordem em que elas foram prometidas: expedir 500 contra uma
entrega de 400 e outra de 600 atende 400 na primeira e 100 na segunda. Tratar
isso como excesso da primeira recusaria uma expedição que o Pedido comporta, e
deixar tudo sem vínculo faria o cronograma jurar que nada foi entregue.

A ordem é `scheduledDate`, depois `sequence`, depois `id`. Os dois primeiros são
semânticos — a promessa mais antiga primeiro, empate do mesmo dia pela ordem em
que foram feitas. O `id` entra só para o resultado ser estável, e `createdAt`
não entra: "quando alguém digitou" não decide o que o cliente recebe primeiro.

**O que sobra depois de esgotar as promessas fica sem vínculo, e isso é
legítimo**: o Pedido pode ter saldo real sem promessa para ele. Expedir não
exige cronograma completo.

**Uma linha de lote pode virar DUAS linhas de Expedição** quando a quantidade
atravessa promessas — mesmo lote, mesma reserva, dois compromissos atendidos. É
a única representação possível com um vínculo por linha. A tela reagrupa por
reserva: quem separa vê um lote e um número, com a associação de lado.

**O teto da promessa é revalidado na CONFIRMAÇÃO da Expedição**, dentro da
transação que trava o Pedido. Validar só na criação do rascunho não bastaria:
entre separar e confirmar, o saldo da promessa pode ter encolhido.

**A confirmação NUNCA realoca em silêncio.** Se a promessa não comporta mais o
que estava separado, a confirmação é recusada com o saldo que restou. Mover a
linha para a promessa seguinte apagaria a evidência do que estava sendo
preparado, e quem confirma assinaria uma entrega diferente da que tinha na
frente.

### Separação em andamento tranca a promessa

**Entrega com Expedição em RASCUNHO ligada a ela não se cancela nem se
reprograma.** O rascunho não atende nada — só a confirmação atende —, mas
alterar o compromisso por baixo de uma separação em curso deixaria quem está
conferindo lote apontando para uma promessa que mudou de forma. A ordem é a
inversa: confirmar ou cancelar a Expedição primeiro.

**Expedição CONFIRMADA não tranca**: ela é história física, e uma entrega
parcialmente atendida continua cancelável. O que bloqueia são as quantidades em
preparação, nunca as já entregues.

### A situação é derivada; o único estado gravado é o cancelamento

Programada, Parcialmente atendida, Atendida e Atrasada são LEITURAS, calculadas
a cada consulta a partir de `quantity` e do que as Expedições confirmadas
entregaram. Nenhuma coluna as guarda, nenhuma rotina as carimba.

**Atraso é data civil** (§72, §73): a entrega está atrasada quando o dia
prometido JÁ PASSOU e ainda há saldo pendente. No próprio dia da promessa ela
não está atrasada — o dia inteiro vale. Entrega inteiramente atendida nunca
vira atrasada depois.

### Saldo programável: o expedido e o prometido são descontos diferentes

Por linha do Pedido:

```
saldo programável = quantidade pedida
                  − expedido em Expedições confirmadas
                  − pendente das entregas ainda ATIVAS
```

O expedido vem da mesma fonte que o resto do sistema usa; programação não
inaugura uma segunda contagem do que saiu.

### Cancelar não apaga execução

**Uma entrega parcialmente atendida PODE ser cancelada.** O cancelamento libera
o SALDO PENDENTE e nada mais: as linhas de Expedição já confirmadas continuam
apontando para ela, e a entrega continua mostrando o que entregou antes de ser
cancelada. Motivo é obrigatório.

Entrega de 400 com 250 confirmadas e depois cancelada devolve **150** ao saldo
programável — nunca os 400. O que saiu continua descontado do Pedido; o que
restava deixa de ocupar programação.

**Entrega inteiramente atendida não se cancela nem se reprograma**: não há
saldo, e marcá-la de outro jeito reescreveria uma expedição que já ocorreu.

### Reprogramar é cancelar e substituir, nunca editar a data

**Mudar a data prometida encerra a entrega atual e cria uma substituta com os
saldos AINDA PENDENTES**, na data nova, apontando para a original por
`replacesDeliveryId`. Não existe correção de data no lugar, nem para erro de
digitação: editar apagaria a evidência de que 15/10 foi prometido antes de
15/11, e é essa evidência que explica o atraso ao cliente.

A cadeia A → B → C fica legível inteira, cada elo com o seu motivo. Linha já
inteiramente atendida não é copiada para a substituta.

### O que o cronograma nunca toca

Preço. Uma entrega programada não tem preço próprio e não consulta precificação,
CMV nem oferta de fornecedor: o Pedido já congelou a condição comercial (§60,
§74). O Faturamento continua nascendo de Expedição confirmada, e a reconciliação
comercial do Pedido (§ BILL-DISCOUNT) continua fechando em
`agreedTotalAmount` — programar não cria matemática comercial paralela.

## §76 — A oferta do fornecedor só participa do custo com vigência, e só uma por item

O degrau 4 de §53 — "oferta válida de fornecedor homologado" — existia na
regra e não existia na operação: as 602 ofertas da base vieram da planilha
sem data de cotação, e sem vigência uma oferta é observação histórica. Quem
cadastrava cinco preços e abria o CMV via "sem custo conhecido", sem nada
ligando as duas telas.

**A hierarquia de §53 não muda.** Compra real continua vencendo oferta;
oferta continua vencendo referência manual; ausência continua sendo `NO_COST`
e nunca zero. O que passa a existir é a possibilidade de o degrau 4 acontecer,
e a obrigação de a tela explicar quando ele não acontece.

### Vigência é requisito da oferta nova, não da coluna

**Oferta criada pela interface exige "válida a partir de".** A tela sugere o
dia de hoje, visível e editável; o domínio recebe uma data explícita. O
servidor não assume mais `new Date()` quando o campo não vem — a data
comercial de um preço é afirmação de quem negocia, não o relógio de quem
gravou.

**A coluna continua aceitando nulo.** Preço legado sem data é histórico
legítimo, e preenchê-lo por inferência — `createdAt`, data da importação,
hoje — escreveria uma condição comercial que ninguém negociou. Na tela ele
aparece como "Importada sem vigência", nunca como inválido e nunca escondido.

**A oferta segue imutável** (§5.3): preço, MOQ, moeda, unidade ou vigência
diferentes criam oferta NOVA. Não existe edição no lugar.

### A vigência é dia civil nas duas bordas

Uma oferta que passa a valer no dia D **vale o dia D inteiro**; uma que vale
até o dia D **ainda vale o dia D inteiro**. As duas comparações olham o DIA da
pergunta, nunca o instante — a mesma semântica de §71 e §73. Antes disso o
início da vigência era comparado com o instante cru da `referenceDate`
enquanto compra real e referência manual já usavam o dia inteiro; a assimetria
não tinha efeito visível porque a borda sempre mandava meia-noite, e uma
assimetria latente numa fronteira de custo é dívida, não detalhe.

Consequência direta, e é a que interessa ao negócio: uma oferta com vigência
FUTURA não é usada hoje, e um cálculo com `referenceDate` naquele dia futuro
**já a enxerga**. Previsão de custo não precisa de motor novo — precisa de
vigência informada.

### Um fornecedor não precisa de preferencial; dois precisam

- **exatamente um homologado com oferta válida** → é ele
  (`SUPPLIER_OFFER_SINGLE_APPROVED`). Não se exige marcar nada;
- **vários, com exatamente um preferencial** → é o preferencial
  (`SUPPLIER_OFFER_PREFERRED`);
- **vários sem preferencial**, ou mais de um preferencial → **material sem
  custo** (`AMBIGUOUS_SUPPLIER_REFERENCE`). O sistema não escolhe o mais
  barato, o mais novo, o primeiro, o de maior MOQ nem a ordem alfabética:
  escolher seria decidir a compra no lugar de quem compra.

**Preferencial e vigência são independentes.** Marcar o fornecedor
preferencial não torna válida uma oferta sem vigência, e um preferencial sem
oferta vigente não cria custo nenhum — o motor segue o fallback.

A unicidade do preferencial por item é do BANCO (índice parcial único
`supplier_items_preferred_per_item_key`, mais o CHECK que exige relação ativa
e homologada), e a troca acontece na mesma transação. Duas requisições
simultâneas terminam com no máximo um preferencial.

### Só reais entram no custo, em qualquer fonte

Não existe conversão cambial nesta fase. Oferta em moeda estrangeira é
referência comercial e **nunca** vira custo em reais — isso já valia. Passa a
valer também para a **referência manual do item**: `ItemCostReference` tem
`currencyCode` desde sempre, e a seleção de fonte não o filtrava. Uma
referência em dólar seria tratada como se fosse real, produzindo um número
plausível e errado — o pior tipo de erro de custo, porque ninguém confere o
que parece certo. O filtro é parte da ESCOLHA da vigente, não um descarte
posterior: uma referência em dólar mais recente não esconde uma em real mais
antiga.

Nenhum dado foi alterado por essa correção. As 293 referências existentes são
todas BRL; a proteção vale para o que vier.

### MOQ não escolhe oferta e não muda custo

Continua como em §5.3: pedido mínimo é condição daquele preço, aparece na
oferta, orienta a Sugestão de Compra como recomendação — e nunca participa da
escolha da oferta nem do custo unitário.

### A tela diz por que uma oferta não serve

Cada oferta carrega um diagnóstico derivado da MESMA condição do motor, nunca
de uma segunda regra: serve de referência, sem vigência, ainda não vigente,
vencida, moeda estrangeira, fornecedor não homologado, unidade incompatível.
O enum é do contrato; o usuário lê a frase.

**"Serve de referência" não é "está sendo usada".** Uma compra real recente
vence qualquer oferta, e confundir as duas coisas é a leitura errada mais
provável da tela. Por isso o detalhe da relação mostra também a fonte que o
motor usaria HOJE para aquele ITEM, resolvida uma vez pelo seletor canônico —
não uma por linha da grade.
## §77 — O produto de um documento comercial é do cliente daquele documento

Produto pertence a um Cliente. Um Pedido do Cliente A com produto do Cliente B
é uma combinação impossível — e era aceita: a tela oferecia o catálogo inteiro,
o service não comparava nada, e o Pedido chegava a **CONFIRMADO**. A primeira
recusa vinha muito depois, ao gerar a Ordem de Produção, com o compromisso
comercial já assumido.

**A comparação é uma só.** `Product.customerId × CustomerOrder.customerId` vive
em `lib/product-customer-ownership.ts`, junto do `CustomerMismatchError` que já
existia — mesma semântica, mesmo tipo, mesmo `400 customer_mismatch` em toda
rota que o alcança (§ do erro de domínio: recusa de negócio nunca é 5xx).

**Toda porta chama a mesma comparação:** criar Pedido, salvar as linhas do
rascunho, trocar o cliente do rascunho, **confirmar** o Pedido e gerar Pedido a
partir de proposta aceita. Confirmar é o momento em que o documento vira
compromisso — dali para a frente reserva, Ordem de Produção e expedição assumem
que ele é íntegro —, então a validação da inclusão não dispensa a do CONFIRM:
linha legada, importação antiga ou caminho futuro que escreva por fora esbarram
ali.

**A recusa a jusante continua.** `resolveOrderCustomerId` não foi removido:
deixou de ser a primeira linha e passou a ser defesa em profundidade.

**Produto sem cliente não é inconsistência.** A base traz produtos importados do
legado sem dono resolvido, e tanto a Ordem de Produção quanto o vínculo
Produto↔Projeto sempre os aceitaram. Recusá-los seria mudar o modelo de Product.

### Cliente primeiro, produto depois

Na tela, o seletor de Produto só abre depois do Cliente, e o catálogo é
consultado **no servidor** com `customerId` — busca e paginação inclusive.
Filtrar no navegador não serve: a página carregada é um teto, e o produto
elegível além dele sumiria sem aviso. Filtro de tela também não é regra: o
backend recusa por conta própria.

**Trocar de cliente com produto no Pedido é bloqueado**, com o motivo. As duas
saídas automáticas são piores: apagar as linhas descarta trabalho em silêncio, e
mantê-las cria a mistura de propriedade. Sem linhas, a troca é livre e o catálogo
acompanha.

### Pedido herdado inconsistente

Não se corrige por backfill. Continua abrindo, mostra o aviso com as linhas
inconsistentes (`CustomerOrderLineDTO.productCustomerMismatch`) e **não
confirma**. Trocar o cliente, trocar o produto ou apagar a linha por SQL
reescreveria história comercial que ninguém decidiu.

## §78 — O custo é da quantidade calculada; "por 1.000" é razão, não execução

No walkthrough real de 2026-09-09 a base de produção do produto era **300
unidades** e a tela destacava **"custo por 1.000"**. A usuária não soube dizer
se o sistema havia calculado 300 ou 1.000. Enquanto essa dúvida existe, nenhum
número de custo sustenta decisão — e a dúvida era legítima: os dois números
apareciam com o mesmo peso, sem nada dizendo qual é total e qual é razão.

**A matemática estava certa.** A auditoria do motor em 200, 300, 500 e 1.000 —
com recurso fixo por lote, recurso proporcional, energia, múltiplos lotes e
caixa inteira — confirmou que `perUnit = total ÷ quantidade` e
`per1000 = perUnit × 1.000`, e que o total é sempre o da quantidade pedida (a
base de referência, no CALC; a quantidade simulada, no CMV e nas faixas). Não
houve correção de cálculo: o defeito era de apresentação.

**`per1000` é NORMALIZAÇÃO, e a distinção não é acadêmica.** Sobre uma base de
300, produzir 1.000 são quatro lotes, e custo fixo por lote, recurso por lote de
referência e caixa de expedição inteira não diluem proporcionalmente (§5.12). Na
prova: uma execução de 300 a R$ 201,00 tem R$ 670,00 de equivalente por 1.000,
enquanto o cálculo real de 1.000 dá R$ 767,00 — 14% acima. Chamar os dois de
"custo por 1.000" faz o comparativo parecer o custo de uma produção que ninguém
calculou.

**A hierarquia responde primeiro "quanto custa a quantidade que eu pedi".** Em
ordem de destaque: quantidade calculada, custo total DAQUELA quantidade, custo
por unidade e, secundário e rotulado como equivalência, o valor por 1.000. O
rótulo é **"Equivalente por 1.000 un"**, com a ressalva de que não representa um
novo cálculo de produção — texto único em `@veridi/shared`
(`COST_PER_1000_LABEL`, `COST_PER_1000_EXPLANATION`), porque a mesma
equivalência é impressa em seis superfícies e copiá-la seria deixá-la divergir.

**A quantidade acompanha o total, e não fica três telas acima.** O rótulo do
total carrega a quantidade ("Custo industrial total para 300 un"), e o
detalhamento, o CMV, os três impressos e o relatório de custo industrial por
produto trazem a base ao lado do número que ela explica.

**No papel a ressalva vem impressa.** Não há ⓘ para abrir num documento, e quem
o recebe não estava na conversa em que a base foi escolhida.

**Nada de domínio mudou.** Nenhum snapshot foi recalculado, nenhum campo
renomeado (`costPer1000`, `costPer1000Snapshot` seguem com o nome técnico) e
nenhuma migration nasceu disto: é copy e hierarquia.

## §79 — A vigência da tarifa industrial é dia civil, inclusiva nas duas bordas

`IndustrialResourceRate.effectiveAt` e `.validUntil` são **datas civis**, como
`validUntil` da proposta (§71) e a validade do lote (§73): quem cadastra
escolhe o dia num `<input type="date">` e nunca escolhe hora, e a coluna guarda
a meia-noite UTC como MARCADOR do dia. A pergunta do domínio é "este DIA está
dentro da vigência?".

**Uma tarifa que passa a valer no dia D vale o dia D inteiro; uma que vale até
o dia D ainda vale o dia D inteiro.** É a mesma semântica que §76 já dera à
oferta do fornecedor, do outro lado do custo.

**O que estava errado.** `isRateCurrent` comparava INSTANTES: o marcador de
"válida até 09/09" é `00:00:00.000`, então qualquer relógio depois disso já a
declarava histórica. A tarifa morria durante o próprio dia impresso nela — e
`toRateDTO` decidia com `new Date()`, o relógio do processo, que em Railway é
UTC. Um teste feito de manhã nunca veria o defeito.

**A suspeita original era outra, e estava errada.** O walkthrough relatou
"agosto deveria usar A e usa B". A auditoria não confirmou: com A vigente desde
janeiro e B desde setembro, agosto sempre respondeu A e setembro sempre
respondeu B, e os snapshots econômicos sempre ficaram congelados. O defeito real
era a borda do dia, e só ela foi corrigida.

**"Vigente agora" é pergunta sobre o DIA COMERCIAL.** Quem quer saber a
situação de hoje traduz o relógio em dia comercial antes de perguntar
(`marcadorDeHojeComercial`); às 22h de São Paulo o relógio cru já é o dia
seguinte em UTC. `toResourceDTO` deixou de aceitar "hoje" implícito: a data de
referência é obrigatória, e quem chama diz de que dia está falando.

**A data de referência do motor continua explícita** (§5.8). Nada aqui
introduz "hoje" no cálculo: o que mudou é que, quando a borda não informa data,
o padrão passou a ser o dia comercial como DATA CIVIL, e não um instante.

**Tarifa registrada sem vigência informada nasce valendo hoje**, gravada como
marcador de dia civil — não como o instante em que alguém clicou. Antes a
coluna misturava duas codificações, e nenhuma leitura estava certa para as
duas.

**Snapshot continua congelado.** `rateIdSnapshot`, `rateValueSnapshot` e
`rateEffectiveAtSnapshot` seguem intocados; reajustar a hora hoje nunca
reescreve custo histórico. A ativação passa a congelar a tarifa vigente no DIA
COMERCIAL da ativação — ativar às 22h não congela a tarifa que só começa
amanhã.

### Sobreposição de vigências continua em aberto — de propósito

Criar a tarifa B **não encerra** a tarifa A: `validUntil` de A continua nulo, as
duas ficam vigentes, e o histórico da tela marca as duas como "Vigente" sem
dizer qual ganha. O motor não fica ambíguo — vence o `effectiveAt` mais
recente, com desempate por `createdAt` —, mas a leitura fica.

**A política não é decidida aqui**, e não deve ser decidida sozinha: é a mesma
pergunta de SUPPLIER-OFFER-OVERLAP-01, nos dois lados do custo, e duas
respostas divergentes seriam pior que nenhuma. As opções em aberto são encerrar
a anterior automaticamente, bloquear a sobreposição, alertar e permitir, ou
permitir com prioridade explícita. Até lá, o sistema **não** edita, encerra nem
apaga a vigência anterior por conta própria.

Nenhuma migration nasceu disto: a semântica é de leitura, e a coluna já era a
certa.

---

## §80 — O endereço de um cadastro pertence a UM CEP

CUSTOMER-CEP-02, 2026-09-09. Vindo do walkthrough real: ao trocar o CEP de um
Cliente, campos do endereço anterior ficavam na tela.

O bloco de endereço — **logradouro, número, complemento, bairro, cidade e UF** —
pertence ao CEP que está no cadastro. Não é uma coleção de seis campos livres
que por acaso foi preenchida por uma consulta: é o endereço **daquele** CEP.

### Trocar o CEP invalida o endereço inteiro

No instante em que o CEP digitado deixa de ser o CEP a que o endereço pertence,
os seis campos são limpos — antes de qualquer consulta, sem esperar rede.

**Número e complemento entram na limpeza**, e é a parte contraintuitiva: o
ViaCEP não os conhece, então a regra antiga nunca os tocava. Mas eles são do
endereço anterior tanto quanto a rua, e a consulta do CEP novo não prova que
continuam válidos. Sobreviver à troca produz o **endereço híbrido** — a rua e a
cidade de um CEP com o número da casa de outro —, que é pior que o campo vazio
porque parece plausível, é salvo assim e vai impresso assim.

Limpar antes da consulta, e não depois, é deliberado: esperar a resposta para
parar de mostrar o endereço errado é mostrá-lo pelo tempo que o ViaCEP levar —
e ele pode não responder.

### O que NÃO conta como troca

- **máscara.** `18270-000` e `18270000` são o mesmo CEP. A comparação é por
  dígitos;
- **CEP incompleto.** Enquanto o CEP novo não tem oito dígitos não há consulta —
  mas o endereço anterior já foi invalidado, e não volta;
- **endereço sem CEP dono.** Cadastro manual — o de um cliente salvo sem CEP, ou
  o que está sendo digitado antes do primeiro CEP — não é apagado por um CEP que
  chega depois: a primeira consulta apenas completa o que está vazio. Endereço
  manual sem CEP continua sendo cadastro válido.

### Sob o mesmo CEP, quem manda é o operador

Enquanto o CEP não muda, a correção manual é preservada e a consulta não se
repete. A tela não reescreve o que a pessoa acabou de corrigir.

Trocar o CEP **depois** da correção manual apaga a correção junto — ela era do
endereço anterior.

### Falha e ausência não restauram o endereço velho

ViaCEP fora do ar, CEP inexistente, ou resposta sem logradouro: os campos ficam
vazios e editáveis. Voltar o endereço anterior afirmaria que ele pertence ao CEP
novo. **A falha da integração nunca impede salvar um endereço digitado à mão** —
o cadastro não depende de serviço externo.

### A resposta que chega fora de ordem é descartada

A guarda é a **identidade do CEP consultado**, não a ordem de chegada: antes de
escrever qualquer coisa — inclusive o recado de erro —, a resposta é conferida
contra o CEP que está na tela naquele instante. Vale nos dois sentidos: a
resposta atrasada de A não invade B, e a resposta rápida de A não repovoa o
endereço enquanto B é esperado.

Não é debounce. Tempo maior só diminui a chance da corrida; identidade a elimina.

### Onde a regra vive

`apps/web/src/pages/customers/customer-form.tsx`, no par
`typedZip`/`addressZip` — o CEP que está sendo digitado e o CEP a que o
endereço pertence. Duas identidades, e só duas: distinguir isso é a regra
inteira. Nada disso é de domínio — a API continua aceitando cada campo de
endereço como opcional e independente, e nenhuma migration nasceu daqui.

---

## §81 — Quais INSTANTES pertencem ao dia comercial da pergunta

COST-COMMERCIAL-DAY-01, 2026-09-09. Achado durante D-17 e deixado para runtime
de propósito. É o terceiro lugar do custo com a assimetria que §76 corrigiu na
oferta do fornecedor e §79 na tarifa industrial — e o primeiro em que os dois
lados da comparação são de espécies DIFERENTES.

Nos dois casos anteriores, marcador de dia civil era comparado com marcador de
dia civil. Aqui não: `referenceDate` é DATA CIVIL e `Receipt.receivedAt` é
INSTANTE. A regra é a que §72 já enuncia, aplicada ao ponto em que as duas se
encontram:

> **Um instante pertence ao dia comercial D quando cai entre o primeiro e o
> último milissegundo de D em `America/Sao_Paulo`.**

Para 09/09/2026 isso é `2026-09-09T03:00:00.000Z` a `2026-09-10T02:59:59.999Z`.
Não é o dia UTC do marcador, que termina às 20:59:59 de São Paulo.

### O que estava errado, nas duas pontas

**A borda de cima terminava cedo.** O limite era o fim do dia UTC do marcador,
e todo recebimento lançado entre 21:00 e 23:59 de São Paulo caía FORA do próprio
dia: quem registrava a compra à noite e perguntava o custo daquela data recebia
uma fonte mais antiga — ou `NO_COST` — com o custo real já gravado no banco.

**A borda de baixo começava cedo pelo mesmo motivo**, e no sentido oposto:
deixava entrar as três últimas horas do dia anterior à janela. Corrigir só o fim
teria trocado um erro por outro; as duas bordas são dias comerciais inteiros.

A contagem de dias não mudou: `-30` e `-90` recuam no CALENDÁRIO. Subtrair
`30 x 24h` de um instante atravessa a meia-noite comercial na hora errada e, em
mudança de horário de verão, pula ou repete um dia.

### Carimbo de tempo continua carimbo de tempo

`receivedAt`, `consumedAt`, `occurredAt` e `createdAt` **não** viram marcador de
dia civil. O recebimento aconteceu num instante, e é assim que ele fica
gravado. O que mudou é a pergunta feita contra ele — quais instantes pertencem
ao dia D — e a ponte, quando o domínio precisa do dia de um instante, é
`marcadorDoDiaComercialDe`.

### A data que a pessoa escolhe vira instante DO DIA escolhido

FAST-DEVELOPMENT-RESET-02, 2026-09-11. "Data do recebimento" é data civil na
tela, e `receivedAt` é instante no domínio. A conversão é
`lib/receipt-instant.ts`, a mesma nas duas telas de recebimento: **hoje vira
agora**; outro dia vira o **início daquele dia comercial**. Nunca a meia-noite
UTC — `new Date("2026-09-11")` é 21h do dia 10 em São Paulo, e o lote recebido
no dia 11 nascia `LT-20260910-…`, com o movimento de estoque na véspera. O
campo abre com o dia comercial de hoje, não com o dia UTC.

### "Hoje" implícito é sempre o dia comercial

Quando a borda não informa data, o padrão é `marcadorDeHojeComercial()`, nunca
`new Date()`. Um instante como data de referência quebra a comparação nos dois
sentidos: às 22:30 de São Paulo ele é o dia UTC seguinte, e a seleção passa a
enxergar vigências que só começam amanhã.

**Referência manual criada sem `effectiveFrom` nasce valendo HOJE**, gravada
como o marcador do dia comercial — pelo mesmo motivo e com o mesmo helper que
§79 aplicou à tarifa industrial. `effectiveFrom` explícito é preservado como
data civil, sem releitura pelo relógio de quem gravou. A tela já mandava o dia
certo; a API não pode depender disso.

### O que NÃO mudou

Hierarquia de fontes (§53), fórmula da média ponderada, filtro de moeda BRL,
`referenceDate` explícita no motor (§5.8) e snapshots já persistidos. A mudança
é de leitura e de padrão futuro: **nenhum dado gravado estava errado**, e a
auditoria de produção confirmou — 295 referências, todas em marcador de
meia-noite UTC, nenhuma na faixa problemática. Sem backfill e sem migration.

### Onde a regra vive

`limitesDaJanelaDeCusto` em `apps/api/src/lib/cost-reference.ts` — a definição
da elegibilidade temporal, exportada porque é ela que os testes de borda
interrogam. Os limites do dia vêm de `limitesDoDiaComercial`, e o deslocamento
de calendário de `diaCivilDeslocado`, os dois na fundação de `@veridi/shared`.
Nenhum helper novo de fuso nasceu aqui.

---

## §82 — Documento congela; ficha de trabalho projeta

PROJECT-CUSTOMER-CONTACT-01, 2026-09-09. Do walkthrough real: para ligar para o
cliente, quem estava dentro de um Projeto saía da tela e abria o cadastro.

O detalhe do Projeto passou a mostrar **telefone e e-mail do Cliente**. A
palavra é PROJETAR, não copiar: o valor é lido do cadastro a cada leitura, e
`Project` não ganhou coluna nenhuma. Trocar o telefone no Cliente muda o que o
Projeto mostra na próxima abertura — sem sincronização, sem job e sem backfill.

**Isto não contradiz o snapshot do Orçamento.** As duas coisas respondem a
perguntas diferentes, e a diferença é a regra:

- **Documento** — `QuoteVersion` congela cliente e endereço no envio (§55). A
  impressão que o cliente recebeu não pode mudar depois; ela é prova do que foi
  apresentado naquele dia.
- **Ficha de trabalho** — o Projeto é onde se trabalha HOJE. Um telefone
  congelado ali seria um telefone que envelhece calado, e a pessoa ligaria para
  o número errado achando que o sistema sabia.

Duplicar o contato em `Project` criaria uma segunda verdade sobre o mesmo fato,
e a do Projeto seria a errada primeiro. A autoridade é `Customer`, e só ela.

**"Contato principal" não existe no domínio.** O modelo tem `Customer.phone` e
`Customer.email`, um de cada, e nada foi inventado para preencher a palavra:
sem entidade de contato, o escopo é telefone, e-mail e o link que já existia.

### A versão corrente e a última ENVIADA são coisas diferentes

PROJECT-COMMERCIAL-SUMMARY-01, 2026-09-10. A mesma ficha ganhou uma coluna
comercial, e com ela a distinção que o read model precisa impedir de colapsar.

Um projeto pode ter `V3 SENT` e `V4 DRAFT` ao mesmo tempo — é o estado normal
de uma renegociação em aberto. São **dois fatos distintos**:

- o **último orçamento** é a versão de maior `versionNumber`, e é dela que saem
  valor, itens e condição de pagamento;
- a **última proposta enviada** é a de maior `versionNumber` com `sentAt`
  preenchido, e é a única que o cliente realmente recebeu.

Mostrar o rótulo de uma com a data da outra anuncia um envio que não
aconteceu. Quando as duas coincidem, a segunda linha não aparece — repetir o
mesmo documento em duas linhas o faria parecer dois.

**`sentAt` é o único carimbo que responde "foi comunicada".** `createdAt` e
`updatedAt` dizem quando a linha foi mexida, que é outra pergunta, e derivar
envio deles inventaria uma data que ninguém registrou.

O valor exibido é `QuoteVersionDTO.total` — subtotal **menos desconto**, como
o servidor já entrega. Somar linhas na tela produziria um segundo número sobre
o mesmo fato, e `null` (linha sem preço) nunca vira R$ 0,00: "ainda não há
total" e "custa zero" são estados diferentes.

---

## §83 — Perfil tributário do Cliente: classificação informada, não motor fiscal

CUSTOMER-TAX-PROFILE-01, 2026-09-11, sobre a decisão do PO de 2026-09-10.

**O Perfil tributário do Cliente é uma classificação informada pelo usuário e
não determina automaticamente impostos ou regras fiscais.**

**Cliente possui Perfil tributário opcional do ponto de vista operacional,
representado por "Não informado" quando não definido. O Perfil tributário não
calcula impostos automaticamente e não bloqueia fluxos comerciais ou
operacionais.**

Valores: Não informado · MEI · Simples Nacional · Lucro Presumido · Lucro Real
· Outro. O nome no produto é "Perfil tributário" — nunca "tipo de CNPJ".

- **"Não informado" é valor, não ausência.** `Customer.taxProfile` (enum
  `CustomerTaxProfile`) é não-nulo com default `NOT_INFORMED`; `NULL` e
  `NOT_INFORMED` não convivem. Retirar uma classificação é escolher "Não
  informado" de novo — não existe "limpar", e `null` é recusado.
- **O sistema não infere.** Nada de consulta à Receita nem dedução pelo número
  do CNPJ, pelo porte, pelo CNAE ou pela razão social: quem escolhe é o
  usuário.
- **MEI é opção independente.** Não existe hierarquia nem conversão
  MEI → Simples Nacional.
- **"Outro" basta.** Não há campo livre para descrever outro regime.
- **Sem efeito em runtime.** Cliente, Projeto, Orçamento, Pedido, Faturamento
  e Precificação se comportam igual para todos os perfis, e não existe mapa
  perfil → alíquota. O consumidor previsto é o Modelo de Precificação
  (PRICING-TEMPLATE-FLEX-01), para SUGERIR modelos compatíveis — nunca para
  determinar imposto; os percentuais continuam explícitos no Modelo.
- **Cliente antigo e carga antiga continuam válidos.** A coluna nasceu com
  default: todo cliente que já existia virou "Não informado", e importador ou
  API que não mandam o campo recebem o mesmo. PATCH sem o campo não mexe no
  perfil gravado; valor fora do enum é 400 de validação.

## §84 — Modelo de Precificação: o que entra no custo que forma o preço

PRICING-TEMPLATE-FLEX-01, 2026-09-11, sobre a decisão do PO de 2026-09-10. No
código e na tela, o Modelo de Precificação é a **Política de Precificação**
(`PricingPolicyTemplate`, TPP): a regra vive na versão da política e é
**copiada** para a precificação do produto (`PricingVersion`) na aplicação —
independente dela depois, como toda matriz de biblioteca.

**O Modelo decide o que entra no custo que forma o preço. Margem e comissão
continuam exatamente como antes.**

- **Custo industrial:** Conforme a Estrutura de Custos (cálculo do ERP) · Não
  considerar · % sobre custo de materiais · R$ por unidade · R$ total. O
  primeiro é o comportamento de antes e o default do banco: todo Modelo e toda
  precificação existentes produzem o MESMO preço. Percentual é sempre sobre o
  custo de materiais da quantidade; R$ por unidade multiplica pela quantidade;
  R$ total entra uma vez no cálculo da faixa.
- **Impostos estimados:** Não considerar · % sobre preço de venda · R$ por
  unidade · R$ total. O percentual NÃO é custo: entra no divisor,
  `P = C ÷ (1 − margem − comissão − impostos)`, e sai de dentro do preço como a
  comissão. R$ por unidade e R$ total somam ao custo. Contribuição = preço −
  comissão − impostos sobre a venda − custo que forma o preço.
- **"Não considerar" não é zero.** O modo é guardado explicitamente; R$ 0,00
  informado é valor. Modo que lê um valor exige o valor — zero vale, ausência
  não.
- **Cada modo tem a SUA coluna, com a base no nome**
  (`industrialCostPercentOfMaterials`, `estimatedTaxPercentOfSalePrice`…) —
  nunca "10%" sem dizer de quê. Trocar de modo não apaga o valor do outro, e
  ele volta a valer quando o modo volta.
- **Custos adicionais administrados externamente:** ligado, custo industrial e
  impostos do Modelo ficam fora da conta com os valores intactos; o custo de
  materiais continua calculado, e margem e comissão continuam no preço. Não
  mexe em preço manual de Orçamento e não é integração financeira.
- **A qualidade é a da base que forma o preço.** No modo do cálculo, a do
  cálculo; nos outros, a dos materiais — energia sem tarifa não bloqueia o
  preço de um Modelo que não depende dela. Material sem custo continua
  bloqueando em qualquer modo. O custo do cálculo (CMV) segue exibido e
  congelado à parte (`costPerUnitSnapshot`); o custo que formou o preço congela
  em `pricingCostPerUnitSnapshot`.
- **Divisor ≤ 0 é recusado em português** ao salvar e ao ativar o Modelo, na
  faixa criada à mão e na prévia — nunca preço infinito, negativo ou `NaN`.
- **Perfis tributários aplicáveis (§83):** vazio = todos; com seleção, o Modelo
  é indicado só para esses perfis. É SUGESTÃO: a lista para um produto diz
  indicado · não indicado · perfil do cliente não informado, e nenhuma política
  some ou é bloqueada. "Não informado" não é perfil de Modelo. O perfil nunca
  calcula imposto.
- **Uma conta só:** `computePricingModelEffect` e `computePrice`, em
  `@veridi/shared`, servem a API, a prévia da política e a prévia da faixa; a
  validação (`validarModeloDePrecificacao`) também — a tela avisa, a API decide.

## §85 — Duplicar como nova versão: a origem é a escolhida, e o preço é decisão explícita

QUOTE-DUPLICATE-01, 2026-09-11, sobre o gate de preço resolvido pelo PO em
2026-09-10 (BACKLOG).

**Duplicar parte da versão que se está lendo — não da mais recente — e nunca
decide o preço sozinho.**

- **Fonte escolhida:** qualquer versão do projeto que não seja rascunho; com
  V1..V3, partir da V1 cria a V4. A versão nova é sempre `DRAFT`, com o próximo
  número do projeto.
- **A origem não muda, e nenhuma outra muda:** duplicar não substitui a enviada
  nem a aceita. O status das anteriores continua sendo decidido pelo aceite
  (§70).
- **Preço: escolha obrigatória, sem padrão.** "Manter os preços desta versão"
  copia `unitPrice` exatamente — sem recalcular, rebasear, consultar a
  precificação atual ou criar vínculo com faixa. "Revisar os preços" deixa a
  linha sem preço (`unitPrice` nulo, o estado canônico de aguardando decisão).
  Sem estratégia, ou com estratégia desconhecida, a API responde 400 e nada
  nasce.
- **Proveniência honesta:** preço mantido de proposta ACEITA é a condição
  acordada (`INHERITED_AGREEMENT`, apontando para a linha real, como §74); de
  qualquer outro estado é referência que alguém decidiu manter (`MANUAL`), com
  o motivo gravado dizendo de qual versão veio — nunca "acordo".
- **Copia o que é da negociação:** produtos, quantidades, unidades, ordem e as
  condições comerciais (moeda, observações, condições de pagamento, prazo,
  desconto, forma, entrada, parcelas, intervalo, juros). A validade vem só se
  ainda estiver vigente — vencida, a versão nova nasce sem ela e o envio pede a
  nova. **Nunca copia história:** envio, aceite, recusa e snapshots de cliente,
  de projeto e de custo.
- **Um rascunho por projeto:** com outro em edição a duplicação é recusada
  (409, com o número do rascunho), nunca devolvida em silêncio.
- **Escopo aprovado:** em projeto aprovado, produto fora do escopo não volta
  por duplicação — a mesma regra de adicionar linha.
- **Transacional:** ou nasce a versão inteira, ou nada nasce.

## §86 — Situação comercial do Cliente: derivada da história, nunca mantida à mão

CUSTOMER-COMMERCIAL-STATUS-01, 2026-09-11, sobre a decisão de produto de
2026-09-09 e os dois gates resolvidos pelo PO em 2026-09-11 (BACKLOG).

**A situação comercial é uma LEITURA do Cliente — Prospect · Cliente ativo ·
Inativo —, derivada dos fatos e das datas. Não é `Customer.active`**, que
continua dizendo se o cadastro pode entrar em documento novo; os dois convivem,
e nenhum decide o outro. Sem coluna, sem job, sem configuração.

**Precedência, de cima para baixo:**

1. **Converteu alguma vez → Cliente ativo, para sempre.** Converter é ter um
   Projeto aprovado (`Project.approvedAt`, ou a aprovação no histórico de
   status) OU um Pedido confirmado (`CustomerOrder.confirmedAt`, ou status além
   do rascunho em registro sem data). Pedido confirmado e cancelado depois
   continua provando; rascunho e Pedido cancelado antes da confirmação, não.
   Não regride por falta de atividade.
2. **Não converteu e tem Projeto aguardando ou em amostra → Prospect.**
   `STAND_BY` e `CANCELLED` não são oportunidade aberta; `APPROVED` já é
   conversão. Voltar de stand-by para aguardando ou amostra devolve Prospect
   na hora, sem botão "Reativar".
3. **Não converteu, sem Projeto aberto, até 15 dias civis desde a última
   atividade comercial relevante → Prospect.**
4. **Passados os 15 dias civis completos → Inativo** — do 16º dia em diante.

**Atividade comercial relevante:** o cadastro do Cliente, a abertura de
Projeto, cada mudança de status de Projeto (entrada em stand-by, cancelamento,
reabertura) e a data de cancelamento. Edição de cadastro e login não contam.
O dia é o **dia civil da Veridi** (`America/Sao_Paulo`, §72), nunca o do
navegador nem o da máquina.

**O que não é atividade — decisão do PO, 2026-09-11
(CUSTOMER-ACTIVITY-SCOPE-01):** Pedido em rascunho não conta, e o envio de
Orçamento, por si só, não reabre a janela. A situação mede o ciclo de
oportunidade e conversão, não o último contato: a oportunidade é o Projeto, e a
conversão continua sendo Projeto aprovado ou Pedido confirmado. Consequência
aceita: Cliente sem conversão cujo único movimento é um Pedido direto em
rascunho vira Inativo passados os 15 dias.

**"Cliente desde"** é o dia da conversão MAIS ANTIGA — primeiro Projeto
aprovado ou primeiro Pedido confirmado —, nunca o do último Pedido.

**O status devolve o motivo** em português de tela ("Projeto X em andamento",
"Pedido confirmado (PED-…)", "Sem atividade comercial há mais de 15 dias · …").

**Listagem:** filtro Clientes ativos · Prospects · Inativos · Todos, com
**Clientes ativos** como padrão da tela de Clientes. A API sem o filtro devolve
todos — os seletores de Cliente das outras telas usam a mesma rota e não podem
esconder Prospect. O filtro decide no banco (a paginação conta certo) e a
situação de cada linha sai dos fatos carregados para a página inteira, sem
consulta por Cliente.

**Não é CRM:** sem funil, sem etapa, sem atividade agendada. E contrato não
dirige a situação (COM-CONTRACT-01).

## §87 — Quantidade de recursos: quantos iguais trabalham juntos, e a mesma hora no custo e na energia

COST-RESOURCE-MULTIPLIER-01, 2026-09-11, sobre as decisões D1–D6 do PO no
mesmo dia.

**A linha de recurso da Estrutura de Custos — e do Modelo de Estrutura — diz
QUANTOS recursos equivalentes trabalham juntos (2 operadores, 3 encapsuladoras
iguais) e quanto tempo CADA um trabalha.** É informação de CUSTO: explica e
forma o número. Não é capacidade, não calcula duração, não aloca pessoa nem
máquina e não conversa com calendário.

- **Conta:** uso efetivo = quantidade de recursos × uso por recurso × escala da
  base (por lote, por unidade ou por mil). 2 operadores × 2 h × R$ 25 = R$ 100;
  3 equipamentos × 2 h × R$ 85 = R$ 510. A quantidade não é lote: 2 × 2 h por
  lote, em dois lotes, são 8 h — nem 16, nem 4.
- **A energia derivada usa a mesma hora efetiva:** 3 equipamentos × 2 h × 5 kW
  = 30 kWh × R$ 0,80 = R$ 24. Equipamento contado três vezes e energia uma é o
  erro que a regra existe para impedir.
- **Quem aceita:** mão de obra e equipamento. Energia informada direto é sempre
  1 — o kWh já é o total do lote —, o servidor recusa outro valor (400) e a
  tela nem mostra o campo.
- **Inteiro, no mínimo 1.** Zero, negativo, fração, texto e nulo são 400 antes
  do domínio, e o banco tem CHECK >= 1. Campo vazio na tela não vira 1 em
  silêncio.
- **Legado:** toda linha existente nasceu 1 na migration, e 1 × uso é o uso de
  antes — nenhum custo mudou, nenhum cálculo salvo foi reescrito, nenhuma
  contagem histórica foi inferida. Cálculo salvo antes do campo lê como 1.
- **Viaja com o plano:** o Modelo guarda, aplicar o Modelo copia, nova versão
  copia, salvar a estrutura como Modelo leva junto. Não é snapshot econômico:
  é premissa de como se produz.
- **Uma linha por recurso continua.** Arranjo misto no mesmo lote — 2 × 2 h na
  mistura e 1 × 1 h no envase — entra consolidado, com quantidade 1 e 5 h.
  Roteiro, etapa e várias linhas do mesmo recurso ficam fora desta fase.
- **Uma conta só:** `plannedUsageQuantity` e `scaledUsageQuantity`
  (`industrial-cost-calculation/calculation.service.ts`) são os únicos que
  multiplicam a quantidade. Cálculo da estrutura, cálculo salvo, CMV, faixa de
  precificação (`costForOutputQuantity`) e energia derivada leem daí; a tela
  não multiplica — o total chega pronto do servidor.
- **Leitura:** onde se lia "4 hora" passa a se ler "2 × 2 hora · Total: 4 hora"
  quando há mais de um recurso — estrutura, impresso, composição do cálculo,
  CMV e Modelo. Com um recurso, a leitura é a de antes.

## §88 — Ajustes da quantidade: o Modelo guarda a mesma intenção, e o painel tem fim

FORMULATION-ADJUSTMENTS-UX-01, 2026-09-11.

**O Modelo de Formulação guarda a MESMA configuração do componente da
Formulação real (§52):** o que a quantidade significa (física informada ou
calculada), a pureza, o overage e quais ajustes entram na conta. Não bastam os
percentuais: sem o modo, todo Modelo aplicado virava física informada, e a
intenção "corrija pela pureza" se perdia na cópia.

- **Uma normalização só.** Modelo e Formulação gravam modo e marcas pela mesma
  regra (`modoEFlags`): marca ligada sob física informada não se grava. Em
  física informada a quantidade digitada JÁ é a física — pureza e overage são
  registro de auditoria; em calculada, só entra o ajuste marcado, pelo motor
  canônico.
- **Null não é zero.** Pureza ou overage em branco continuam `null`; zero
  informado continua zero.
- **Cópia, nunca vínculo.** Aplicar o Modelo copia a configuração como
  snapshot; nova versão do Modelo e "salvar a Formulação como Modelo" levam
  junto; o comparativo entre versões mostra interpretação e marcas. Mudar o
  Modelo depois não muda a Formulação já criada.
- **Modelo antigo não muda de resultado.** Sem modo gravado é física informada
  sem ajuste — o que ele sempre significou. Nenhum componente passou a aplicar
  pureza ou overage sozinho, e nenhuma migration foi necessária: as colunas já
  existiam no banco.
- **A tela do Modelo carrega a linha inteira.** Salvar pela tela recria os
  componentes; base, pureza, overage e notas passaram a viajar junto — antes,
  voltavam ao padrão do banco.

**O painel de ajustes edita um rascunho da linha.** "Aplicar ajustes" confirma
— a linha muda, a conta segue, o painel recolhe e a linha resume o estado
("Calculada · Pureza 98% · Overage 2%", ou "Física informada · Pureza 98% · só
registro"). "Cancelar" descarta só o que foi mexido desde que o painel abriu.
Aplicar fica desabilitado sem alteração ou com valor inválido. Fechar o
painel, salvar ou ativar com ajuste por aplicar é recusado com a linha
nomeada: nada se perde em silêncio, e nada vai para a versão sem ser
confirmado. É o mesmo painel na Formulação e no Modelo.

**Equivalente estoque e Físico / unidade têm cada um a sua coluna**, alinhados
à direita, com a unidade colada ao valor. Em tela estreita a linha vira cartão:
cada valor técnico com o seu rótulo, sem rolagem lateral.

## §89 — Perfil de Produção: como o produto é normalmente produzido — capacidade, não custo

PLANNING-PRODUCTION-PROFILE-01 e PLANNING-OP-SNAPSHOT-01, 2026-09-11. Primeira
fundação do módulo Planejamento, e a cópia do perfil para a Ordem de Produção.

> **Nome na interface (PRODUCTION-ROUTE-UX-01, 2026-09-12):** o usuário lê
> **Roteiro de Produção**, e "quantidade-base" lê-se **quantidade de
> referência**. Decisão do Product Owner. O nome de domínio segue
> `ProductionProfile` — rota, API, schema e este parágrafo inclusive —, e a
> regra abaixo não mudou nenhuma vírgula. Ao mexer nas telas, mantenha a
> palavra da interface; ver `UI_BRAND.md`.

**Perfil de Produção é o roteiro reutilizável de COMO um produto é
produzido:** etapas em ordem, tempo de preparação e de execução, modo de
escala e os recursos que cada etapa ocupa ao mesmo tempo. Não é Formulação (o
que entra), não é Estrutura de Custos (quanto custa), não é Ordem de Produção
(o que foi mandado fazer). Planejar não muda estoque, custo, CMV,
precificação, tarifa, formulação nem OP.

- **Versionado como as bibliotecas** (`TemplateVersionStatus`): nasce com a V1
  em rascunho; só o rascunho se edita; ativar congela; mudar exige versão
  nova, copiada inteira da ativa, e a anterior fica ARQUIVADA, nunca apagada.
  Um rascunho e uma ativa por perfil (serviço e índice parcial). Versão sem
  etapa não ativa.
- **Quantidade-base** (`referenceQuantity` + `referenceUomCode`, maior que
  zero): os tempos de execução se referem a ela. Produto só adota o perfil com
  a base na MESMA dimensão da unidade do item de produto acabado; produto sem
  item não tem unidade para comparar e é recusado. Nada se converte entre
  dimensões.
- **Etapas sequenciais:** a posição na lista é a sequência (1, 2, 3…) e a
  etapa N começa depois da N−1. Sem paralelismo, dependência arbitrária ou
  sobreposição.
- **Preparação ≠ execução**, em minutos inteiros ≥ 0, e a etapa precisa de um
  dos dois maior que zero. **Preparação não escala:** 30 min para 1 lote ou
  para 3.
- **Proporcional:** execução × quantidade ÷ base — 2 h por 1.000 un viram 6 h
  para 3.000 un. **Por lote:** execução × ceil(quantidade ÷ base) — 1.500 un
  em lotes de 1.000 são 2 lotes e 4 h, nunca regra de três. Decimal do começo
  ao fim.
- **Capacidade, não custo:** `resourceQuantity` é quantos recursos iguais
  trabalham AO MESMO TEMPO, inteiro ≥ 1 (CHECK no banco; zero, fração, texto e
  nulo são 400). 2 operadores × 2 h são etapa de 2 h e **4 horas-recurso** — a
  etapa não dura 4 h. É outra pergunta que o `resourceCount` de custo (§87)
  responde, e nenhum dos dois depende do outro.
- **Duração da etapa** = preparação + execução. **Demanda do recurso** =
  quantidade de recursos × duração da etapa: recurso anexado à etapa é
  necessário durante a etapa INTEIRA, preparação inclusive — preparação de
  30 min e execução de 120 min com 2 recursos são etapa de 150 min e 300
  min-recurso (5 horas-recurso). Não existe fase por recurso (só preparação,
  só execução) nem quantidade diferente por fase: se for preciso, é evolução
  futura. **Total** = soma das durações.
- **Recurso é pool do cadastro de Recursos Industriais:** mão de obra e
  equipamento, ativos, uma linha por recurso na etapa — nunca pessoa ou
  máquina individual. **Energia não é recurso de capacidade** e é recusada
  (400): ela continua no custo.
- **Simulação não grava:** a prévia usa o motor canônico
  (`planProductionProfile`, em `@veridi/shared`) na tela e no servidor
  (`GET /production-profile-versions/:id/preview`). Sem calendário, turno,
  feriado, data sugerida nem capacidade diária.
- **Produto → perfil padrão:** ponteiro opcional para uma VERSÃO ATIVA
  (`Product.defaultProductionProfileVersionId`). Produto sem perfil continua
  válido. **Ativar uma versão nova leva junto**, na MESMA transação da
  ativação, os produtos que apontavam para a versão anterior DESTE perfil: o
  padrão é a configuração que as PRÓXIMAS ordens devem usar. Produto sem
  perfil, ou apontando para outro perfil, não é tocado — o sistema acompanha
  um padrão já escolhido, nunca associa sozinho. Ordem de produção existente
  não muda: ela recebe cópia.
- **A OP recebe CÓPIA, nunca vínculo vivo** (PLANNING-OP-SNAPSHOT-01,
  2026-09-11). Criar a Ordem de Produção copia integralmente o perfil padrão do
  Produto (contrato `ProductionProfileSnapshot`, gravado em
  `production_order_planning_snapshots`): identificação e número da versão,
  quantidade-base e unidade, etapas em ordem com preparação, execução, modo de
  escala, e os recursos com quantidade simultânea, código, nome e tipo. Rascunho
  não é copiável. Vale para a OP manual e para a do Plano de Atendimento.
  - **O instante manda:** padrão em V2 na criação, a OP leva a V2; ativar a V3
    depois não altera essa ordem, nem enquanto ela é rascunho.
  - **A duração não é gravada:** é projetada a cada leitura pelo mesmo motor
    (`planProductionProfileSnapshot`) para a `plannedQuantity` do momento — base
    de 1.000 un com 2 h de execução são 6 h numa OP de 3.000 un. Mudar a
    quantidade em rascunho recalcula duração, lotes e demanda usando a MESMA
    cópia, sem recopiar o perfil.
  - **Produto sem perfil padrão:** a OP nasce sem cópia e continua válida —
    criação, planejamento e liberação seguem. A tela diz "Sem perfil de produção
    aplicado.". OP anterior à migration fica sem cópia e não é preenchida
    retroativamente.
  - **Aplicar e atualizar são ações de RASCUNHO.** OP em DRAFT sem cópia aplica
    o padrão atual do Produto quando existe um ativo; com cópia de versão
    diferente da atual, mostra aviso discreto e permite atualizar, com
    confirmação. As duas ações substituem a cópia inteira, atomicamente. Trocar
    o Produto em rascunho troca a cópia pelo padrão do produto novo, e a remove
    quando o novo não tem perfil — nunca fica a do anterior.
  - **Fora de DRAFT a cópia é imutável:** aplicar, atualizar ou substituir são
    recusados, mesmo existindo versão mais nova.
  - **Recurso renomeado ou desativado não reescreve o histórico:** nome, código
    e tipo viajaram por valor. Os ids guardados são proveniência para a
    capacidade futura, nunca canal de leitura.
  - A OP continua sem data por etapa, turno, disponibilidade, agenda,
    capacidade diária ou Gantt: isso é PLANNING-CAPACITY-BOARD-01. O
    calendário da fábrica já existe (§90), e ele não agenda ordem nenhuma —
    diz só em que dias e em que horário se trabalha. E sem tocar custo:
    Estrutura de Custos, CMV, Precificação e tarifas seguem separados.

## §90 — Calendário de Produção: quando a fábrica trabalha, e em que dias não trabalha

PLANNING-CALENDAR-01, 2026-09-12. **Absorve OPS-CALENDAR-01** (BACKLOG B · #9)
por decisão do Product Ownership: é a mesma necessidade, e dois itens criariam
duas tabelas para um conceito só.

**O calendário de produção responde uma pergunta, e só ela: a fábrica opera
neste dia, e por quantos minutos?** Não agenda Ordem de Produção, não guarda
capacidade de recurso, não tem turno e não desenha quadro — isso é
PLANNING-CAPACITY-BOARD-01.

- **Um calendário, global, e o banco garante.** A chave primária é o próprio
  conceito (`GLOBAL`, com CHECK): não existe lista de calendários, não existe
  coluna `active` e não há como uma segunda linha nascer. Mão de obra e
  equipamento continuam POOLS (§89) e herdam esta jornada. Calendário por
  recurso, setor, turno ou cliente fica para necessidade real.
- **Jornada = janela do dia − intervalo.** Horário inicial e final em MINUTO DO
  DIA, inteiros de 0 a 1440, com `0 <= início < fim <= 1440` e
  `0 <= intervalo < (fim − início)` — CHECK no banco, e a mesma regra em
  `@veridi/shared` para a mensagem da tela. O intervalo é o TOTAL do dia, uma
  soma e não um horário: não há pausa nomeada nem parada parcial por hora nesta
  fase. **Minutos úteis são derivados a cada leitura**, nunca uma coluna.
- **Hora do dia não é instante.** `08:00` não tem data, não tem fuso e não muda
  no horário de verão; um `DateTime` fabricado para representá-la obrigaria a
  inventar um dia e um deslocamento, e a jornada andaria uma hora cinco meses
  por ano. A tela mostra `HH:mm`; o que viaja e o que se guarda é o minuto.
- **Dias operantes são sete perguntas independentes**, com CHECK de "ao menos
  um" — calendário sem nenhum dia é cadastro sem sentido, não fábrica parada.
  **Sábado e domingo operantes são JORNADA, nunca exceção.** Calendário novo
  nasce segunda a sexta, 08:00–17:00, 1 h de intervalo, e esse padrão vale só
  no primeiro salvamento: **ler nunca cria**, e quem já salvou nunca é
  sobrescrito por ele.
- **Exceção é DIA CIVIL INTEIRO sem operação** — `FERIADO`, `RECESSO`,
  `PARADA_OPERACIONAL` ou `OUTRO`, com motivo livre. **Uma exceção por data**,
  garantida por unique: cadastrar de novo a mesma data é recusa explícita com o
  motivo que já está lá (409), nunca sobrescrita silenciosa nem dois motivos
  empilhados. Editar troca tipo e motivo; **a data não se move** — mudar de dia
  é excluir esta e cadastrar a outra, para que um feriado nunca ande sem
  registro. Feriado é declarado à mão: sem recorrência anual (`25/12/2026` é um
  registro de data, não a regra "todo 25/12", e feriado móvel não tem algoritmo
  cívico aqui) e sem API externa.
- **Dia útil operacional = dia permitido pela semana E não cadastrado como
  exceção.** As duas metades são independentes, e a conta vive em DIA CIVIL e
  MINUTO DO DIA — `diaDaSemanaComercial`, `ehDiaOperacional`,
  `minutosUteisDoDia`, `proximoDiaOperacional`, `proximoInicioUtil`. Aritmética
  de calendário não é aritmética de relógio: somar 24 h a um instante atravessa
  a meia-noite comercial na hora errada num dia de 23 ou 25 horas. Quem parte de
  um INSTANTE converte uma vez, por `hojeComercial` (§81), no `FUSO_COMERCIAL` —
  nunca por um `-03:00` escrito à mão.
- **Nada passa a depender de dia útil por causa disto.** Tarifa industrial,
  oferta de fornecedor, `ItemCostReference`, validade de lote, `referenceDate`,
  faturamento e **a promessa de entrega ao cliente (§75)** seguem exatamente
  como estavam: um feriado não vence uma oferta e não move uma entrega
  prometida. Promessa caindo em dia não operante é assunto de alerta, quando
  houver planejamento para alertar. `ProductionOrder` não foi tocada — sem
  `plannedStartAt`, sem agenda, sem etapa com data, e `plannedAt` continua sendo
  o carimbo do ATO de planejar, nunca a data planejada.
- **Escrita para produção e administração**, leitura para todos: mesmo gate dos
  Perfis de Produção. Excluir uma exceção é seguro enquanto nenhum planejamento
  depende do calendário; a regra para data que já participou de planejamento
  calculado nasce com PLANNING-CAPACITY-BOARD-01.
- **O intervalo ganhou HORÁRIO em PLANNING-CAPACITY-BOARD-01** (§91):
  `breakStartMinuteOfDay`/`breakEndMinuteOfDay`, e `breakMinutes` passa a ser
  derivado da diferença quando a posição existe. Calendário anterior chega com
  as duas colunas NULAS e continua válido — só a agenda com hora exata é que
  recusa até alguém configurar.

---

## §91 — Programação de Produção: quando a ordem acontece, e onde a fábrica aperta

PLANNING-CAPACITY-BOARD-01, 2026-09-12. Junta o Roteiro (§89), o Calendário
(§90) e a capacidade do recurso numa resposta operacional: quando cada ordem
está prevista e onde há conflito.

**Capacidade é do POOL, e `null` não é zero.**
`IndustrialResource.capacityQuantity` diz quantos daquele recurso podem
trabalhar AO MESMO TEMPO — "Operadores de Produção = 5" são cinco operadores
quaisquer, nunca cinco cadastros de pessoa. NULL significa **capacidade ainda
não cadastrada**: o planejamento avisa a lacuna e não confere sobrecarga, em
vez de acusar excesso sobre um número que ninguém informou. Só mão de obra e
equipamento têm capacidade; energia não ocupa recurso e é recusada no banco
(CHECK) e na API.

**O início é HUMANO. O sistema projeta, e nunca escolhe.** Não há busca de
primeiro horário livre, prioridade automática, paralelização de etapas nem
reprogramação por causa de conflito. Início fora da jornada — domingo,
feriado, antes de abrir, dentro do intervalo — é **recusado com o motivo e com
a sugestão do próximo horário válido**; usar a sugestão é outro clique.
Deslocar em silêncio faria a pessoa programar um turno e descobrir outro.

**Envelope não é ocupação.** A agenda guarda duas grandezas diferentes:
`plannedStartAt`…`plannedEndAt` é o ENVELOPE (inclui noite, fim de semana e
feriado no meio) e `workSegments` são os trechos EFETIVAMENTE trabalhados.
Capacidade, conflito e carga se contam pelos segmentos. Uma etapa que começa
sexta às 16:00 e termina segunda às 09:00 tem três dias de envelope e duas
horas de ocupação — contar pelo envelope diria que a encapsuladora passou o
fim de semana ligada.

**Agenda gravada é SNAPSHOT.** Alterar jornada, intervalo, feriado ou recesso
depois NÃO reescreve programação existente, e excluir a exceção que motivou
uma agenda também não a altera (decisão do PO: manutenção do calendário não
fica presa ao histórico). Recalcular é ação explícita — definir o início de
novo. Nada é recalculado sozinho.

**O ciclo de vida da ordem manda.** `DRAFT` e `PLANNED` definem e movem;
`RELEASED` move **só com confirmação explícita**, porque já há separação em
curso do outro lado; `IN_PRODUCTION`, `COMPLETED`, `CANCELLED` e `BLOCKED`
travam — a agenda vira referência histórica e continua legível.
`ProductionOrderSchedule` é 1:1 com a OP e **não reaproveita `plannedAt`**,
que continua sendo o carimbo do ATO de planejar.

**Conflito é AVISO, nunca bloqueio.** Demanda simultânea acima da capacidade
cadastrada vira sobrecarga na tela e na resposta; a programação é gravada do
mesmo jeito. Os avisos são explícitos e nunca corrigidos em silêncio:
capacidade não cadastrada, recurso inativo, sobrecarga, ordem sem roteiro,
etapa sem recurso, etapa sem duração, calendário sem horário de intervalo, e
prazo do cliente em risco quando a ordem vem de um Pedido com
`requestedDeliveryDate` — **sem mover promessa, pedido nem data** (§75).

**Duração vem do motor de sempre.** `planProductionProfileSnapshot` sobre a
cópia congelada do Roteiro (§89), para a quantidade da ordem. Não existe um
segundo cálculo de duração de OP neste repositório.

**Fora de escopo, e deliberadamente:** autoagendamento, otimizador, grafo de
dependências, etapas em paralelo, arrastar e soltar, calendário por recurso,
turnos múltiplos, pessoa ou máquina individual, manutenção e reprogramação em
massa.

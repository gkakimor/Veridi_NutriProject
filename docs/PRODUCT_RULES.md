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
  registration. A new negotiation is always a new version, and the
  previously presented version becomes superseded.
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

`window.print()` stays the output mechanism (print or save as PDF, in the
browser — there is no PDF engine in the backend). The **source**, however,
is always a dedicated print view: the operational screen itself is never
printed, so paper never carries sidebar, toolbar, filters, pagination or
buttons.

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
- FAST MVP implements printing as **print-oriented HTML +
  `window.print()`** — no PDF library, consistent with the existing lot
  label print route.
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
- PDF is produced by the browser: print-oriented HTML plus `@media print`
  and `window.print()`. FAST MVP has no backend PDF engine, no headless
  browser and no stored PDFs.
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
- **The global discount is not spread across lines.** The system has no
  apportionment rule, and inventing one would create a per-line price nobody
  agreed to. Line prices, discount, subtotal and total are preserved side by
  side; the deal reproduces from those.
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

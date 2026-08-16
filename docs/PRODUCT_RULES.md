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

## Invoicing
Invoicing reflects what is actually delivered, not necessarily the
originally ordered quantity (e.g. order 1000, deliver 600 → invoice 600).
Partial deliveries/invoicing must be supported eventually. Commercial
invoicing and Brazilian fiscal NF issuance are related but distinct
concepts — do not merge them prematurely; fiscal integration remains its
own future evolution (see `docs/BACKLOG.md`).

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

# 30. Block E — Management, Reports & Exports (registered, not started)

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

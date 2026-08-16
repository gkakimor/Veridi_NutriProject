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

---

# 23. Actual consumption

Final material deduction is based on **actual confirmed consumption**.

Example:
- reserved = 30 kg;
- consumed = 28 kg;
- consume 28 kg from On Hand;
- release remaining 2 kg reservation.

Actual consumption stores:
- OP;
- item;
- actual lot;
- quantity;
- user/time.

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

# 29. Customer Orders & Fulfillment Plan (Block D — future, not started)

Registered from Product Ownership brainstorm. No schema defined; no
implementation started. Depends on Inventory, Reservation, Formulations,
Production Order and Finished Product being complete first.

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

## Purchase suggestion
When raw material/packaging is short, the system may generate a purchase
suggestion/draft. It never confirms a Purchase Order automatically.
Conceptual flow: shortage → purchase suggestion → user review → PO DRAFT →
user confirms the PO later. This is an Evolução Incremental item (26),
outside MVP Core initially.

## Shipping
When finished product is available: Order → Picking → Shipping. Partial
delivery must be possible eventually. No advanced logistics/WMS now.

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

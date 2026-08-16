# Veridi Nutrition — MVP Plan v0.4

## Goal
Replace the most fragile spreadsheet/manual controls with a small but complete operational cycle for:
- purchasing;
- receiving;
- lot-controlled inventory;
- production;
- traceability.

The MVP should be operationally useful from the first releases and must not attempt to become a full ERP.

---

# Official MVP sequence

## Block A — Base
1. Users
2. Customers
3. Suppliers
4. Items
5. Products

## Block B — Purchasing & Inventory
6. Simple Purchase Order
7. Receiving
8. Lots
9. QR Code / Labels
10. Inventory
11. Inventory Movements
12. FEFO

## Block C — Production
13. Formulations
14. Formulation Versioning
15. Production Order (OP)
16. Material Requirement Calculation
17. Material Reservation
18. QR Picking
19. Actual Consumption
20. Partial Production / Completion
21. Finished Product ✓

## Block D — Orders & Fulfillment
22. Customer Order ✓
23. Availability Analysis / Fulfillment Plan ✓
24. Finished-Product Reservation ✓
25. Suggested Production Orders ✓
26. Purchase Suggestion ✓
27. Picking / Shipping ✓
28. Invoicing ✓

Block D depends on the foundation from Blocks B/C: Inventory, Reservation,
Formulations, Production Order, Finished Product — all complete.
**Block D is functionally complete as of Delivery 19.**

## Cost foundation (transversal prerequisite)
29. Material cost foundation ✓

Establishes trustworthy operational costing before any dashboard/report
tries to show money. Strictly separates **PO price** (expected/negotiated)
from **effective acquisition cost** (the real reference) from **actual
payment** (future financial layer, out of scope).

## Block E — Management, Reports & Exports (transversal layer)
30. Executive/Operational Dashboard ✓
31. Reports ✓
32. CSV / PDF / Print exports

Block E is a **transversal layer**, executed only **after** 26 (Purchase
Suggestion), 27 (Shipping), 28 (Invoicing) and 29 (Cost foundation) are
done, and **before** end-to-end validation / final demo. It reads existing
operational entities — it never introduces a new source of truth.

---

# Official roadmap (Product Ownership decision)

```text
26 Purchase Suggestion ✓
→ 27 Shipping ✓
→ 28 Invoicing ✓
→ 29 Material cost foundation ✓
→ 30 Executive/Operational Dashboard ✓
→ 31 Reports ✓
→ 32 CSV/PDF/Print exports
→ end-to-end validation / demo
→ responsive/mobile hardening
→ later technical hardening
```

Guiding principle registered with the cost foundation: **first know what
the material/product cost; only later evolve to know when and how much
money actually left the cash register.** Accounts payable and the wider
financial layer stay in the backlog.

---

# Roadmap classification

**MVP Core** — steps 1–21 (Blocks A–C). Complete except Users.

**MVP Ampliado** — steps 22–25 (Customer Order, Availability Analysis /
Fulfillment Plan, Finished-Product Reservation, Suggested Production
Orders). Complete.

**Evolução incremental** — steps 26–28 (Purchase Suggestion, Picking /
Shipping, Invoicing). Complete.

**Cost foundation** — step 29. Complete. Prerequisite for any money-aware
dashboard/report.

**Transversal layer** — steps 30–32 (Block E). Registered officially, not
started — its dependencies (Invoicing 28, Cost foundation 29) are done,
so it is the next scheduled work.

---

# Benchmark-driven MVP improvements

The following capabilities are **inside the existing 21 steps**. They do not create new modules.

## Purchase Orders
Include:
- draft;
- ordered;
- partially received;
- received;
- cancelled;
- partial receiving;
- quantity still open;
- expected delivery date when known.

A confirmed Purchase Order contributes to the concept of **On Order / Em Compra**.

## Receiving
Include:
- receiving from Purchase Order;
- partial receiving;
- supplier lot;
- expiry;
- quantity;
- related NF/document reference when available;
- optional document/PDF attachment per received lot;
- simple quality availability status;
- physical location;
- automatic internal lot identity.

## Lots
Each physical controlled lot must preserve:
- internal immutable lot ID;
- human-readable internal lot code;
- supplier lot;
- supplier;
- item;
- expiry;
- received quantity;
- current status;
- simple location;
- attachments/documents;
- movement/traceability history.

## QR / Labels
Include:
- system-generated QR;
- printable label;
- scan by mobile/tablet camera;
- manual code fallback;
- supplier barcode field when available.

QR must resolve the internal lot identity.
Do not encode mutable stock values as source-of-truth data in the QR payload.

## Inventory
Expose at minimum:
- On Hand / Physical;
- Reserved;
- Available;
- On Order / Em Compra.

Concept:
`Available = On Hand - Reserved`

"On Order" is informative and does not count as available stock.

## Inventory Movements
Include:
- receiving;
- production consumption;
- inventory adjustment;
- loss;
- return to stock;
- finished-product production;
- traceable source/reference.

Also include a simple **Physical Inventory / Stock Count** workflow:
1. record counted quantity;
2. compare system vs physical;
3. require reason for difference;
4. create auditable adjustment;
5. never overwrite history silently.

## FEFO
Default lot suggestion:
**First Expire, First Out**.

Allow one requirement to allocate across multiple lots.

Expired/blocked lots are excluded from normal allocation.

## Traceability
Traceability must work in both directions:

### Forward
Raw-material lot
→ Production Orders that consumed it
→ Finished-product lots produced

### Backward
Finished-product lot
→ Production Order
→ actual raw-material/packaging lots consumed

This is part of MVP, not future scope.

---

# Why this order

- Master data provides stable references.
- Purchase Orders show what is already being purchased.
- Receiving converts incoming goods into traceable lots.
- QR labels connect physical material to the system.
- Inventory movements become the auditable source of truth.
- FEFO guides operational selection.
- Formulation versions become the official production basis.
- OP turns demand into planned production.
- Requirement calculation exposes shortages.
- Reservation prevents double allocation.
- QR picking validates the physical lot.
- Actual consumption creates final material deduction.
- Production output creates finished-product lots.
- Bidirectional traceability closes the industrial genealogy.

---

# MVP ready-for-validation definition

The MVP is ready for operational validation when users can:

1. create required master data;
2. create and confirm a Purchase Order;
3. partially or fully receive a Purchase Order;
4. receive material with supplier lot, expiry and quantity;
5. attach/reference a document to the received lot;
6. generate an internal lot code;
7. print a QR label;
8. locate the lot physically;
9. scan the lot by mobile/tablet;
10. see On Hand, Reserved, Available and On Order quantities;
11. run a simple physical stock count and adjustment;
12. create/version a formulation;
13. create an OP tied to an exact formula version;
14. calculate raw-material and packaging needs;
15. show shortages before OP release;
16. reserve available material;
17. suggest lots using FEFO;
18. scan/confirm picking;
19. record actual consumption;
20. release unused reservation;
21. record partial/final production;
22. create a finished-product lot;
23. trace finished product backward to raw-material lots;
24. trace a raw-material lot forward to affected production/output lots;
25. review auditable inventory movements.

---

# Explicitly outside this MVP

See `docs/BACKLOG.md`.

Do not implement future items simply because they appear easy.

---

# Delivery strategy

Build **vertical slices**, not every database table first.

Recommended delivery order:

### Foundation
- monorepo bootstrap;
- Veridi ERP shell;
- authentication/user identity;
- first CRUD pattern.

### Base
- items;
- suppliers;
- customers;
- products.

### Purchasing slice
- Purchase Order;
- partial receiving;
- received-lot creation;
- attachment reference;
- internal lot + QR label.

### Inventory slice
- lot view;
- location;
- movement ledger;
- On Hand / Reserved / Available / On Order;
- stock count/adjustment;
- FEFO service.

### Production slice
- formulation/version;
- OP;
- requirement calculation;
- shortage view;
- reservation;
- QR picking;
- actual consumption;
- partial output;
- finished-good lot;
- bidirectional traceability.

Avoid implementing later blocks before the current slice works end-to-end.

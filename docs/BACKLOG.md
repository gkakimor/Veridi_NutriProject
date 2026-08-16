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
- raw material;
- packaging;
- labor;
- production;
- freight;
- taxes;
- commissions;
- markup;
- margin.

Future dedicated costing module.

## Accounts payable / finance
Not part of the operational MVP.

---

# HR
Only expand beyond user/access identity if clear business value emerges.

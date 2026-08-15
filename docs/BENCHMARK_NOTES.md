# Veridi Nutrition — Benchmark Notes v0.4

This is a concise rationale document.
It is not required for normal implementation tasks.

Benchmarks considered:
- MRPeasy;
- Odoo Manufacturing / Inventory / Barcode;
- Katana;
- ERPNext.

The objective was not to copy a full ERP.
The objective was to validate:
- business-flow decisions;
- inventory concepts;
- scan-first UX;
- traceability;
- future backlog.

---

# MRPeasy — primary functional benchmark

Useful patterns:
- small-manufacturer positioning;
- lot traceability;
- material booking/reservation;
- production orders;
- expected/future stock;
- certificates/documents tied to lots;
- forward/backward production genealogy.

Applied to Veridi MVP:
- bidirectional traceability;
- lot documents;
- distinguish stock/reserved/on-order concepts;
- maintain reservation separately from consumption.

Do not copy:
- complete MRP/planning scope;
- broad ERP feature set.

---

# Odoo — inventory/process benchmark

Useful patterns:
- FEFO;
- lots/serials;
- barcode workflows;
- receiving/quality concepts;
- modular navigation.

Applied to Veridi MVP:
- FEFO;
- simple release/block status;
- barcode/QR operational workflow;
- module-oriented sidebar/navigation.

Future only:
- GS1;
- complex multi-step receiving;
- PLM/ECO;
- full quality workflows.

---

# Katana — UX benchmark

Useful patterns:
- simple small-manufacturer UX;
- focused receiving;
- barcode-driven warehouse operations;
- partial Purchase Order receiving;
- batch creation/confirmation at receiving.

Applied to Veridi MVP:
- scan-first receiving;
- partial receiving;
- mobile/tablet focused floor workflows;
- fewer clicks and less typing.

---

# ERPNext — domain-integrity benchmark

Useful patterns:
- batch-controlled inventory discipline;
- expiry;
- negative-stock protection;
- batch/serial editing near the transaction;
- manufacturing relationships.

Applied to Veridi MVP:
- lot-controlled integrity;
- explicit state transitions;
- stock count adjustment rather than silent overwrites;
- compact operational editing where safe.

---

# Product conclusion

The benchmark did **not** require redesigning the Veridi core product.

It reinforced the current direction and added these MVP refinements:
- partial PO receiving;
- On Order quantity;
- documents per lot;
- simple lot location;
- simple physical inventory count;
- optional supplier barcode;
- bidirectional traceability;
- simple lot Quality availability;
- improved scan-first UX;
- ERP sidebar shell.

Everything else remains backlog until justified by real use.

# Veridi Nutrition — Technical Baseline v0.4

## Architecture
Use a modular monolith.

Target shape:

```text
apps/
  web/
  api/

packages/
  shared/
```

Suggested API modules as needed:

```text
auth
users
customers
suppliers
items
products
purchase-orders
receiving
lots
inventory
formulations
production-orders
production
traceability
reports
```

Do not scaffold every module before needed.

---

# Stack
- React
- Vite
- TypeScript
- Node.js LTS
- Fastify
- PostgreSQL
- Prisma
- Zod/Fastify validation
- Vitest
- pnpm workspace preferred

---

# API rules
- Business rules live server-side.
- Validate every write input.
- Use explicit domain/service functions for state transitions.
- Use database transactions for multi-step changes.
- Return explicit domain errors.
- Never trust client-calculated stock balances.
- Do not let React be the only enforcement point for inventory/OP rules.

---

# Database principles
Use relational integrity.

Prefer immutable internal IDs independent of human-readable codes.

Core relationships should be easy to query:

```text
Supplier
→ Purchase Order
→ Receipt
→ Received Lot
→ Inventory Movement

Product
→ Formulation
→ Formulation Version
→ Production Order
→ Requirement
→ Reservation
→ Actual Lot Consumption
→ Finished Product Lot
```

Do not hide critical history only in JSON blobs.

## Migration order

`prisma migrate deploy` applies pending migrations in folder-name order. On
an existing database that order is invisible — only what is missing gets
applied, in the order the folders arrived. On an empty database it is the
real order. Rules:

- a migration may only reference tables, types and columns created by a
  migration with a smaller-or-equal name. `scripts/migration-order.test.ts`
  checks this statically as part of `pnpm test`;
- folder names carry the real timestamp of the session that created them
  (`YYYYMMDDHHMMSS_snake_case`), never a future date;
- `pnpm validate:migrations:fresh` proves the rebuild against a throwaway
  database on the local Postgres. It goes through `scripts/local-db-guard.mjs`
  (local host only, never Railway) and drops the database at the end. Run it
  before merging any migration;
- never edit the SQL of a migration production already applied. To repair
  ordering, rename the folder to a name after its dependency and make its
  statements idempotent (`IF NOT EXISTS`) so it applies as a no-op where the
  old name already ran. `migrate deploy` ignores checksums of applied rows
  and tolerates orphan rows in `_prisma_migrations`; an orphan row may be
  deleted later in a coordinated window, never before the renamed migration
  has run there.

Repair record (2026-09-04): `20260904093000_template_component_quantity_mode`
renamed to `20260921093000_…` because it depended on
`20260921090000_formulation_templates`. Alternatives compared: editing the
historical SQL (rejected — rewrites applied history), baseline squash
(rejected — loses per-migration history and needs `migrate resolve` on every
existing database), repair migration with existence guards (works, but keeps
a pair that only applies out of order), rename plus `migrate resolve
--applied` in production (works, needs a manual production step). Rename plus
idempotent columns needs no manual step anywhere.

New environment from zero: create the database, set `DATABASE_URL` in
`.env`, run `pnpm --filter @veridi/api exec prisma migrate deploy`, then
expect `Database schema is up to date` from `prisma migrate status`.

---

# Purchase Order / receiving
Support partial receiving at the data-model level.

Track:
- ordered;
- received;
- remaining/open.

One PO item can produce multiple receipt records/lots.

Do not model receiving as a single boolean on the PO.

---

# Inventory
Do not implement inventory as only one mutable `quantity` field.

Maintain an auditable event/history model.

The system must derive or safely maintain:
- On Hand;
- Reserved;
- Available;
- On Order.

Reservation is not physical consumption.

Use transactions for:
- receipt confirmation;
- reservation;
- reservation release;
- actual consumption;
- adjustment;
- finished-product production.

Concurrency safety becomes part of later hardening, but avoid designs that make it impossible.

---

# Physical inventory
Stock count creates adjustment transactions.

Do not directly replace lot quantity with counted quantity.

---

# Lot identity
Use:
- immutable internal UUID/ID;
- human-readable internal lot code;
- supplier lot field.

QR points to immutable lookup identity.

Do not couple lot identity to mutable location/status/quantity.

---

# Documents
MVP supports file metadata/storage association for lot documents.

Keep abstraction simple.

Do not implement OCR, PDF extraction or XML parsing yet.

---

# QR / scanning
Scanning should work in browser on tablet/mobile where practical.

Do not couple domain logic to one scanner/vendor.

Support manual input fallback.

Supplier barcode can be stored even if advanced scan-to-PO behavior is postponed.

---

# UI
Follow `docs/UI_BRAND.md`.

Default application shell:
- top masthead;
- left sidebar;
- main workspace;
- optional drawer.

Do not build the previous permanent 3-column query-builder shell.

---

# Printing
MVP can use:
- browser print;
- print-friendly HTML;
- simple generated PDF if needed.

Do not add a print server before hardware/printer requirements are known.

---

# Authentication
Start simple.

Keep user identity available for audit.

Server-enforce authorization.

Do not build a full HR system.

---

# Testing — FAST MVP
Do not optimize for coverage percentage.

Prioritize automated tests for:
- partial PO receiving;
- On Order calculation;
- inventory movement math;
- stock count adjustment;
- FEFO allocation;
- reservation/release;
- actual consumption;
- formula version immutability;
- OP requirement calculation;
- bidirectional traceability;
- critical state transitions.

Simple CRUD can initially rely more heavily on integration/manual checks when reasonable.

---

# Future hardening phase
After MVP validation:
- deeper permissions;
- concurrency/locking;
- security review;
- audit review;
- test expansion;
- observability;
- backups/recovery;
- performance;
- migration/import strategy;
- accessibility review;
- production deployment procedures;
- file retention/backup policy.

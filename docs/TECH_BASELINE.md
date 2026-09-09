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
real order.

Creating, applying and proving are three different commands, and only one of
them can write a migration:

| | command | what it does |
|---|---|---|
| **create** | `pnpm migration:create <name_in_snake_case>` | writes the migration, does **not** apply it |
| **apply** | `pnpm db:migrate` | applies what exists locally, can **never** create |
| **prove** | `pnpm validate:migrations:fresh` | rebuilds an empty database from the chain and compares it to `schema.prisma` |

The normal cycle is: edit `schema.prisma` → `pnpm migration:create <name>` →
review the generated `migration.sql` line by line → `pnpm db:migrate` →
`pnpm validate:migrations:fresh`.

Rules:

- **create migrations only with `pnpm migration:create <name_in_snake_case>`.**
  Never call `prisma migrate dev` directly: it stamps the folder with the real
  clock, and the chain's tip is already *ahead* of it, so the new folder sorts
  before migrations it depends on. The command runs
  `prisma migrate dev --create-only` (writes the SQL, does **not** apply it),
  then renumbers the folder to the smallest free identifier after the tip and
  proves the result is the tip. It refuses anything but a local database
  (`scripts/local-db-guard.mjs`) and never applies, deploys or resets.
  Algorithm and its tests: `scripts/migration-prefix.mjs`,
  `scripts/migration-prefix.test.ts`;
- **`pnpm db:migrate` applies and nothing else** (MIG-ORDER-01b, 2026-09-09).
  It used to be `prisma migrate dev`, which applies *and* creates — one
  `--name`, or a pending edit in `schema.prisma`, and a folder was born with
  the real clock on it. The barrier is now technical, not documental:
  `scripts/apply-migrations.mjs` rejects every argument (with `--name` named
  explicitly, pointing at `migration:create`), goes through the local-database
  guard, and runs `prisma migrate deploy` — a subcommand that has no `--name`
  and no creation path at all. When `schema.prisma` carries a change with no
  migration, it says so and stops; it never invents the migration. Production
  is untouched: deploying there stays `pnpm deploy:prod`. Tests:
  `scripts/apply-migrations.test.ts`;
- a migration may only reference tables, types and columns created by a
  migration with a smaller-or-equal name. `scripts/migration-order.test.ts`
  checks this statically as part of `pnpm test`;
- folder names are 14-digit identifiers (`YYYYMMDDHHMMSS_snake_case`) and the
  chain is **strictly monotonic**: a new migration NEVER gets an identifier
  smaller than or equal to the largest one already present. The identifier is
  first an ordering key for the chain and only then a date.

  The chain already contains future-dated identifiers, so "use today's
  timestamp" would produce a name that sorts *before* migrations it depends on
  and break the rebuild from an empty database. **Transitional policy (Product
  Ownership, 2026-09-05):** when the largest existing identifier is in the
  future, use the **smallest valid monotonic increment** from it — never jump
  further ahead. `20260925093000` was followed by `20260925093001`, not by a new
  invented date. Where the largest identifier is in the past, the real timestamp
  of the session is both correct and monotonic, and stays the rule.
  `pnpm migration:create` implements exactly this policy, so it no longer
  depends on anyone remembering it (MIG-ORDER-01, 2026-09-09).

  The increment is **one civil second, with real carry** (`…093059` becomes
  `…093100`), not `+1` on the 14-digit integer. Both order identically —
  lexicographic order over fixed-width digits *is* numeric order — but the
  civil form keeps every identifier readable as a genuine `YYYYMMDDHHMMSS`
  and keeps `…093060` or a month `13` out of the history. The identifier
  stays an ordering key; the date shape is preserved only so the two readings
  never disagree.

  Historical migrations already published are never renamed to tidy the
  sequence. One legacy pair shares the identifier `20260904090000`
  (`component_quantity_mode`, `gmp_production_execution`): harmless, because
  `migrate deploy` orders by the whole folder name, and left alone on
  purpose. `scripts/migration-prefix.test.ts` records it so a *new* tie
  fails;
- `pnpm validate:migrations:fresh` proves two things against a throwaway
  database on the local Postgres: that the migrations rebuild an empty
  database, and that the database they build **is** `schema.prisma` —
  `prisma migrate diff` between the two must come out empty. It goes through
  `scripts/local-db-guard.mjs` (local host only, never Railway) and drops the
  database at the end. Run it before merging any migration, and after any
  change to `schema.prisma`. `migrate deploy` and `migrate status` do not
  compare structure against the model: this command is the only barrier that
  fails on drift;
- never edit the SQL of a migration production already applied. To repair
  ordering, rename the folder to a name after its dependency and make its
  statements idempotent (`IF NOT EXISTS`) so it applies as a no-op where the
  old name already ran. `migrate deploy` ignores checksums of applied rows
  and tolerates orphan rows in `_prisma_migrations`. An orphan row records a
  migration that really ran on that database: keep it. Never delete it and
  never `migrate resolve` it away (Product Ownership decision, 2026-09-04);
- a new migration contains only the deliberate changes of its capability.
  Review every generated SQL line by line; a large Prisma-generated diff is
  never approved as-is. The permanent drift that used to poison every diff is
  gone (BACKLOG #14, 2026-09-07): `schema.prisma` now declares the 27
  `onDelete: Restrict` the migrations had written, the 26 constraint and index
  names they had chosen (`map:`) and the 6 indexes they had created. Anything
  that reappears in a diff is real, and `pnpm validate:migrations:fresh`
  fails on it;
- migration SQL is committed with LF. `.gitattributes` pins it, because the
  checksum Prisma stores in `_prisma_migrations` is the SHA-256 of the file
  bytes: the same migration applied from a Windows working copy and from the
  Railway clone lands two different checksums in the ledger. Twenty-four
  production rows still carry that difference from before the rule; it is
  cosmetic (`migrate deploy` and `migrate status` ignore checksums of applied
  rows) and no row was rewritten to tidy it.

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

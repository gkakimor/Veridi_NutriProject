# Veridi Nutrition — Claude Code Instructions

## Mission
Build the Veridi Nutrition industrial management MVP quickly, safely, and with operational simplicity.

Current phase: **FAST MVP — post-benchmark baseline v0.4**.

Priority order:
1. Correct business behavior.
2. Data integrity and traceability.
3. Fast delivery.
4. Simple operational UX.
5. Maintainable code.
6. Deeper hardening after MVP validation.

Do not overengineer.

## Platform priority (FAST MVP)
Desktop web is the primary development and validation target during this
phase. Mobile/tablet hardening is a later, separate round.

When a handoff does not explicitly mention mobile/tablet:
- implement for desktop web;
- validate for desktop web (functional flow, API, business rules,
  typecheck, build, relevant tests, desktop Playwright when useful,
  clean console);
- do not expand scope into responsive polish, multi-breakpoint
  screenshots, touch ergonomics, or physical-device camera testing.

Do not invent mobile/tablet work as an unrequested improvement. Existing
mobile/tablet/scan support (e.g. the mobile sidebar overlay, the lot scan
page, camera QR scanning) stays in place and must not be removed or
refactored away — just don't spend additional time refining it without an
explicit ask. Full mobile/tablet validation becomes standard again only
when Product Ownership starts the responsive/mobile hardening phase. See
`docs/UI_BRAND.md` and `docs/PROJECT_STATE.md`.

## Product ownership
Business/product decisions come from Product/Project Owner handoffs supplied in chat.

When a new handoff conflicts with repository docs:
1. the latest explicit handoff wins for that feature;
2. update `docs/PROJECT_STATE.md` with any durable decision;
3. never silently reinterpret inventory, traceability, purchasing, formula history, permissions, money, or destructive behavior.

If a missing detail affects only presentation or a reversible implementation detail, make a pragmatic choice and continue.

Ask only when ambiguity can materially affect:
- inventory quantity or availability;
- lot traceability;
- Purchase Order state/quantity;
- formula/version history;
- Production Order behavior;
- permissions;
- financial values;
- destructive operations.

## Technical baseline
- Frontend: React + Vite + TypeScript.
- Backend: Node.js + Fastify + TypeScript.
- Database: PostgreSQL.
- ORM: Prisma.
- Validation: Zod and/or Fastify schemas.
- Tests: Vitest where valuable.
- Architecture: modular monolith.
- API: REST.
- Repository: monorepo.
- TypeScript strict.

Do not introduce:
- microservices;
- Kafka/RabbitMQ;
- Kubernetes;
- Redis without a concrete need;
- Elasticsearch;
- a second backend framework;
- a second database;
- a UI framework/component library.

## UI baseline
The UI is an **internal operational ERP**, not a marketing website.

Authoritative UI rules: `docs/UI_BRAND.md`.

Core visual decision:
- keep the portable design system/token philosophy;
- use Veridi green identity;
- replace the old fixed Query-Builder shell with an ERP operational shell:
  - dark-green top masthead;
  - left navigation;
  - main workspace;
  - optional contextual right drawer only when useful;
  - no permanent global toolbar;
  - no permanent bottom status bar;
  - mobile/tablet scan-first operational screens.

No Bootstrap, Tailwind, MUI, Chakra, Ant, shadcn or similar.

No raw feature-level hex colors. Use design tokens.

## Data integrity rules
- Never silently allow negative inventory.
- Inventory is controlled by item + internal lot.
- Supplier lot is preserved separately from internal lot identity.
- Inventory history is auditable.
- Do not overwrite historical transactions to fix mistakes.
- Corrections use adjustment/reversal behavior.
- Active formula versions are historical and not retroactively mutated.
- A Production Order preserves the exact formula version used.
- Reservation and physical consumption are distinct.
- Actual confirmed consumption drives final stock deduction.
- Important multi-record operations must be transactional.

## Delivery style
For each requested feature:
1. inspect only code/docs needed for the task;
2. implement the smallest complete vertical slice;
3. reuse existing patterns;
4. validate/build/test changed areas;
5. update `docs/PROJECT_STATE.md` concisely;
6. report implementation, validation and only real blockers.

Avoid speculative abstractions.

## Token discipline
Keep context lean.

Read:
- this file first;
- `docs/PROJECT_STATE.md` for current implementation;
- only one or two relevant docs for the requested task.

Task-to-doc map:
- scope/sequence → `docs/MVP_PLAN.md`
- domain behavior → `docs/PRODUCT_RULES.md`
- UI/UX → `docs/UI_BRAND.md`
- architecture/setup → `docs/TECH_BASELINE.md`
- open pendencies → `docs/BACKLOG.md`
- future scope → `docs/ROADMAP_POST_MVP.md` (do not read unless discussing new capabilities)
- benchmark rationale only when needed → `docs/BENCHMARK_NOTES.md`

Do not reread every document on every task.

Keep `docs/PROJECT_STATE.md` compact. Rewrite/condense it; do not append an endless diary.

## Source of truth
- MVP scope: `docs/MVP_PLAN.md`
- business rules: `docs/PRODUCT_RULES.md`
- UI/brand: `docs/UI_BRAND.md`
- technical guardrails: `docs/TECH_BASELINE.md`
- open pendencies: `docs/BACKLOG.md`
- deferred scope: `docs/ROADMAP_POST_MVP.md`
- history (not default context): `docs/archive/`
- benchmark rationale: `docs/BENCHMARK_NOTES.md`
- current implementation: `docs/PROJECT_STATE.md`
- legacy migration runbook: `docs/VERIDI_MIGRATION.md`
- where each rule is protected: `docs/TEST_COVERAGE_MAP.md`
- E2E plan and rules: `docs/E2E_STRATEGY.md`

Use `/ship` for implementation work.

## Session execution and finalization

**Any task running past 10 minutes must be investigated** — command, background
shell, agent, auditor, E2E, build, watcher. Investigating is not killing: check
last output, elapsed time since it, CPU, the file being written, whether it is
waiting on stdin or an unclosed heredoc, whether the agent that created it has
already finished, and whether the target file still exists. A long task showing
real progress keeps going and is reviewed again every ~10 minutes. One with no
progress, or whose purpose is gone, is a zombie.

**Prove ownership before ending any process.** Never `pkill node`, `killall` or
equivalent — the user's own editors, browsers and servers run on this machine.
After killing, confirm it actually left RUNNING; a kill sent is not a kill done.

**Account for agents and background tasks.** An agent finishing does not mean
its background shells did; that gap is a red flag, not a coincidence.

**Stop dev servers and watchers Claude started** at the end of a task, unless
the user asked in that task for them to stay up. Record the exception if so.

**Every round ends with a final report** — including when nothing changed, a
gate failed, the work was interrupted, or a blocker appeared. The report comes
*after* the operational state is clean: agents running 0, background tasks
running 0, no orphan project processes, session temporaries removed, `git
status` actually run rather than remembered. If something could not be cleaned,
say "finalização com pendência" and name the task, its owner and the risk —
never "concluído limpo".

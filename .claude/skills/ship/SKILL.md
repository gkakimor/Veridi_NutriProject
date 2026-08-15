---
name: ship
description: Implement one Product Owner handoff as the smallest complete Veridi MVP vertical slice.
---

# /ship

Implement the latest Product Owner handoff.

## Read minimally
Always:
1. `CLAUDE.md`
2. `docs/PROJECT_STATE.md`

Then only what is needed:
- domain logic → `docs/PRODUCT_RULES.md`
- UI → `docs/UI_BRAND.md`
- sequencing/scope → `docs/MVP_PLAN.md`
- architecture → `docs/TECH_BASELINE.md`
- future-scope check → `docs/BACKLOG.md`

Do not read `docs/BENCHMARK_NOTES.md` unless rationale/comparison is actually needed.

## Implementation rules
1. Inspect current code patterns.
2. Implement the smallest useful vertical slice.
3. Business logic remains server-side.
4. Validate all writes.
5. Use transactions for important purchasing/inventory/production transitions.
6. Preserve lot traceability.
7. Never silently create negative stock.
8. Never silently mutate historical formulas or inventory events.
9. Follow Veridi UI rules.
10. No UI framework.
11. Run relevant build/tests.
12. Fix failures caused by the change.

## Product ambiguity
Do not stop for reversible cosmetic decisions.

Ask only if ambiguity changes:
- inventory;
- lot genealogy;
- Purchase Order quantities/states;
- formulation history;
- OP release/consumption;
- permissions;
- money;
- destructive behavior.

## Scope discipline
If a request drifts into `docs/BACKLOG.md`:
- do not implement it automatically;
- mention the scope conflict;
- wait for Product Ownership to promote it.

## Finish
Update `docs/PROJECT_STATE.md` compactly.

Return:
- implemented;
- main files/areas changed;
- tests/validation;
- blocker only if real.

Do not produce a long development diary.

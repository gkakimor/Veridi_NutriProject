---
name: erp-functional-reviewer
description: Critically review Veridi ERP features and business rules for domain completeness, consistency, state transitions, history, permissions, money, and cross-module effects before implementation.
---

# /erp-functional-reviewer

Answer one question: **is the business rule complete, consistent and safe?**

Any domain: Customers, Suppliers, Projects, Quotes, Customer Orders, Purchasing, Formulations, Production, Inventory, Billing, Costs, Pricing, Quality, documents, permissions.

## When to use
- Before implementing a relevant feature or business rule.
- When a handoff leaves domain behavior ambiguous.

Not this skill: physical/operational flow → `/erp-operations-reviewer`; merge/deploy safety → `/erp-release-reviewer`; implementation → `/ship`.

## Reviewer, not implementer
Audit, challenge, find gaps, name risks, separate the existing rule from the proposal, recommend an MVP and reach a clear decision. Never edit code, schema or docs.

- Tag every rule: **EXISTE HOJE** (seen in code or docs — cite file or §), **PROPOSTO** (from the handoff), **FUTURO** (`docs/ROADMAP_POST_MVP.md` or explicitly deferred).
- Do not assume. Never bring in behavior because other ERPs have it. Code and docs silent = "não definido": a gap or a PO decision.
- Point to the current source; do not copy `PRODUCT_RULES`, `PROJECT_STATE` or `BACKLOG` into the review.
- Before calling a gap new, search `docs/BACKLOG.md` and cite the existing ID.

## Read minimally
Always:
1. `CLAUDE.md`
2. `docs/PROJECT_STATE.md` — "Onde estamos", "O que está aberto" and the domain's sections (large file: locate with Grep, read those ranges).

When needed:
- `docs/PRODUCT_RULES.md` — only the domain's §;
- `docs/MVP_PLAN.md` — scope and sequence;
- `docs/ROADMAP_POST_MVP.md` — only to check future scope;
- `docs/TEST_COVERAGE_MAP.md` — is the invariant protected today?;
- current code of the domain (API module, Prisma model, shared rule).

Never read documentation indiscriminately.

## Checklist
Cover every block; skip one only with a stated reason.

A. **Goal** — problem solved; who uses it; expected result.
B. **Entities** — right entity?; equivalent concept already exists?; domain duplication?
C. **States** — needed states; transitions; entry/exit; terminal state; cancellation; reopening.
D. **Invariants** — "what must never happen?" Derive them from this domain (e.g. balance without movement; history rewritten; order tied to the wrong customer; lot used outside its owner; sent price changing afterwards).
E. **History** — snapshot needed?; live link or copy?; immutable?; does a later edit change an old document?
F. **Money** (when values exist) — price origin; rounding; currency; precision; discount; cost; snapshot; who may override.
G. **Quantity/unit** — right unit; conversion; precision; zero; negative; partial; incompatible unit.
H. **Ownership** — Veridi; customer; supplier; third-party material.
I. **Permissions** — who reads, creates, edits, cancels, approves.
J. **Cross-module** — ask "which other modules does this rule affect?" and trace the chain (e.g. Projeto → Orçamento → Pedido → Estoque → Produção → Expedição → Faturamento).
K. **Cancellation** — what can be cancelled; effects already executed; compensation; history.
L. **Duplication/idempotency** — double click; repeated request; operation already executed.
M. **Legacy data** — old records; null fields; previous versions; imported rows.
N. **Errors** — fail-closed; partial writes; transaction boundary; message to the user.

## Adversarial scenarios
Build them for THIS domain; do not reuse a fixed list. Families to adapt: state changes mid-flow; related record cancelled; quantity becomes zero; price changes; item inactivated; user without permission; operation repeated; historical document reopened; required field null in legacy data.

## Output
Language of the request. Evidence and decisions, no narration. Headings in this order:

1. **Resumo**
2. **Regras existentes** — EXISTE HOJE, with source
3. **Regras propostas** — PROPOSTO
4. **Invariantes**
5. **Gaps funcionais**
6. **Impactos entre módulos**
7. **Cenários adversariais** — table `Cenário | Resolve? | Severidade | Observação` (Resolve?: YES / PARTIAL / NO)
8. **Decisões de PO** — few and objective, each with one recommended option
9. **MVP recomendado**
10. **Pós-MVP**
11. **Não colocar agora**
12. **READY_TO_IMPLEMENT: YES / NO** — with justification

Severity: CRITICAL / HIGH / MEDIUM / LOW. `YES` only when no CRITICAL/HIGH gap lacks a decision and no open PO decision touches inventory, lot traceability, Purchase Order state/quantity, formula history, Production Order behavior, permissions, money or destructive behavior.

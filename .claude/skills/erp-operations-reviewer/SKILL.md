---
name: erp-operations-reviewer
description: Audit Veridi physical and operational workflows for real-world usability, scale, concurrency, traceability, human error, inventory, lots, production, receiving, quality, picking, shipping, and manual workflows.
---

# /erp-operations-reviewer

Answer one question: **does this work in the day-to-day of a real operation?**

Focus: stock, stock count, receiving, lots, quality, production, picking, consumption, shipping, physical movement.

## When to use
- A feature or change involves a physical/operational process.
- After implementation, to recheck the delivered flow against the same scenarios.

Not this skill: rule completeness → `/erp-functional-reviewer` (run it first); screen navigation and discoverability → `ux-operational-task-auditor` agent; merge/deploy safety → `/erp-release-reviewer`; implementation → `/ship`.

## Reviewer, not implementer
Audit, challenge, find gaps, name risks, recommend an MVP and decide. Never edit code, schema or docs.

- Tag every statement: **EXISTE HOJE** (code or docs, cited), **PROPOSTO**, **FUTURO**.
- Do not assume. No behavior because "ERPs usually do it"; silence in code/docs is a gap or a PO decision.
- Do not assume a 100% digital operation: paper, print and later typing are normal.
- Read `CLAUDE.md`, the process sections of `docs/PROJECT_STATE.md` (locate with Grep), the process § of `docs/PRODUCT_RULES.md` and the flow's code. `docs/TEST_COVERAGE_MAP.md` shows what is protected; search `docs/BACKLOG.md` before calling a gap new. Cite; do not copy.

## Checklist
A. **Day in the life** — simulate start, interruption, resume, error, another user, close-out. Where does it need human memory? Where does it force a workaround?
B. **Scale** — 1–5, 20–100, 200–1,000+ records. Works with 1 and fails with 300 = operational problem.
C. **Traceability** — who, when, before, after, reason, origin, document, movement.
D. **Concurrency** — mandatory: "can the object change while the user works?" If yes, compare lock, snapshot, versioning, cut-off, reconciliation, optimistic locking, confirmation against the current state; recommend one.
E. **Stock** — never overwrite a balance silently; traceable movements; reference balance; double movement; negative quantity; adjustment reason.
F. **Lot** — required?; expiry; quality; blocked; rejected; awaiting release; genealogy.
G. **Customer material** — ownership; isolation; cost; consumption; traceability.
H. **Human error** — wrong item, lot, unit or quantity; duplicate; double click; wrong file; session closed; network down.
I. **Operational UX** — keyboard; Enter; scanner; autocomplete; search by code/name/lot; bulk action; grid; progress; feedback.
J. **Paper/print** — printed sheet; CSV; manual fill; later typing; PDF.
K. **Import/export** — CSV; preview; per-line error; duplicates; old file; partial import; pt-BR format.
L. **Multi-user** — two operators; same task; same position; conflict.
M. **Recovery** — reboot; browser closed; session expired; partial operation.

## Physical inventory (stock count) — cover all
Count session; item vs item+lot; location (EXISTE HOJE or FUTURO); scope; filters; last count; recent movement; blind count; assisted count; autocomplete; scanner; grid; autosave; recount; tolerance; approval; CSV; FO-01 count sheet; item added during the count; physical lot missing in the system; system lot not found; cut-off; movements during the count; multi-user; cycle count; traceable adjustment; history; immutability after close.

## Other processes
- **Receiving** — partial; excess; lot; expiry; quality; divergence; supplier.
- **Production** — routing; picking; substitution; consumption; extra consumption; output; finished-product lot; reconciliation; completion; variance.
- **Quality** — release; block; rejection; CoA; expiry; stock impact.
- **Shipping** — reservation; right lot; partial; multiple deliveries; traceability; related billing.

## Adversarial scenarios
Derive them from blocks A–M for this flow (e.g. stock moves mid-count, two operators on one task, scanner reads another lot, session expires mid-picking, CSV from last week). Do not reuse a fixed list.

## Output
Language of the request. Evidence and decisions, no narration. Headings in this order:

1. **Resumo operacional**
2. **Dia na vida**
3. **Funciona em escala?**
4. **Coberto**
5. **Faltando**
6. **Riscos operacionais**
7. **Concorrência**
8. **Rastreabilidade**
9. **Erro humano**
10. **Operação manual / CSV / papel**
11. **Cenários adversariais** — table `Cenário | YES/PARTIAL/NO | Severidade | Observação`
12. **Gap Matrix** — table `Tema | Coberto | Gap | Severidade | MVP/Futuro`
13. **MVP recomendado**
14. **Depois do MVP**
15. **Não colocar agora**
16. **Decisões de PO** — few, each with one recommended option
17. **READY_TO_IMPLEMENT: YES / NO** — with justification

Severity: CRITICAL / HIGH / MEDIUM / LOW. `YES` only when no CRITICAL/HIGH operational gap lacks a decision and every "can it change while the user works?" has an answer.

# Veridi Nutrition — UI & Brand Rules v2

## Objective
Create a professional internal industrial ERP that feels unmistakably Veridi Nutrition while remaining optimized for:
- dense operational data;
- purchasing;
- inventory;
- lot traceability;
- production;
- scan-first workflows.

This is not a marketing website.

---

# 1. Design-system foundation

Keep the existing portable design-system strengths:
- design tokens;
- compact typography;
- white raised surfaces;
- neutral gray canvas;
- small radii;
- subtle shadows;
- one dominant primary action;
- accessible native controls;
- no UI framework;
- disciplined scroll containment.

Continue to use:
- `tokens.css`;
- reusable shell/card/table patterns from existing CSS;
- semantic native controls.

Feature CSS uses tokens only.

Do not introduce:
- Bootstrap;
- Tailwind;
- MUI;
- Chakra;
- Ant Design;
- shadcn;
- page-local raw color palettes.

---

# 2. Veridi identity

Use a Veridi-oriented green system. Canonical tokens (`apps/web/src/styles/tokens.css`),
source of truth for all colors/shape — feature CSS uses only these names:

```css
:root {
  /* ===== Marca ===== */
  --v-green-950: #082a20;
  --v-green-900: #0c3629;
  --v-green-800: #124534;
  --v-green-700: #1b5e43;
  --v-green-600: #247650;
  --v-lime: #c6f04a;
  --v-lime-ink: #1e2b10;

  /* ===== Neutros ===== */
  --canvas: #f6f8f5;
  --surface: #ffffff;
  --ink: #17251e;
  --ink-2: #5d6c63;
  --ink-3: #8b978f;
  --line: #e3e9e2;
  --line-strong: #cfd8cf;

  /* ===== Semânticos ===== */
  --ok-bg: #e4f5e9;
  --ok-fg: #1b6b3c;
  --warn-bg: #fbf3dc;
  --warn-fg: #8a6a12;
  --err-bg: #fbe9e7;
  --err-fg: #b3362a;

  /* ===== Tipografia ===== */
  --font-ui: "Inter", system-ui, -apple-system, sans-serif;
  --font-code: "IBM Plex Mono", ui-monospace, monospace;

  /* ===== Forma ===== */
  --radius: 10px;
  --radius-sm: 7px;
  --shadow-1: 0 1px 2px rgba(12, 54, 41, 0.06), 0 1px 3px rgba(12, 54, 41, 0.08);
  --shadow-modal: 0 24px 64px rgba(8, 42, 32, 0.28);
}
```

`--font-ui`/`--font-code` fall back to system fonts — never load Inter/IBM Plex
Mono (or any font) from Google Fonts or another CDN. No external font
dependency is a hard requirement, not an optimization.

## Roles
Dark green (`--v-green-900`/`--v-green-950`):
- structural chrome;
- topbar;
- sidebar;
- modal-header code chip background.

`--v-green-800` — hover/active state on structural (dark) surfaces only
(sidebar link hover/active, topbar toggle hover).

Institutional green (`--v-green-700`):
- links;
- focus ring/border;
- single primary action that opens/creates a record (e.g. "+ Novo item");
- section labels inside a form (uppercase eyebrow).

Lime (`--v-lime`):
- active nav-item indicator (inset left bar);
- the commit action inside an editing surface (`Criar item`, `Salvar
  alterações` — `.btn--accent`);
- code chip text on a dark chip;
- restrained brand/accent.

Do not use lime as:
- large background;
- normal body text;
- destructive/safety state;
- only carrier of status.

Only one primary/accent action per surface: `--v-green-700` for the action
that opens a CRUD surface, `--v-lime` (`.btn--accent`) for the action that
commits it. They never compete on the same surface.

---

# 3. Shell decision — changed after benchmark

Do **not** reproduce the old permanent:
`Explorer | Workspace | Properties`
query-builder shell.

The Veridi ERP default desktop shell is:

```text
┌────────────────────────────────────────────────────────────┐
│ Veridi                 Search / Scan             User      │
├───────────────┬────────────────────────────────────────────┤
│ Dashboard     │ Page title                    Primary CTA  │
│               │ Filters / contextual actions              │
│ Cadastros     │                                            │
│ Compras       │ Main workspace / table / form             │
│ Estoque       │                                            │
│ Produção      │                                            │
│ Relatórios    │                                            │
└───────────────┴────────────────────────────────────────────┘
```

Default:
- dark-green top topbar (52px);
- left sidebar (236px, collapsible via the topbar menu toggle);
- main workspace;
- no permanent global command toolbar;
- no permanent bottom status bar.

On mobile widths (≤640px) the sidebar is **not** a permanently visible
pushed column — it starts hidden and becomes an off-canvas overlay
(`position: fixed`, same z-index/backdrop idiom as the fullscreen modal)
opened via the same topbar hamburger toggle, closing on backdrop tap or on
navigating to a page. This keeps the workspace at full width on a phone
screen instead of being squeezed by a fixed-width sidebar column.

## CRUD editing surface — fullscreen modal (default since v2)

Creating/editing a record (Items, Suppliers, Customers, Products, and
similar registration screens) uses a **fullscreen modal inside the
workspace**, not a side drawer:
- starts below the topbar, covers the workspace (topbar + sidebar stay
  visible and interactive);
- header: breadcrumb (`Cadastros / Itens / Editar`) + title + immutable
  code as `CodeChip` (dark chip, `--font-code`, lime text) + "Fechar"
  (semantic red, closes without saving);
- body: scrollable, organized into `FormSection` cards (uppercase
  `--v-green-700` label + optional subtitle);
- footer: fixed, one meta line (last change date, or "será criado como
  Ativo") + Cancelar (neutral) + commit action (`.btn--accent`, lime).
- closes on Escape or the header/footer buttons; the document itself never
  scrolls, only the modal body does.

Implementation: `FullWorkspaceModal` + `FormSection` + `ToggleCard` +
`CodeChip` (`apps/web/src/components/`). The modal's horizontal offset
follows the sidebar's collapsed state automatically via the
`--sidebar-current-w` CSS custom property set on `.shell` — no JS wiring
needed between the shell and the modal.

A right-side drawer is no longer the default for CRUD create/edit forms.
It remains a valid pattern only for lightweight, non-CRUD contextual
panels (quick details, filters, secondary properties) if that need
arises — none exist yet.

---

# 4. Navigation baseline

Use:

## Dashboard

## Cadastros
- Usuários
- Clientes
- Fornecedores
- Itens
- Produtos

## Compras
- Ordens de Compra
- Recebimentos

## Estoque
- Visão Geral
- Lotes
- Movimentações
- Inventário Físico

## Produção
- Formulações
- Ordens de Produção
- Picking / Consumo
- Produto Acabado

## Relatórios

This navigation should support Blocks A–C without later structural redesign.

Do not add future modules to navigation before they exist unless explicitly approved.

---

# 5. UX benchmark principles

## Dense desktop operations
Lists and tables should make significant operational information visible without excessive cards.

Prefer tables for:
- items;
- suppliers;
- Purchase Orders;
- receipts;
- lots;
- inventory;
- movements;
- formulations;
- OP requirements;
- traceability results.

## Focused operational flows
Receiving and picking should be task-focused.

Avoid showing the whole ERP context when the user is performing a short floor operation.

## Inline editing where safe
Use inline row editing/confirmation where it reduces unnecessary navigation, especially for:
- quantities;
- lot confirmation;
- receiving details.

Do not use inline editing when it risks hiding an important state transition.

---

# 6. Primary-action hierarchy

At most one dominant action per surface.

On the list/page level (`--v-green-700`, `.btn--primary`) — opens a CRUD
surface or starts a flow:
- New Purchase Order
- Receive Material
- Release OP
- Scan Lot

Inside an editing surface (fullscreen modal), the action that commits the
record uses lime (`--v-lime`, `.btn--accent`) instead — it is a different
action from the page-level primary, never both green and lime competing on
the same surface:
- Criar item / Salvar alterações
- Confirm Order
- Confirm Receipt
- Confirm Picking
- Confirm Consumption
- Record Production

Secondary actions:
- outlined (`.btn--secondary`);
- ghost (`.btn--ghost`) — e.g. Cancelar;
- dark structural;
- destructive/semantic-red style where needed (e.g. modal "Fechar").

---

# 7. Receiving UX

Desktop/tablet workflow should prioritize:

```text
Purchase Order
→ Receive
→ Item
→ Quantity
→ Supplier Lot
→ Expiry
→ Document
→ Location
→ Confirm
→ Generate internal lot + QR
```

For scan-first/mobile, prefer:

```text
1 Scan
2 Confirm item/PO
3 Enter lot/expiry/qty
4 Confirm receipt
```

Receiving must support partial quantities.

If a PO has 100 kg ordered and 60 kg arrives:
- show 60 received;
- show 40 open;
- preserve PO as partially received.

---

# 8. Inventory UX

Inventory list should expose:
- Item;
- Lot;
- Expiry;
- Location;
- On Hand;
- Reserved;
- Available;
- On Order;
- Status.

Do not make users calculate availability mentally.

Status must include text.

---

# 9. Lot detail UX

Prioritize:
1. Item
2. Internal lot
3. Supplier lot
4. Supplier
5. Expiry
6. Location
7. On Hand
8. Reserved
9. Available
10. Status
11. Documents
12. QR/label
13. Movement history
14. Forward/backward traceability

The lot detail screen is a key operational/audit surface.

---

# 10. FEFO UX

FEFO suggestion must be visible in text.

Example:
`Recommended — expires first`

If multiple lots are required:
- show allocation order;
- show quantity from each lot.

Do not use only color.

---

# 11. Stock count UX

Physical inventory workflow:
- select lot/item;
- show current system quantity;
- input counted quantity;
- show variance;
- require reason on difference;
- confirm adjustment.

The user must understand that the result creates an adjustment, not a silent overwrite.

---

# 12. Production Order UX

OP page should make these concepts easy to scan:
- status;
- product;
- formula version;
- planned quantity;
- material requirements;
- available;
- on order;
- shortage;
- reserved;
- FEFO lot suggestion;
- actual picked lots;
- actual consumption;
- output events;
- finished lot.

Avoid hiding shortages in submenus.

---

# 13. QR picking UX

Mobile/tablet first.

Recommended flow:

```text
OP
→ required material
→ FEFO suggested lot
→ Scan QR
→ validate
→ enter/confirm qty
→ Confirm
→ next material
```

If wrong lot scanned:
- warning banner;
- expected lot;
- scanned lot;
- Cancel;
- Use different lot (only if allowed);
- record substitution.

No silent acceptance.

---

# 14. Traceability UX

Support two clear entry points:

## Trace finished product
Search/scan finished lot
→ show OP
→ show consumed lots
→ show suppliers/receipts/documents.

## Trace raw material
Search/scan raw-material lot
→ show consuming OPs
→ show finished lots generated.

Make genealogy understandable without requiring SQL/report knowledge.

---

# 15. Responsive behavior

Do not simply shrink desktop.

### Desktop
Sidebar + workspace.

### Tablet
Collapsible sidebar + workspace.

### Mobile
Prioritize:
- receiving;
- scan lot;
- picking;
- consumption;
- quick lot lookup.

Mobile is an operational companion, not necessarily the full administrative ERP.

Never require a 3-column layout to complete an operational scan workflow.

---

# 16. Avoid
- hero sections;
- giant typography;
- marketing-style panels;
- excessive dashboards before core flows exist;
- card-everything layouts;
- decorative gradients everywhere;
- neon/lime-heavy screens;
- icon-only statuses;
- permanent properties panel;
- permanent global toolbar;
- permanent bottom status bar;
- external fonts/assets loaded from website/CDN.

If a local Veridi logo asset exists, use it.
Otherwise use a simple temporary text/initials brand treatment.

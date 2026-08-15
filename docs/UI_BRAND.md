# Veridi Nutrition — UI & Brand Rules v0.4

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

Use a Veridi-oriented green system.

Recommended compatible token reskin:

```css
:root {
  --navy-deep: #0f3d34;
  --navy: #174f43;
  --navy-hover: #1d5e50;
  --title-dark: #174f43;

  --primary: #217362;
  --primary-hover: #2a806e;
  --primary-soft: #e7f1ee;
  --link: #217362;

  --accent: #afcb08;
}
```

Keep existing neutral families unless Product Ownership approves a redesign.

## Roles
Dark green:
- structural chrome;
- masthead;
- navigation active structure;
- headings where appropriate.

Primary green:
- single primary action;
- links;
- focus ring;
- scan/confirm;
- active selection.

Lime:
- restrained brand/accent;
- logo detail;
- subtle positive accents.

Do not use lime as:
- large background;
- normal body text;
- destructive/safety state;
- only carrier of status.

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
- dark-green top masthead;
- left navigation;
- main workspace;
- contextual right drawer only when useful;
- no permanent global command toolbar;
- no permanent bottom status bar.

Use a drawer for:
- quick details;
- filters;
- secondary properties;
- contextual history.

Do not reserve right-side screen width permanently.

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

At most one green primary action per surface.

Examples:
- New Purchase Order
- Confirm Order
- Receive Material
- Confirm Receipt
- Release OP
- Scan Lot
- Confirm Picking
- Confirm Consumption
- Record Production

Secondary actions:
- outlined;
- ghost;
- dark structural;
- destructive style where needed.

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

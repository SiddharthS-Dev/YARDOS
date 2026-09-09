# YARDOS Console — UI Architecture

Written from an inspection of the repository on **2026-09-09**, not from a
brief. Where the two disagree, this document follows the code.

---

## Part 1 — Audit of the existing console

### A. Current architecture

Next.js 15 App Router, React 19, TanStack Query 5, Tailwind 3.4, `lucide-react`,
`recharts`, `react-hook-form` + `zod`. No shadcn/ui, no Radix, no Supabase, no
MapLibre. 5,848 lines across 24 files.

```
apps/web/
  app/
    layout.tsx            root, metadata, Providers
    providers.tsx         QueryClient (15s stale, no retry on 4xx) + AuthProvider
    globals.css           dark-only base, .data-table, .input, .label
    (auth)/login
    (console)/layout.tsx  → AppShell
      dashboard  gate  vehicles  vehicles/[id]  yard  yard/[id]
      billing    auctions  portal
  components/
    domain/app-shell.tsx  sidebar + topbar, permission-filtered nav
    ui/primitives.tsx     15 exports
  hooks/
    use-domain.ts         vehicles, sessions, releases, invoices, reports
    use-gate.ts           devices, captures, review queue, simulate
  lib/
    api.ts  auth-context.tsx  format.ts  cn.ts
```

### B. Current routes — 11

`/login`, `/dashboard`, `/gate`, `/vehicles`, `/vehicles/[id]`, `/yard`,
`/yard/[id]`, `/billing`, `/auctions`, `/portal`, `/` (redirect).

### C. Existing components

`Panel`, `PanelHeader`, `Badge`, `toneForStatus`, `StatusBadge`, `LiveDot`,
`Button`, `EmptyState`, `ErrorState`, `LoadingState`, `SkeletonRows`, `Field`,
`MetricCard`, `UtilisationBar`, `AppShell`.

### D. Existing design system

A dark-only palette: `base` 950–500 navy, `accent` cyan, and semantic
`ok`/`warn`/`danger`/`info`/`muted`. Tokens are Tailwind theme extensions, so
every colour is compiled into class names — there is no runtime theming layer.

### E. API integration

A single `api.ts` client that attaches the bearer token, refreshes once on 401
with a **single-flight guard** (so parallel 401s cannot trip the backend's
token-reuse detection and revoke the family), and converts the error envelope
into a typed `ApiError` carrying the stable `code` and `correlationId`. Tokens
live in `sessionStorage`, deliberately not `localStorage`, because a shared gate
terminal must not keep a session alive after the tab closes.

### F. Authentication

`auth-context.tsx` → `/auth/login`, `/auth/me`, `/auth/logout`. Profile carries
roles, permissions and site access.

### G. Permission handling

`AppShell` filters nav against the same 86-permission catalogue the API
enforces, via `@smartpark/contracts`. Correctly treated as usability, not
security — every endpoint re-checks.

### H. What is good and reusable

- The API client. Single-flight refresh is subtle and correct; do not touch it.
- `toneForStatus` — one place mapping domain status to visual tone.
- Permission-filtered navigation using the shared catalogue.
- `format.ts` — Indian digit grouping, and a header rule that the console never
  computes a monetary value.
- The dark palette's *discipline*: colour carries meaning, never decoration.

### I. What is incomplete or wrong for the target

| Issue | Detail |
|---|---|
| Flat navigation | Nine sibling links. No grouping, no collapse, no badges, no persona shaping. |
| No global search | The single most important interaction in a vehicle-centric system is absent. |
| No command palette | — |
| Dark-only | No theming layer at all; colours are baked into Tailwind classes. |
| Dashboard is a metric grid | Six cards and a chart — precisely the generic dashboard the brief rules out. |
| No Vehicle 360 tabs | `vehicles/[id]` is one long column; no timeline, location, financial or audit tabs. |
| Release buried | Lives inside `yard/[id]`; not a workspace, no guided flow. |
| No charge explanation UI | The engine produces a full narrative and ladder positions. None of it is shown. |
| Yard view is a list | No bay grid, no zone visualisation. |
| No Users screen | `/users` has 8 endpoints and zero UI. |
| No drawers, no toasts | Every interaction is inline or a page. |
| No `<VehicleIdentifier>` | Plate rendering is duplicated across seven files. |
| No tests | 5,848 lines, zero coverage. |

### J. Gap to the target

The console today is a competent set of screens over the API. The target is an
operations system in which the **vehicle is the organising object** and every
screen answers: what is happening, what needs attention, what is blocked, why,
and what is the next action.

---

## Part 2 — Backend reality (governs what may be built)

**73 routes across 11 controllers.** Verified by inspection.

| Domain | Endpoints | Console today | Plan |
|---|---|---|---|
| auth | 5 | ✅ | keep |
| vehicles | 6 | partial | Vehicle 360 |
| anpr | 6 | ✅ | Gate rework |
| parking-sessions | 7 | partial | Live Yard, Visits |
| releases | 7 | partial | Release workspace |
| invoices | 4 | partial | Invoice detail |
| payments | 4 | partial | Payment flow |
| auctions | 18 | partial | Auction workspace |
| reports | 6 | 4 used | Dashboard, Reports |
| users | 8 | **none** | **Users & Roles** |

### Domains with NO API — must not be faked

| Brief section | Reality |
|---|---|
| §34–35 Notification Center | `modules/notification/` is an **empty directory**. No controller, no service. Schema and templates exist. |
| §36 Settings | `settings.service.ts` exists; **no controller**. Not reachable over HTTP. |
| §38 Audit view | `audit.service.ts` exists; **no controller**. Audit rows are written, never read back over the API. |
| §18 Bay-level grid | `OccupancyReport` gives site→zone with capacity/occupied/available. There is **no per-bay endpoint**. A zone-level capacity view is honest; a bay grid with individual bay states is not. |
| Documents / Intelligence | Empty directories. |

Per rules 73 and 85 these get **no navigation entry and no screen**. They are
listed in `docs/UI-IMPLEMENTATION-STATUS.md` as backend dependencies. A nav item
leading to a page that cannot load data is a dead button.

---

## Part 3 — Design system

### The palette decision, and a conflict worth stating

The brief specifies a light ground — concrete `#F1F3EF`, ink `#10161B`, primary
green `#12A150`. The existing console is **dark-only by explicit earlier
design**, on the reasoning that gate screens run whole shifts behind glass in
bright yards. Rule 70 also says that where dark mode exists it must be
first-class.

Both cannot be the single answer, so neither is discarded:

- Tokens move to **CSS custom properties** on `:root` / `[data-theme="dark"]`,
  which is the theming layer the console currently lacks entirely.
- **Light is the default**, using the specified palette.
- **Dark is a designed counterpart**, not an inversion: the ground is warmed
  toward the same hue family, semantic hues are lifted for contrast on dark, and
  every pair is checked against WCAG AA.
- The gate workspace can be pinned to dark independently, because that screen
  has the strongest environmental argument for it.

### Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ground` | `#F1F3EF` concrete | `#0B0F12` | page background |
| `--surface` | `#FFFFFF` | `#141A1F` | panels |
| `--surface-2` | `#F7F8F5` | `#1B2229` | table headers, insets |
| `--line` | `#DFE3DC` | `#27313A` | borders |
| `--ink` | `#10161B` | `#EEF2F5` | primary text |
| `--ink-2` | `#4A555F` | `#A3B0BB` | secondary text |
| `--ink-3` | `#6E7A85` | `#78868F` | metadata |
| `--primary` | `#12A150` | `#2BBE6A` | primary action, SUCCESS/ACTIVE |
| `--amber` | `#E0891B` | `#F0A238` | WARNING/PENDING |
| `--blue` | `#2E6BE6` | `#5A8EF0` | informational/RESERVED |
| `--slate` | `#5B6672` | `#7B8794` | BLOCKED/UNKNOWN |
| `--danger` | `#C6362F` | `#E5695F` | CRITICAL |

### Semantic status vocabulary

Nine states, each with **colour + icon + text** — never colour alone (rule 6,
rule 50):

`SUCCESS` · `ACTIVE` · `PENDING` · `WARNING` · `CRITICAL` · `BLOCKED` ·
`EXPIRED` · `COMPLETED` · `UNKNOWN`

Domain statuses map onto these through one function, so `OPEN`, `PAID`,
`SETTLED` and `MATCHED` cannot drift apart visually.

### Typography

System sans for prose. Monospace with `tabular-nums` for the things read
character by character: **registration numbers, money, identifiers, timestamps,
bay codes**. A plate is an identifier and must look like one.

### Component library

New or reworked: `ThemeProvider`, `AppShell`, `Sidebar`, `TopBar`,
`GlobalSearch`, `CommandPalette`, `PageHeader`, `Breadcrumbs`, `StatusBadge`,
`VehicleIdentifier`, `Money`, `Age`, `DataTable`, `FilterBar`, `Timeline`,
`ChargeBreakdown`, `ZoneCapacity`, `Drawer`, `Modal`, `ConfirmDialog`, `Toast`,
`Tabs`, `KpiTile`, `SiteSelector`.

Kept as-is: `api.ts`, `auth-context.tsx`, `format.ts`, `cn.ts`, `toneForStatus`.

---

## Part 4 — Information architecture

### Navigation, grouped and permission-filtered

```
OVERVIEW      Operations overview          report:operations
OPERATIONS    Gate                         session:admit / anpr:event:read
              Live yard                    session:read
              Vehicles                     vehicle:read
FINANCIAL     Invoices                     invoice:read
              Payments                     payment:read
RECOVERY      Releases                     release:read
              Auctions                     auction:read
SYSTEM        Users & roles                user:read
PORTAL        My vehicles                  (financier users only)
```

Deliberately absent: Notifications, Settings, Audit, Reports-as-a-section,
Financiers, Yards/Zones/Bays configuration — no API backs them.

### Persona shaping

The same shell serves every persona; the nav filter does the shaping. A
financier user sees only *My vehicles*. A gate operator lands on *Gate*. A
finance officer lands on *Invoices*. Landing route is derived from the user's
own permissions rather than hard-coded per role.

### Page tree (adapted to the existing routes — no duplicates)

Existing routes are kept at their current paths so no link, bookmark or test
breaks. `/vehicles/[id]` gains tabs rather than a new route family.

```
/login
/dashboard              operations overview
/gate                   gate workspace
/yard                   live yard, zone capacity
/yard/[id]              stay detail + release
/vehicles               vehicle repository
/vehicles/[id]          Vehicle 360   ?tab=overview|timeline|location|financial|auction
/billing                invoices + payments
/auctions               auction workspace
/users                  users & roles          (NEW — API exists, no UI)
/portal                 financier portal
```

---

## Part 5 — Component → endpoint mapping

Built from the controllers, not guessed.

| Screen | Endpoint | Invalidates on mutation |
|---|---|---|
| Dashboard | `GET /reports/dashboard`, `/reports/occupancy`, `/reports/ageing`, `/reports/activity`, `/reports/revenue`, `/reports/auctions` | — |
| Global search | `GET /vehicles/search?q=` | — |
| Gate | `GET /anpr/devices`, `/anpr/events`, `/anpr/review-queue`; `POST /anpr/simulate`, `/anpr/events/:id/review` | events, review-queue, sessions, dashboard |
| Live yard | `GET /reports/occupancy`, `GET /parking-sessions` | — |
| Vehicle 360 | `GET /vehicles/:id`, `/vehicles/:id/timeline`; `POST /vehicles/:id/registry-lookup` | vehicle, timeline |
| — financial tab | `GET /parking-sessions/:id/charge`, `/charge-history`, `GET /invoices?vehicleId=` | — |
| Release | `GET /releases/eligibility/:sessionId`; `POST /releases`, `/:id/decision`, `/:id/complete`, `/:id/cancel` | releases, session, vehicle, invoices, dashboard |
| Invoices | `GET /invoices`, `/invoices/:id`; `POST /:id/issue`, `/:id/void` | invoices, dashboard |
| Payments | `GET /payments`, `/payments/:id`; `POST /payments` | payments, invoices, dashboard |
| Auctions | 18 auction routes | auctions, lot, settlement, vehicle |
| Users | `GET /users`, `/users/roles`, `/users/:id`; `POST /users`, `PATCH /:id/roles`, `/:id/site-access`, `/:id/status`, `POST /:id/reset-password` | users |

`GET /reports/*` accepts `siteId`, which is how site switching propagates.

---

## Part 6 — Cross-cutting rules

**Money.** Decimal strings from the API, formatted by `<Money>`, never computed
client-side. A total the user sees is a total the server stands behind.

**Registry state.** `NOT_REQUESTED`, `PENDING`, `VERIFIED`, `FAILED`,
`UNAVAILABLE`, `MANUALLY_VERIFIED` are rendered distinctly. A value sourced from
the simulator can never render as VERIFIED — the API will not emit it, and the
UI states the provider alongside the status.

**Tenant isolation.** Query keys include `siteId`; changing site changes the key
so no stale cross-site row survives. On sign-out the whole cache is cleared.

**Conflicts as guidance.** `ApiError.code` drives a specific explanation, not a
status number: `SESSION_ALREADY_OPEN` renders the existing stay with a link to
it, not "409 Conflict".

**Loading.** Skeletons shaped like the content that will replace them. The gate
narrates its steps instead of spinning.

**Responsive.** 1920 → 768 with sidebar collapse and horizontal table scroll
inside the table's own container, never the page body. The gate remains usable
on a tablet.

**Accessibility.** WCAG AA contrast on both themes, visible focus everywhere,
semantic tables, labelled controls, focus-trapped dialogs, Escape to close, and
status conveyed by icon and text as well as colour.

---

## Part 7 — Implementation order

1. Design-system tokens and theming ← *foundation*
2. Component library
3. Application shell (nav, top bar, search, command palette)
4. Operations overview
5. Gate workspace
6. Vehicle 360
7. Live yard · 8. Release · 9. Finance · 10. Auction · 11. Users · 12. Portal
13. Console tests · 14. Visual QA

Progress is tracked in `docs/UI-IMPLEMENTATION-STATUS.md`.

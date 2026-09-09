# YARDOS Console — Implementation Status

Last updated: **2026-09-09**. Reflects what is in the repository, verified by
building and running it.

---

## Completed

| Area | What was done | Verified by |
|---|---|---|
| **Design system** | Tokens moved from Tailwind class names to CSS custom properties; light default + designed dark; nine-state semantic status vocabulary with colour + icon + word; `VehicleIdentifier`, `Money`, `Age`, `StatusBadge`, `CapacityBar`, `Chip`; loading / empty / error / not-available states | typecheck, build, tokens confirmed in compiled CSS for both themes |
| **Overlays** | `Drawer`, `Modal`, `ConfirmDialog` with focus trap, focus restore, Escape | typecheck, build |
| **Toasts** | Outcome-only notifications; failures persist longer than successes | typecheck, build |
| **Application shell** | Grouped permission-filtered nav, collapsible sidebar, mobile drawer, top bar, theme toggle, user menu | build, 12 routes |
| **Site context** | Site list derived from the caller-scoped occupancy report; switching invalidates the query cache | typecheck, build |
| **Global search + command palette** | One surface, Cmd/Ctrl+K and `/`, plate-format-insensitive, keyboard navigable, permission-filtered commands | typecheck, build |
| **Operations overview** | Control-room composition: attention KPIs → exposure → capacity → ageing → queues → gate activity. Every KPI links to the list behind it | **every request returns 200 against the running API with seeded data** |
| **Console tests** | 135 Jest tests over the status vocabulary, formatters and auth logic; wired into CI | `npm run test -w @smartpark/web` |
| **Authentication** | Sign-in rebuilt, password visibility, code-based error mapping, session expiry, unauthorized state, permission-derived landing route, change-password screen | live API calls; see `AUTH-UI-IMPLEMENTATION.md` |

### Defects found and fixed during this work

1. **`formatAgeing(30)` rendered "1 month*s*"** — caught by the new tests, fixed in source.
2. **Un-reworked screens rendered unstyled** — removing the old colour names left nine screens referencing classes Tailwind no longer emitted. They compiled fine. Fixed with theme-aware legacy aliases, confirmed in the compiled CSS.
3. **Semantic `slate` token shadowed Tailwind's `slate` scale** used by those same screens. Renamed to `steel`.

---

## In progress / not yet reworked

These screens **work** and are now theme-aware through the legacy aliases, but
still carry the previous visual language and structure.

| Screen | State | What the rework needs |
|---|---|---|
| `/gate` | Functional, 968 lines | Explicit state machine per brief §14; dominant primary action; new tokens |
| `/vehicles/[id]` | Functional, single column | Tabs: overview, timeline, location, financial, auction, audit |
| `/yard`, `/yard/[id]` | Functional | Zone capacity view; release as a guided workflow |
| `/billing` | Functional | Invoice detail with charge-breakdown explanation |
| `/auctions` | Functional | Board/list hybrid; bid ladder drawer |
| `/vehicles` | Functional | `DataTable` with column visibility and saved filters |
| `/portal` | Functional | Rework onto new components |

**Compatibility layer still in use** — deleted as the above are reworked:
`Badge`, `toneForStatus`, `MetricCard`, `UtilisationBar`, and the legacy colour
aliases (`base-*`, `accent-*`, `ok-*`, `warn-*`, `info-*`, `muted-*`) in
`tailwind.config.ts`.

---

## Backend dependencies — UI that cannot be built

Verified by inspecting the controllers. These are **not** UI gaps.

| Brief section | Blocker |
|---|---|
| §34–35 Notification centre | `modules/notification/` is an **empty directory**. No controller, no service. Schema and templates exist. |
| §36 Settings | `settings.service.ts` exists; **no controller**. Not reachable over HTTP. |
| §38 Audit view | `audit.service.ts` exists; **no controller**. Audit rows are written but never read back over the API. |
| §18 Bay-level grid | No per-bay endpoint. `OccupancyReport` gives site → zone with capacity/occupied/available. A zone view is honest; individual bay states with occupants would be invented. |
| §33 Reports section | Six report endpoints exist and are consumed by the dashboard. A dedicated reporting section with export needs endpoints that do not exist. |
| §26 Live bidding | No realtime transport. Polling only. |
| Documents tab | `modules/document/` is empty. `ObjectStorageService` exists but is not exposed. |

None of these has a navigation entry, and none has a screen. A nav item leading
to a page that cannot load data is a dead button.

**Buildable and still missing:** `/users` — eight endpoints, no UI.

---

## Known limitations

- **No browser-based visual QA has been performed.** Verification was
  typecheck, production build, compiled-CSS inspection, and confirming every
  API request the dashboard makes returns 200 with real data. Spacing,
  alignment, hover and focus states across breakpoints have **not** been
  checked in a rendered browser. Doing so needs a headless browser, which the
  brief asks not to introduce as a new framework — see the test plan.
- **No component rendering tests**, for the same reason.
- The dashboard polls every 30s. There is no realtime transport in the backend.
- Dark mode is designed but has not been reviewed against a real gate screen.

---

## Remaining UI work, in priority order

1. **Gate workspace** — the most operationally critical screen. Needs the
   explicit state machine of §14, a visually dominant primary action, and the
   new tokens.
2. **Vehicle 360** — tabs, timeline, charge-breakdown explanation.
3. **Live yard** — zone capacity, allocation.
4. **Release workflow** — guided, with the eligibility checks surfaced.
5. **Invoice detail** — the charge explanation the engine already produces and
   the UI currently discards.
6. **Auction workspace** — board/list hybrid, immutable bid ladder.
7. **Users & roles** — the buildable gap.
8. **Financier portal + login** — rework onto the new system.
9. Delete the compatibility layer.
10. Browser visual QA and responsive pass.

---

## Test coverage

| Suite | Tests | Covers |
|---|---|---|
| Console (Jest) | **135** | Status vocabulary, ageing severity, registry wording, money and plate formatting, auth error mapping, password policy, landing routes |
| API unit | 288 | Charge engine, billing rules, duration, snapshots, money, config guard |
| API integration | 49 | Financier isolation, plate normalisation, webhook signatures, idempotency |
| API e2e | 45 | Full recovery lifecycle and auction disposal over HTTP |

**517 tests total.** The console's screens are covered indirectly: the 45 e2e
tests drive the same API the screens consume, so a contract change breaks the
build or a test rather than only the UI.

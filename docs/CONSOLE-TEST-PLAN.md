# YARDOS Console — Test Plan

What is tested, what is not, and why — so the gaps are decisions rather than
oversights.

---

## What exists today

### Console unit tests — 135, Jest, `npm run test -w @smartpark/web`

Scoped to `apps/web/lib/`: pure logic, no DOM, no new dependencies.

| Module | Tests | Why it is worth testing |
|---|---|---|
| `lib/status.ts` | 45 | This map is why a stay, an invoice, a bid and a registry lookup look consistent. A mistake is invisible in review and wrong on **every** screen at once — showing green where the system said blocked is the misread that lets a vehicle leave when it should not have. Includes: unmapped statuses resolve to UNKNOWN rather than success; `AMBIGUOUS` never reads as matched; ageing severity escalates monotonically; the registry wording never claims a mock provider confirmed anything. |
| `lib/auth-errors.ts` | 38 | Two of these are security properties, not niceties. **No account enumeration:** a wrong password and an unknown email must produce byte-identical messaging, and the mapping is asserted never to contain "not found", "no account" or similar. **No wrong landing:** a financier must never be routed to the estate dashboard, whose headline figures are not theirs. Also pinned: an unmapped backend code falls back to a generic message rather than surfacing the server's own words, every 5xx is reported as ours whatever its code, and the password-policy mirror matches `PasswordHasherService.validatePolicy` rule for rule. |
| `lib/format.ts` | 52 | Indian lakh/crore grouping, plate normalisation, absent values. A mis-grouped amount is still a plausible number — nobody notices until a financier queries an invoice. Every renderer returns an em dash for missing input rather than `0`, `NaN` or `undefined`; rendering a missing balance as zero would tell an operator a vehicle owes nothing when the truth is that we do not know. |

These run in CI in the `Console build` job, before the build.

**One real defect found:** `formatAgeing(30)` rendered `1 months`. Fixed in
source.

### Indirect coverage — 94 database-backed API tests

The 45 e2e and 49 integration tests drive the same endpoints the console
consumes. A contract change surfaces as a failing test or a typecheck error
rather than as a screen that silently renders nothing.

---

## What is NOT tested, and why

### Component rendering

**Not covered.** Needs `jsdom` and a testing library — new dependencies, which
the brief asks not to introduce unnecessarily (§87).

*Cost of the gap:* a component that throws on an edge case would reach a user.
Partly mitigated by TypeScript strict mode and by null-handling being pushed
into the tested `lib/` functions rather than living in JSX.

*How to close it:* add `jest-environment-jsdom` and
`@testing-library/react`, then test the components where the logic is not
already in `lib/` — `CommandPalette` keyboard navigation, `AppShell` permission
filtering, `ConfirmDialog` focus trapping, and the `PasswordField` toggle
(that it is `type="button"` and cannot submit its form).

### Browser visual QA

**Not performed.** Verification was typecheck, production build, compiled-CSS
inspection and confirming every API request the dashboard makes returns 200
against the running API with seeded data.

Spacing, alignment, contrast, hover/focus/disabled states, overflow behaviour
and the 1920→768 responsive pass have **not** been checked in a rendered
browser. This is stated plainly because the brief asks for visual QA (§80) and
it has not been done.

*How to close it:* Playwright, which would also cover the journeys below.

### End-to-end console journeys

**Not covered.** The brief lists ten (§87) and a critical journey (§88).

The API-level equivalents of every one already pass — `recovery-lifecycle`
covers ANPR → admission → allocation → charges → release → invoice → payment →
exit → audit, and `auction-lifecycle` covers listing → bid → winner →
settlement → transfer. What is untested is the **browser path** to those same
operations.

*How to close it:* Playwright against the running stack, reusing the seeded
accounts the API e2e suite already uses.

---

## Recommended next steps, in order

1. **Playwright**, if a headless browser is acceptable. It closes visual QA and
   the journey tests together, and is the single highest-value addition.
   Journeys, in priority order:
   1. Sign in → land on the permission-appropriate screen
   2. Dashboard loads with real figures
   3. Global search resolves `tn09qq7788` to a vehicle
   4. Gate: simulate a capture → admission decision shown
   5. Vehicle 360 loads all tabs
   6. Release: eligibility → request → approve → complete
   7. Invoice: issue → record payment → balance updates
   8. Auction: place bid → ladder shows the superseded bid
   9. **Financier isolation:** signed in as `portal@nvf.example`, an SCF
      vehicle's URL returns not-found — the browser-level counterpart of the
      integration test that already passes
   10. Site switching clears the previous site's rows
2. **Component tests** for `CommandPalette`, `AppShell` and `ConfirmDialog`.
3. **Axe accessibility assertions** inside the Playwright run, rather than a
   separate tool.

---

## Running the tests

```bash
npm run test -w @smartpark/web        # console, 135, no services needed
npm run test:unit -w @smartpark/api   # 288
npm run test:integration -w @smartpark/api   # 49, needs the stack + seed
npm run test:e2e -w @smartpark/api           # 45, needs the stack + seed
```

Integration and e2e need `npm run stack:up` and `npm run db:seed`.

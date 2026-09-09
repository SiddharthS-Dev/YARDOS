# Authentication UI — Implementation Status

Last updated **2026-09-09**. Verified by building and running the repository,
not by reading it.

---

## Built

| Item | Detail |
|---|---|
| **Sign-in page** | Rebuilt on the design system. Centred card capped at 24rem, balanced column, no wasted height. |
| **Password visibility** | `type="button"` toggle with `aria-label`, `aria-pressed`, `aria-controls`. Cannot submit the form. |
| **Error mapping** | `lib/auth-errors.ts` maps the stable error **code** to title/body/hint. Never branches on message text. |
| **Loading state** | Button becomes "Signing in…", `aria-busy`, duplicate submission blocked. Email retained, password cleared. |
| **Session expiry** | `yardos:session-expired` event → cache cleared → `/login?reason=session-expired`. Distinguishes ordinary expiry from token reuse. |
| **Logout** | Now clears the **entire query cache** and the stored site. Previously a cross-tenant leak. |
| **Unauthorized state** | `UnauthorizedState` — "Access restricted", with a way out, naming no permission. |
| **Account states** | `ACCOUNT_LOCKED` and `ACCOUNT_NOT_ACTIVE` each get their own wording and hint. |
| **Post-login routing** | `landingRouteFor()` derives the destination from the user's own permissions. Was hard-coded to `/gate`. |
| **Change password** | `/account/password`. `POST /auth/change-password` existed with **no UI at all**. |
| **Environment notice** | Renders only when `NODE_ENV !== 'production'`. |
| **Tests** | 38 new; 135 console tests total. |

### Defects fixed

1. **Logout left the query cache intact.** Tokens and the user object were
   cleared but cached vehicles, invoices and site context were not, so signing
   in as a different user rendered the previous user's data until each query
   happened to refetch. On a shared gate terminal with two financier users that
   is a cross-tenant leak on screen. `clearSession()` now wipes the cache and
   the stored site on both logout and expiry, and `signIn` clears it again
   before the new session starts.

2. **Post-login redirect was hard-coded to `/gate`.** Wrong for a finance
   officer, and actively misleading for a financier, whose data exists only in
   the portal.

3. **`POST /auth/change-password` had no UI.** The only way to change a password
   was to ask an administrator to reset it.

---

## Not built — no backend

Catalogued in [`AUTH-BACKEND-GAPS.md`](./AUTH-BACKEND-GAPS.md). No route, no
button, no placeholder for any of these:

| Flow | Gap |
|---|---|
| Request access | No endpoint, no model (GAP 3) |
| Invitation / activation | `UserStatus.INVITED` exists; no token, model or endpoint (GAP 2) |
| Forgot password | No endpoint, no reset-token model, no email transport (GAP 1) |
| Reset password | Same as above (GAP 1) |
| Forced first-login change | `mustChangePassword` is set but absent from the profile (GAP 4) |

The sign-in page states the real alternative — *"Contact your Sri JP
administrator"* — as text, not as a link to nowhere.

---

## Verified against the running API

| Check | Result |
|---|---|
| Valid sign-in | `MANAGEMENT`, 37 permissions |
| Unknown email | `INVALID_CREDENTIALS` — identical to a wrong password |
| Rate limiting | `RATE_LIMITED` at the 10/60s cap, unchanged |

Rate limiting was **not** weakened to make testing easier.

---

## Quality gate

| Gate | Result |
|---|---|
| TypeScript (api + web) | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Console tests | 135 passed |
| API unit | 288 passed |
| API integration | 49 passed |
| API e2e | 45 passed |
| Production build | 13 routes |
| `npm audit` | 0 vulnerabilities |

**517 tests.** The 479 that existed before all still pass.

---

## Known limitations

- **No browser visual QA.** No headless browser is installed and the brief asks
  not to add a framework unnecessarily. Light/dark, the responsive range and
  focus states have **not** been checked in a rendered browser. Verification was
  typecheck, build, compiled-CSS token inspection and live API calls.
- **No component rendering tests**, same reason. The 38 new tests cover the
  pure logic: error mapping, the password-policy mirror, landing routes.
- The account-status screens are reachable only by provoking the API into
  returning those codes; they have not been seen rendered.

---

## Remaining work

1. Expose `mustChangePassword` on the profile (GAP 4 — one boolean) and force
   the change before navigation.
2. Notification module, then self-service password reset (GAP 1).
3. Invitation model and activation (GAP 2).
4. Access-request model and admin queue (GAP 3).
5. Browser visual QA across both themes and the responsive range.

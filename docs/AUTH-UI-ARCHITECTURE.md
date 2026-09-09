# YARDOS — Authentication UI Architecture

Written from an inspection of the repository on **2026-09-09**. Where this
disagrees with any brief, it follows the code.

Backend gaps are catalogued separately in
[`AUTH-BACKEND-GAPS.md`](./AUTH-BACKEND-GAPS.md); this document covers what is
built and why.

---

## 1. The existing model, preserved

Nothing about the authentication architecture is being replaced. It was audited
first, and it is sound.

**Tokens, not cookies.** `POST /auth/login` returns an access token and a
rotating refresh token. The console holds both in `sessionStorage` — not
`localStorage` — deliberately: a shared gate terminal must not keep a session
alive after the tab closes. Moving these to `localStorage` for convenience would
weaken that, and is explicitly not done.

**Rotation with reuse detection.** Each refresh issues a new pair and revokes
the old. Presenting a revoked token is treated as theft: the entire token family
is revoked. This is why `lib/api.ts` guards refresh behind a single in-flight
promise — six parallel dashboard queries hitting 401 together would otherwise
attempt six refreshes, five of which look exactly like reuse.

**The server is authoritative for everything that matters.** Identity, tenant,
roles, permissions, site access and account status all come from `GET /auth/me`.
The console uses `can()` / `canAny()` only to decide *what to render*. Every
endpoint re-checks, and both sides read the same 86-permission catalogue from
`@smartpark/contracts`, so they cannot drift.

**Rate limiting stays.** Login is capped at 10 attempts per 60 seconds
(`@Throttle({ login: { limit: 10, ttl: 60_000 } })`). It has not been relaxed,
and the tests work with it rather than around it.

---

## 2. Flows

| Flow | State | Route |
|---|---|---|
| A — Sign in | **Built** | `/login` |
| B — Request access | Not supported — GAP 3 | — |
| C — Invitation / activation | Not supported — GAP 2 | — |
| D — Forgot password | Not supported — GAP 1 | — |
| E — Reset password | Not supported — GAP 1 | — |
| F — First login / forced change | Voluntary only — GAP 4 | `/account/password` |
| G — Logout | **Built** | — |
| H — Session expired | **Built** | `/login?reason=session-expired` |
| I — Unauthorized | **Built** | in-place 403 state |
| J — Disabled / locked | **Built** | on `/login` |

Flows B–E have **no route and no button**. The sign-in page states the real
alternative — contact an administrator — because that is what actually happens
today.

---

## 3. Sign-in page

Layout is a centred card, capped at `24rem`, vertically centred with generous
but not cavernous padding. The previous screen wasted most of its height; the
mark, card and notice now form one balanced column.

```
        [ mark ]
         YARDOS
  Vehicle Yard Operating System

  ┌────────────────────────────┐
  │ Sign in                    │
  │                            │
  │ Email address              │
  │ [                        ] │
  │                            │
  │ Password            [ eye ]│
  │ [                        ] │
  │                            │
  │ [      Sign in           ] │
  │                            │
  │ Forgotten your password?   │
  │ Contact your administrator.│
  └────────────────────────────┘

  Need access? Contact your
  Sri JP administrator.

  ┌ DEVELOPMENT ENVIRONMENT ───┐
  │ Seeded data is fictional…  │
  └────────────────────────────┘
```

**Product identity is YARDOS.** "Vehicle Yard Operating System" is the subtitle.
Sri JP appears as the operating organisation, not as the platform — the
architecture is multi-tenant and the branding must not imply otherwise.

**The environment notice is derived, never hard-coded.** It renders only when
`process.env.NODE_ENV !== 'production'`. A production build shows nothing.

---

## 4. Error mapping

`lib/auth-errors.ts` maps the API's stable `code` — never message text — onto a
title, a body and an optional hint.

| Code | Title | Body |
|---|---|---|
| `INVALID_CREDENTIALS` | Unable to sign in | The email address or password is incorrect. |
| `ACCOUNT_LOCKED` | Account locked | Too many failed sign-in attempts… |
| `ACCOUNT_NOT_ACTIVE` | Account not active | This account is not active. Contact your administrator. |
| `RATE_LIMITED` | Too many attempts | Too many sign-in attempts. Wait a moment and try again. |
| `TOKEN_EXPIRED` / `TOKEN_INVALID` | Session expired | Please sign in again to continue. |
| `REFRESH_TOKEN_REUSED` | Session ended | For your security this session was ended. Sign in again. |
| `NETWORK_ERROR` | Cannot reach YARDOS | Check your connection and try again. |
| anything 5xx | Something went wrong at our end | Try again in a moment. |

Two rules the mapping enforces:

**No account enumeration.** A wrong password and an unknown email produce the
same `INVALID_CREDENTIALS`, and the console does not embellish it. `ACCOUNT_LOCKED`
and `ACCOUNT_NOT_ACTIVE` do confirm an account exists — but the *server* only
returns those after a correct password, so the console is not the leak.

**No internals.** Unrecognised codes fall back to a generic message rather than
rendering a raw server string, so an unmapped internal error cannot surface.

---

## 5. Session expiry

Distinguished from "never signed in", because the two need different words.

`lib/api.ts` already tries one refresh and replays. When that fails the session
is genuinely over, so it clears the token store and dispatches a
`yardos:session-expired` event. `AuthProvider` listens, clears user state, wipes
the React Query cache and redirects to `/login?reason=session-expired`, where
the page shows *"Session expired — please sign in again to continue."*

An event rather than a direct import because `lib/api.ts` is framework-agnostic
and must not depend on React or the router.

---

## 6. What logout clears — and why it is a security property

`signOut` calls the API, then **clears the entire React Query cache** before
redirecting.

This was a real defect. Previously logout cleared the token store and the user
object but left the cache intact, so signing in as a different user could render
the previous user's vehicles, invoices and site context from cache until each
query refetched. On a shared gate terminal, with two financier users, that is a
cross-tenant leak visible on screen.

Cleared on sign-out and on session expiry:

- the query cache in full — vehicles, invoices, auctions, reports, sessions
- the user profile
- the selected site (`yardos.site`)
- access and refresh tokens

Retained: the theme preference, which is a per-device display setting and
carries nothing tenant-specific.

Both the command palette and global search live inside `AppShell`, which renders
nothing until a user is resolved, so neither can be reached — or hold data —
while signed out.

---

## 7. Post-login destination

Previously hard-coded to `/gate`, which is wrong for a finance officer or a
financier portal user.

`landingRouteFor(profile)` now derives it from the user's own permissions:

| Holds | Lands on |
|---|---|
| `report:financier` and a `financierId` | `/portal` |
| `session:admit` | `/gate` |
| `report:operations` / `report:finance` | `/dashboard` |
| `invoice:read` | `/billing` |
| `vehicle:read` | `/vehicles` |
| none of the above | `/dashboard` |

Order is by how specific the role is, not by preference. A financier user is
checked first because the portal is the only place their data belongs.

---

## 8. No authorization flash

`AppShell` renders `LoadingState` while `loading` is true and `null` when there
is no user, redirecting to `/login`. Protected content is never painted before
identity and permissions have resolved, so one user's shell cannot appear during
another's sign-in.

---

## 9. Endpoint map

| Component | Endpoint | On error |
|---|---|---|
| `LoginForm` | `POST /auth/login` | mapped by code; email retained, password cleared |
| `AuthProvider` restore | `GET /auth/me` | clears tokens, stays signed out |
| `apiRequest` 401 | `POST /auth/refresh` | one attempt, then session-expired event |
| `signOut` | `POST /auth/logout` | still clears locally — a network blip must not leave a session apparently open on a shared terminal |
| `ChangePasswordForm` | `POST /auth/change-password` | `PASSWORD_POLICY_VIOLATION` renders `details.problems` verbatim |

---

## 10. Password policy

The console never invents rules. `PASSWORD_RULES` in `lib/auth-errors.ts`
mirrors `PasswordHasherService.validatePolicy` exactly:

at least 12 characters · a lowercase letter · an uppercase letter · a digit · a
symbol · not a common password · not a single repeated character · must not
contain your email local-part · must not contain your name

The live checklist is a UX aid only. The server re-validates, and when it
refuses it returns `details.problems` — which the form renders as given, so the
authoritative reason is always the one shown.

---

## 11. Accessibility

- Labels are real `<label for>`; placeholders are never used as labels
- Errors carry `role="alert"` and `aria-live="polite"`, and inputs are wired
  with `aria-invalid` and `aria-describedby`
- The password toggle is a `<button type="button">` — it cannot submit the
  form — with an `aria-label` that changes with state and `aria-pressed`
- Focus is visible on both themes via the global `:focus-visible` outline
- Submitting is announced by an `aria-busy` button whose label changes to
  "Signing in…"
- `prefers-reduced-motion` is honoured globally

---

## 12. Components

New: `AuthLayout`, `AuthCard`, `AuthNotice`, `EmailField`, `PasswordField`
(with toggle), `FormError`, `PasswordRequirements`.

Reused unchanged: `Button`, `api.ts`, `auth-context.tsx`, the theme tokens, the
status vocabulary. No second auth context, no second HTTP client, no separate
visual language for the auth pages.

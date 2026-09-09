# Authentication — Backend Gaps

What the brief asks for that the API cannot currently support. Verified by
inspecting controllers, services and the Prisma schema on **2026-09-09**.

Nothing in this list has been built as UI. A screen with no endpoint behind it
is a dead button, and a convincing-looking one is worse than none.

---

## What the backend DOES support

| Flow | Endpoint | Notes |
|---|---|---|
| Sign in | `POST /auth/login` | Rate limited 10 / 60s |
| Refresh | `POST /auth/refresh` | Rotating tokens, reuse detection |
| Logout | `POST /auth/logout` | Revokes the refresh token |
| Identity | `GET /auth/me` | Roles, permissions, site access, financier |
| Change password | `POST /auth/change-password` | Requires the current password |
| Admin: create user | `POST /users` | Issues a temporary password |
| Admin: reset password | `POST /users/:id/reset-password` | Sets `mustChangePassword` |
| Admin: set status | `PATCH /users/:id/status` | ACTIVE / LOCKED / SUSPENDED / DISABLED |

Account states the API can already return, and which the UI must handle:
`INVALID_CREDENTIALS` (401), `ACCOUNT_LOCKED` (423), `ACCOUNT_NOT_ACTIVE` (403),
`TOKEN_EXPIRED` (401), `TOKEN_INVALID` (401), `REFRESH_TOKEN_REUSED` (401),
`RATE_LIMITED` (429), `PASSWORD_POLICY_VIOLATION` (400).

---

## GAP 1 — Self-service password reset

**Flows blocked:** D (Forgot password), E (Reset password)

There is no `POST /auth/forgot-password`, no `POST /auth/reset-password`, and
**no password-reset token model** in the schema. The only reset path is
`POST /users/:id/reset-password`, which an administrator calls and which returns
a temporary password to *the administrator*, not to the user.

A self-service flow needs:

- a `PasswordResetToken` model — hashed token, `userId`, `expiresAt`,
  `usedAt`, single-use, short-lived
- `POST /auth/forgot-password` — always 202 regardless of whether the email
  exists, so the endpoint cannot be used to enumerate accounts
- `POST /auth/reset-password` — consumes the token, applies the same
  `validatePolicy` rules, revokes every refresh token for that user
- an email transport — `modules/notification/` is an **empty directory**, so
  there is currently no way to deliver the link at all

**UI consequence:** the sign-in page shows *"Forgotten your password? Contact
your administrator to have it reset."* — text, not a link to nowhere.

---

## GAP 2 — Invitation and account activation

**Flow blocked:** C (Accept invitation)

`UserStatus.INVITED` exists and is the **default for every new user**, but there
is no invitation token, no `Invitation` model, and no activation endpoint. An
INVITED user who tries to sign in is refused with `ACCOUNT_NOT_ACTIVE` and has
no way to activate themselves.

In practice `POST /users` mints a temporary password and the administrator
conveys it out of band; the status is then moved to ACTIVE by hand.

An invitation flow needs:

- an `Invitation` model — hashed token, `userId`, `expiresAt`, `acceptedAt`,
  `revokedAt`, issuing actor
- `GET /auth/invitation/:token` — returns organisation, role and site for the
  activation screen **without** requiring authentication, and without leaking
  anything beyond that one invitation
- `POST /auth/invitation/:token/accept` — sets the password, moves the user to
  ACTIVE, marks the invitation used
- the same email transport as GAP 1

**UI consequence:** no `/accept-invitation` route.

---

## GAP 3 — Request access

**Flow blocked:** B (Request access)

No endpoint, no model. YARDOS is an enterprise platform, so unrestricted
self-registration is not the right answer anyway — but "request access" needs
somewhere for the request to land and someone to review it.

Needs:

- an `AccessRequest` model — name, work email, organisation, stated reason,
  requested site, status, reviewer, decision
- `POST /auth/request-access` — public, heavily rate limited, no account
  enumeration in its response
- an administrator queue to review, approve (which would issue an invitation)
  or decline
- abuse protection: this is an unauthenticated write endpoint

**UI consequence:** no `/request-access` route. The sign-in page says
*"Need access? Contact your Sri JP administrator."*

---

## GAP 4 — `mustChangePassword` is set but never surfaced

**Flow blocked:** F (First login / forced password change)

`User.mustChangePassword` exists, is set to `true` by `POST /users` when no
password is supplied and by `POST /users/:id/reset-password`, and is cleared by
`POST /auth/change-password`.

But **`AuthenticatedUserProfile` does not include it**. The console therefore
cannot tell that a user is on a temporary password, and cannot force the change.

This is the cheapest gap to close by a wide margin: add one boolean to the
profile projection in `auth.service.ts` and to the contract interface. No new
model, no new endpoint, no email.

Once exposed, the console can require the change before allowing navigation —
and `POST /auth/change-password` already revokes every other session, which is
exactly the right behaviour after a temporary password is retired.

**UI consequence today:** the change-password screen exists at
`/account/password` and works, but is voluntary. It cannot yet be *forced*.

---

## GAP 5 — No account-status detail for a signed-in user

Minor. `GET /auth/me` returns `status`, so a SUSPENDED user who somehow holds a
valid access token can be detected. But login already refuses any non-ACTIVE
status, so this is defence in depth rather than a live path.

---

## Summary

| Brief flow | Supported | Built |
|---|---|---|
| A — Sign in | Yes | Yes |
| B — Request access | **No** | No (GAP 3) |
| C — Invitation / activation | **No** | No (GAP 2) |
| D — Forgot password | **No** | No (GAP 1) |
| E — Reset password | **No** | No (GAP 1) |
| F — First login / forced change | **Partial** | Voluntary only (GAP 4) |
| G — Logout | Yes | Yes |
| H — Session expired | Yes | Yes |
| I — Unauthorized | Yes | Yes |
| J — Account disabled / locked | Yes | Yes |

**Recommended order if these are to be closed:** GAP 4 (one field), then GAP 1
(needs the notification module first), then GAP 2, then GAP 3.

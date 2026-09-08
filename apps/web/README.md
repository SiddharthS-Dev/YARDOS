# Operations console — not yet implemented

This workspace is reserved for the SmartPark Enterprise operations console
(Next.js App Router). **No application code has been written yet.**

What exists here is the dependency manifest and the public environment
variables, so the stack choice and its pinned versions are recorded rather than
re-litigated later:

- Next.js 15 (App Router) + React 19
- TanStack Query for server state
- React Hook Form + Zod for forms
- Tailwind CSS + Recharts

It intentionally consumes `@smartpark/contracts`, which is what will keep the
console and the API from drifting apart: the console uses the same state
machines the API enforces to decide which actions to offer, and the same
permission catalogue to decide what to show.

## Screens to build

Priority order, highest-frequency user first:

1. **Live gate** — the operator screen. Latest capture, confidence, vehicle,
   financier, contract, and one primary action. Manual override only when
   recognition genuinely failed.
2. **ANPR review queue** — resolve low-confidence captures.
3. **Vehicle detail** — identity, ownership, financier, charges, timeline.
4. **Yard operations dashboard** — occupancy, arrivals, exits, holds, vehicles
   awaiting action.
5. **Unrated stays work queue** — the deliberate consequence of the gate never
   blocking; finance attaches the contract rate here.
6. **Executive dashboard** — occupancy, ageing, revenue, outstanding.
7. Contracts and rate cards, billing and invoices, releases, auction console,
   financier portal, administration.

Every one of these has a working, documented API behind it already, except
where `docs/requirements-traceability.md` marks the backend as Foundation
(release, invoice, payment, auction, notification).

## Getting started

```bash
npm run dev:web    # once an app/ directory exists here
```

See `docs/requirements-traceability.md` for what the backend currently
supports, and `/api/docs` on a running API for the live OpenAPI specification.

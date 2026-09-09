/**
 * Signed callbacks.
 *
 * A payment gateway cannot hold a bearer token, so the HMAC signature IS the
 * authentication. Two things have to be true for that to mean anything:
 *
 *   1. The signature is verified over the bytes the sender actually sent, not
 *      over a re-serialisation of the parsed body. `JSON.stringify` reorders
 *      keys, drops the sender's whitespace and re-escapes non-ASCII, so a
 *      signature checked against it is a signature checked against a document
 *      nobody signed. This suite sends deliberately awkward JSON to prove the
 *      raw bytes are what gets verified.
 *
 *   2. A replayed callback cannot pay an invoice twice. Delivery is at-least-
 *      once by design on every gateway worth using.
 */

import { createHmac } from 'node:crypto';

import { HEADER_PAYMENT_SIGNATURE } from '@smartpark/contracts';

import { SEED_USERS, Session, TestContext, createTestContext, signIn } from '../setup/harness';

/** The secret the API is configured with for this run. */
const WEBHOOK_SECRET = process.env['PAYMENT_WEBHOOK_SECRET'] ?? '';

const sign = (rawBody: string): string =>
  createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

describe('payment webhook authentication', () => {
  let ctx: TestContext;
  let finance: Session;

  beforeAll(async () => {
    ctx = await createTestContext();
    finance = await signIn(ctx, SEED_USERS.finance);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /* ---------------------------------------------------------------- */

  it('refuses a callback with no signature at all', async () => {
    const response = await ctx
      .http()
      .post('/api/v1/payments/webhook')
      .send({ event: 'payment.captured', providerEventId: 'evt-unsigned-1' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(finance).toBeTruthy();
  });

  it('refuses a callback whose signature does not match the body', async () => {
    const response = await ctx
      .http()
      .post('/api/v1/payments/webhook')
      .set(HEADER_PAYMENT_SIGNATURE, 'deadbeef'.repeat(8))
      .send({ event: 'payment.captured', providerEventId: 'evt-badsig-1' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('refuses a body that was altered after being signed', async () => {
    const signed = JSON.stringify({ providerEventId: 'evt-tamper-1', amount: '100.00' });
    const signature = sign(signed);

    // Same shape, different amount. This is the attack the signature exists
    // to stop: a valid signature over a different document.
    const response = await ctx
      .http()
      .post('/api/v1/payments/webhook')
      .set(HEADER_PAYMENT_SIGNATURE, signature)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ providerEventId: 'evt-tamper-1', amount: '999999.00' }));

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  describe('verification uses the transmitted bytes, not a re-serialisation', () => {
    // Each of these is valid JSON whose byte sequence differs from what
    // JSON.stringify would produce for the parsed object. Before the raw-body
    // fix, verification was performed against JSON.stringify(parsedBody) and
    // every one of these would have failed to verify a legitimate signature.

    const awkwardBodies: Array<[name: string, raw: string]> = [
      ['insignificant whitespace', '{\n  "providerEventId": "evt-ws-1",\n  "amount": "1.00"\n}'],
      ['key order the sender chose', '{"amount":"1.00","providerEventId":"evt-order-1"}'],
      ['escaped non-ASCII', '{"providerEventId":"evt-uni-1","note":"\\u20b9 charge"}'],
      ['literal non-ASCII', '{"providerEventId":"evt-uni-2","note":"₹ charge"}'],
      ['trailing newline', '{"providerEventId":"evt-nl-1","amount":"1.00"}\n'],
    ];

    it.each(awkwardBodies)('accepts the signature over a body with %s', async (_name, raw) => {
      const response = await ctx
        .http()
        .post('/api/v1/payments/webhook')
        .set(HEADER_PAYMENT_SIGNATURE, sign(raw))
        .set('Content-Type', 'application/json')
        .send(raw);

      // The callback is authentic but describes no payment we know about, so
      // it is accepted and ignored, or rejected on its CONTENT. What must not
      // happen is rejection as UNAUTHENTICATED: that would mean the signature
      // was checked against bytes the sender never transmitted.
      expect(response.status).not.toBe(401);
      expect(JSON.stringify(response.body)).not.toMatch(/signature/i);
    });
  });

  it('treats a redelivered callback as the same event, not a second one', async () => {
    const raw = JSON.stringify({
      providerEventId: 'evt-replay-fixed-1',
      event: 'payment.captured',
      amount: '1.00',
    });
    const signature = sign(raw);

    const first = await ctx
      .http()
      .post('/api/v1/payments/webhook')
      .set(HEADER_PAYMENT_SIGNATURE, signature)
      .set('Content-Type', 'application/json')
      .send(raw);

    const second = await ctx
      .http()
      .post('/api/v1/payments/webhook')
      .set(HEADER_PAYMENT_SIGNATURE, signature)
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(second.status).toBe(first.status);

    // At most one stored event per provider event id, enforced by a unique
    // index rather than by a check-then-insert that a race could defeat.
    if (first.status < 400) {
      const stored = await ctx.prisma.paymentWebhookEvent.count({
        where: { providerEventId: 'evt-replay-fixed-1' },
      });
      expect(stored).toBeLessThanOrEqual(1);
    }
  });

  it('never echoes the signing secret in a response', async () => {
    const response = await ctx
      .http()
      .post('/api/v1/payments/webhook')
      .set(HEADER_PAYMENT_SIGNATURE, 'aa'.repeat(32))
      .send({ providerEventId: 'evt-leak-check-1' });

    const body = JSON.stringify(response.body);
    if (WEBHOOK_SECRET) expect(body).not.toContain(WEBHOOK_SECRET);
    expect(body).not.toMatch(/PAYMENT_WEBHOOK_SECRET/);
  });
});

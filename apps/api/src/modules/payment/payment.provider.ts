import { Inject, Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { ErrorCode } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppException } from '@/common/errors/app-exception';

/**
 * The payment integration boundary.
 *
 * Requirement S22: business logic must not be coupled to one gateway. The
 * domain talks to this interface; which gateway sits behind it is a
 * configuration matter (OI-09 — the payment methods for Phase 2 public parking
 * are an unresolved business decision).
 */

export interface PaymentIntentRequest {
  invoiceId: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  payerName: string;
  payerEmail?: string | null;
  payerPhone?: string | null;
  /** Our own idempotency key, passed through to the gateway where supported. */
  idempotencyKey: string;
}

export interface PaymentIntentResult {
  provider: string;
  providerOrderId: string | null;
  providerTransactionId: string | null;
  /** Where the payer completes the payment, when the gateway is redirect-based. */
  redirectUrl: string | null;
  /**
   * INITIATED - the payer must now act.
   * PENDING   - the gateway has it and will call back.
   * SUCCESS   - settled synchronously. ONLY legitimate for counter collection,
   *             where a human has the cash in hand.
   */
  outcome: 'INITIATED' | 'PENDING' | 'SUCCESS';
}

/** A gateway callback, normalised. */
export interface NormalisedWebhook {
  providerEventId: string;
  eventType: string;
  /** Correlates back to our payment; either may be present. */
  providerOrderId: string | null;
  providerTransactionId: string | null;
  /** Our idempotency key, when the gateway echoes it. */
  idempotencyKey: string | null;
  amount: string | null;
  currency: string | null;
  outcome: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' | 'UNKNOWN';
  failureReason: string | null;
}

export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract readonly configured: boolean;
  /**
   * False for anything that does not move real money. A non-authoritative
   * provider can never mark an invoice paid without an explicit human record.
   */
  abstract readonly authoritative: boolean;
  /** True when the provider signs its callbacks. */
  abstract readonly verifiesWebhooks: boolean;

  abstract createIntent(request: PaymentIntentRequest): Promise<PaymentIntentResult>;

  abstract verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean;

  abstract normaliseWebhook(payload: unknown): NormalisedWebhook;
}

/* ------------------------------------------------------------------ */
/* Manual collection                                                   */
/* ------------------------------------------------------------------ */

/**
 * Counter collection recorded by finance staff.
 *
 * This is the Phase 1 reality and it is NOT a mock: financiers are invoiced on
 * terms and settle by bank transfer, cheque or UPI, and a member of staff
 * records the receipt with its reference. There is no gateway involved, so
 * `authoritative` is true — a human with the remittance advice in front of
 * them is the authority.
 *
 * It accepts no webhooks at all, which is why both webhook methods refuse
 * rather than returning a permissive default.
 */
@Injectable()
export class ManualPaymentProvider extends PaymentProvider {
  readonly name = 'manual';
  readonly configured = true;
  readonly authoritative = true;
  readonly verifiesWebhooks = false;

  async createIntent(request: PaymentIntentRequest): Promise<PaymentIntentResult> {
    // Settled at the point of recording: the money has already arrived.
    return {
      provider: this.name,
      providerOrderId: null,
      providerTransactionId: request.idempotencyKey,
      redirectUrl: null,
      outcome: 'SUCCESS',
    };
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  normaliseWebhook(): NormalisedWebhook {
    throw new AppException(
      ErrorCode.PAYMENT_PROVIDER_NOT_CONFIGURED,
      'The manual payment provider does not accept webhooks.',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Development gateway simulator                                       */
/* ------------------------------------------------------------------ */

/**
 * Simulated gateway for development.
 *
 * It exists so the asynchronous, webhook-driven path — the one that is easy to
 * get dangerously wrong — can be exercised without a real gateway account. It
 * behaves like a real one in the ways that matter:
 *
 *   - `createIntent` returns PENDING and never SUCCESS. A payment becomes
 *     successful only via a callback, never because a request returned 200.
 *   - Callbacks are HMAC-signed and verified in constant time.
 *   - `authoritative` is false, and `productionSafetyChecks()` refuses to boot
 *     production with this provider selected.
 */
@Injectable()
export class MockGatewayPaymentProvider extends PaymentProvider {
  readonly name = 'mock-gateway';
  readonly authoritative = false;
  readonly verifiesWebhooks = true;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  get configured(): boolean {
    // A signing secret is required even for the simulator, so the signed-webhook
    // path is genuinely exercised rather than skipped in development.
    return this.config.payment.webhookSecret.length > 0;
  }

  // The simulator does not use the request: it never contacts a gateway and
  // never decides an outcome. The amount is re-read from the invoice when the
  // signed webhook arrives, which is the only authoritative moment.
  async createIntent(_request: PaymentIntentRequest): Promise<PaymentIntentResult> {
    if (!this.configured) {
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_NOT_CONFIGURED,
        'PAYMENT_WEBHOOK_SECRET must be set to use the gateway simulator.',
      );
    }

    const orderId = `mockord_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const base = this.config.payment.callbackBaseUrl || 'http://localhost:3000';

    return {
      provider: this.name,
      providerOrderId: orderId,
      providerTransactionId: null,
      redirectUrl: `${base}/simulated-checkout/${orderId}`,
      // Never SUCCESS here. The money has not moved.
      outcome: 'PENDING',
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature || !this.configured) return false;
    const expected = createHmac('sha256', this.config.payment.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  normaliseWebhook(payload: unknown): NormalisedWebhook {
    if (!payload || typeof payload !== 'object') {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'The webhook payload was not an object.');
    }
    const data = payload as Record<string, unknown>;

    const providerEventId = readString(data, 'eventId', 'event_id', 'id');
    if (!providerEventId) {
      // Without an event id a duplicate delivery cannot be detected, which is
      // the whole point of storing callbacks. Refuse it.
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'The webhook payload carried no event id, so it cannot be de-duplicated.',
      );
    }

    const status = (readString(data, 'status', 'event', 'state') ?? '').toUpperCase();

    return {
      providerEventId,
      eventType: status || 'UNKNOWN',
      providerOrderId: readString(data, 'orderId', 'order_id'),
      providerTransactionId: readString(data, 'transactionId', 'transaction_id', 'paymentId'),
      idempotencyKey: readString(data, 'idempotencyKey', 'idempotency_key'),
      amount: readString(data, 'amount'),
      currency: readString(data, 'currency'),
      outcome:
        status.includes('SUCCESS') || status.includes('CAPTURED') || status.includes('PAID')
          ? 'SUCCESS'
          : status.includes('FAIL') || status.includes('DECLINE')
            ? 'FAILED'
            : status.includes('REFUND')
              ? 'REFUNDED'
              : status.includes('PENDING') || status.includes('AUTHORIZED')
                ? 'PENDING'
                : 'UNKNOWN',
      failureReason: readString(data, 'failureReason', 'failure_reason', 'errorDescription'),
    };
  }

  /** Test helper: produces the signature the simulator would send. */
  signForTesting(rawBody: string): string {
    return createHmac('sha256', this.config.payment.webhookSecret).update(rawBody).digest('hex');
  }
}

function readString(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

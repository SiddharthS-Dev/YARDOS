import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Ambient per-request state, carried through the whole call stack - including
 * across `await` boundaries and into background handlers - without threading a
 * context parameter through every method signature.
 *
 * This is what makes end-to-end tracing work: one correlation id flows from the
 * ANPR webhook, through vehicle resolution, the registry lookup, contract
 * matching, the charge engine and into the invoice, and appears on every log
 * line and audit row along the way (requirement S38).
 *
 * It is also how the audit writer knows who the actor was without every service
 * accepting a `currentUser` argument.
 */
export interface RequestContext {
  correlationId: string;
  requestId: string;
  /** Present for authenticated HTTP requests; absent for jobs and webhooks. */
  userId?: string;
  userLabel?: string;
  userRoles?: string[];
  organizationId?: string;
  /** Set for financier-portal users; forces financier scoping on every read. */
  financierId?: string | null;
  ipAddress?: string;
  userAgent?: string;
  /** 'USER' | 'SYSTEM' | 'DEVICE' | 'INTEGRATION' */
  actorType: 'USER' | 'SYSTEM' | 'DEVICE' | 'INTEGRATION';
  /** Name of the background job, when running outside a request. */
  jobName?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Fallback used when code runs with no established context (a unit test, or a
 * startup task). A fresh correlation id keeps log lines linkable rather than
 * silently blank.
 */
function anonymousContext(): RequestContext {
  return {
    correlationId: randomUUID(),
    requestId: randomUUID(),
    actorType: 'SYSTEM',
    startedAt: Date.now(),
  };
}

export const RequestContextStore = {
  /** Runs `fn` with `context` bound for the duration, including async work. */
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  /** The active context, or a fresh anonymous one. Never throws. */
  get(): RequestContext {
    return storage.getStore() ?? anonymousContext();
  },

  /** The active context, or undefined. Use when absence is meaningful. */
  peek(): RequestContext | undefined {
    return storage.getStore();
  },

  correlationId(): string {
    return storage.getStore()?.correlationId ?? 'no-correlation-id';
  },

  /**
   * Mutates the active context. Used by the auth guard once the principal is
   * known, so log lines emitted after authentication carry the user.
   */
  patch(patch: Partial<RequestContext>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, patch);
  },

  /** Builds a context for a background job. */
  forJob(jobName: string, correlationId?: string): RequestContext {
    return {
      correlationId: correlationId ?? randomUUID(),
      requestId: randomUUID(),
      actorType: 'SYSTEM',
      userLabel: `job:${jobName}`,
      jobName,
      startedAt: Date.now(),
    };
  },
};

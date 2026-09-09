import type { ApiErrorBody, LoginResponse, Paginated } from '@smartpark/contracts';

/**
 * The single HTTP client for the console.
 *
 * Responsibilities, all of them deliberately centralised so no component has
 * to think about them:
 *
 *   - attaches the bearer token
 *   - refreshes a token ONCE on a 401 and replays the request, so a user does
 *     not get bounced to sign-in mid-task every fifteen minutes
 *   - turns the API's error envelope into a typed `ApiError` carrying the
 *     stable `code`, so screens can branch on the code rather than parsing
 *     message text
 *   - surfaces the correlation id, so a user reporting a problem can quote it
 *
 * Tokens live in memory plus `sessionStorage`, not `localStorage`: a shared
 * gate terminal should not keep a session alive after the tab closes.
 */

const BASE_URL =
  process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000/api/v1';

const ACCESS_KEY = 'yardos.access';
const REFRESH_KEY = 'yardos.refresh';

/** A failed API call, carrying the server's stable error code. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly correlationId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the user could plausibly fix this themselves. */
  get isUserActionable(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/* ------------------------------------------------------------------ */
/* Token storage                                                       */
/* ------------------------------------------------------------------ */

let accessToken: string | null = null;
let refreshToken: string | null = null;

export const tokenStore = {
  load(): void {
    if (typeof window === 'undefined') return;
    accessToken = window.sessionStorage.getItem(ACCESS_KEY);
    refreshToken = window.sessionStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    accessToken = access;
    refreshToken = refresh;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ACCESS_KEY, access);
      window.sessionStorage.setItem(REFRESH_KEY, refresh);
    }
  },
  clear(): void {
    accessToken = null;
    refreshToken = null;
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(ACCESS_KEY);
      window.sessionStorage.removeItem(REFRESH_KEY);
    }
  },
  get access(): string | null {
    if (accessToken === null && typeof window !== 'undefined') tokenStore.load();
    return accessToken;
  },
  get refresh(): string | null {
    if (refreshToken === null && typeof window !== 'undefined') tokenStore.load();
    return refreshToken;
  },
};

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Suppresses the refresh-and-retry, used by the refresh call itself. */
  skipRefresh?: boolean;
  signal?: AbortSignal;
}

/**
 * A single in-flight refresh, shared by every request that hits a 401 at once.
 * Without this, a dashboard firing six parallel queries would attempt six
 * refreshes, and token rotation would treat five of them as reuse and revoke
 * the whole family.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const token = tokenStore.refresh;
  if (!token) return false;

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    });
    if (!response.ok) {
      tokenStore.clear();
      return false;
    }
    const data = (await response.json()) as LoginResponse;
    tokenStore.set(data.accessToken, data.refreshToken);
    return true;
  } catch {
    tokenStore.clear();
    return false;
  }
}

async function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = tokenStore.access;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection.',
      0,
    );
  }

  // One refresh attempt, then replay. A second 401 means the session is
  // genuinely over.
  if (response.status === 401 && !options.skipRefresh) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      response = await send();
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeJson(text) : null;

  if (!response.ok) {
    const body = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      body.code ?? 'UNKNOWN_ERROR',
      body.message ?? `Request failed with status ${response.status}.`,
      response.status,
      body.correlationId,
      body.details,
    );
  }

  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Convenience wrappers                                                */
/* ------------------------------------------------------------------ */

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** Builds a query string, omitting empty values so URLs stay readable. */
export function qs(params: Record<string, string | number | boolean | string[] | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : '';
}

export type { Paginated };

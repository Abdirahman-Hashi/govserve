import { type z } from 'zod';
import { getAccessToken, refreshSession } from '../auth/session-store';

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from a 422 response, keyed by field path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as Partial<FieldError>[]) {
      if (typeof d.path === 'string' && typeof d.message === 'string') out[d.path] ??= d.message;
    }
    return out;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

export interface RequestOptions<S extends z.ZodType | undefined> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: S;
  allowStatuses?: number[];
  signal?: AbortSignal;
}

type Result<S> = S extends z.ZodType ? z.infer<S> : undefined;

/**
 * Calls the API (same origin; Vite proxies in dev), attaching the in-memory access token.
 * On 401 it refreshes once and retries. Responses are validated with the shared Zod schema,
 * so the client never trusts an unexpected shape.
 */
export async function api<S extends z.ZodType | undefined = undefined>(
  path: string,
  opts: RequestOptions<S> = {},
): Promise<Result<S>> {
  const send = () => {
    const token = getAccessToken();
    return fetch(path, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      credentials: 'include',
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
      signal: opts.signal ?? null,
    });
  };

  let res = await send();
  if (res.status === 401 && getAccessToken() && !path.startsWith('/api/v1/auth/')) {
    if (await refreshSession()) res = await send();
  }

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok && !opts.allowStatuses?.includes(res.status)) {
    const err = (body as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText,
      err?.details,
      err?.requestId,
    );
  }
  return (opts.schema ? opts.schema.parse(body) : undefined) as Result<S>;
}

/** GET helper kept for simple reads. */
export function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  opts: Omit<RequestOptions<S>, 'schema' | 'method' | 'body'> = {},
): Promise<z.infer<S>> {
  return api(path, { ...opts, schema }) as Promise<z.infer<S>>;
}

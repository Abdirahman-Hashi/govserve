import { type z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; requestId?: string };
}

/**
 * Fetches JSON from the API (same origin; Vite proxies in dev) and validates it
 * with the shared Zod schema, so the client never trusts an unexpected shape.
 */
export async function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  opts: { allowStatuses?: number[]; signal?: AbortSignal } = {},
): Promise<z.infer<S>> {
  const res = await fetch(path, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal: opts.signal ?? null,
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok && !opts.allowStatuses?.includes(res.status)) {
    const err = (body as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText,
      err?.requestId,
    );
  }
  return schema.parse(body);
}

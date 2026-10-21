import { AuthSessionSchema, type AuthSession, type SessionUser } from '@govserve/shared';

/**
 * In-memory session (ADR-0003): the access token never touches localStorage. The refresh
 * token lives in an httpOnly cookie the browser sends only to /api/v1/auth.
 */
type Listener = (user: SessionUser | null) => void;

let accessToken: string | null = null;
let user: SessionUser | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function getUser(): SessionUser | null {
  return user;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSession(session: AuthSession): void {
  accessToken = session.accessToken;
  user = session.user;
  clearTimeout(refreshTimer);
  // Refresh a minute before the access token expires.
  refreshTimer = setTimeout(
    () => void refreshSession(),
    Math.max(10, session.expiresIn - 60) * 1000,
  );
  listeners.forEach((l) => l(user));
}

export function clearSession(): void {
  accessToken = null;
  user = null;
  clearTimeout(refreshTimer);
  listeners.forEach((l) => l(null));
}

/**
 * Exchanges the refresh cookie for a new session. Concurrent callers share one request:
 * two parallel refreshes would present the same token twice, which the API treats as theft.
 */
const MAX_THROTTLE_RETRIES = 2;

/** The server's Retry-After (seconds), kept between 1 and 30 s. */
function retryDelayMs(res: Response): number {
  const seconds = Number.parseInt(res.headers.get('Retry-After') ?? '', 10);
  return Math.min(30, Math.max(1, Number.isFinite(seconds) ? seconds : 2)) * 1000;
}

export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      let res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      // A rate-limited refresh was refused before the token was used, so it is safe to try again;
      // other failures are not retried (the token may already have rotated).
      for (let retry = 0; res.status === 429 && retry < MAX_THROTTLE_RETRIES; retry += 1) {
        await new Promise((done) => setTimeout(done, retryDelayMs(res)));
        res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      }
      if (!res.ok) {
        clearSession();
        return false;
      }
      setSession(AuthSessionSchema.parse(await res.json()));
      return true;
    } catch {
      clearSession();
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

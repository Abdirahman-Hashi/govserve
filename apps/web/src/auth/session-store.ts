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
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
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

import { ROLE_HOME, type Role } from '@govserve/shared';
import { type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { t } from '../strings';
import { useAuth } from './AuthProvider';

/**
 * UI-only guard: hides pages from the wrong roles. The API enforces every permission
 * server-side; this is not security (CLAUDE.md).
 */
export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <p role="status">{t.loading}</p>;
  if (auth.status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!roles.includes(auth.user.role)) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t.forbidden.heading}</h1>
        <p>{t.forbidden.body}</p>
        <Link to={ROLE_HOME[auth.user.role]} className="text-brand underline">
          {t.forbidden.home}
        </Link>
      </div>
    );
  }
  return children;
}

/** Signed-in users skip the sign-in and registration pages. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'authenticated') return <Navigate to={ROLE_HOME[auth.user.role]} replace />;
  return children;
}

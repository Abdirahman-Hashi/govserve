import { type Role } from '@govserve/shared';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout } from '../api/auth';
import { useAuth } from '../auth/AuthProvider';
import { t } from '../strings';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

/** Citizen and staff get different navigation (separate layouts per role group). */
function navFor(role: Role | null): NavItem[] {
  switch (role) {
    case 'CITIZEN':
      return [
        { to: '/citizen', label: t.nav.citizen, end: true },
        { to: '/citizen/certificates', label: t.nav.certificates },
        { to: '/services', label: t.nav.services },
        { to: '/account/profile', label: t.nav.profile },
      ];
    case 'OFFICER':
    case 'SUPERVISOR':
      return [
        { to: '/officer', label: t.nav.officer, end: true },
        { to: '/officer/payments', label: t.nav.payments },
        { to: '/officer/cash', label: t.nav.cashDesk },
        ...(role === 'SUPERVISOR' ? [{ to: '/officer/refunds', label: t.nav.refunds }] : []),
        { to: '/account/profile', label: t.nav.profile },
      ];
    case 'ADMIN':
      return [
        { to: '/admin', label: t.nav.admin, end: true },
        { to: '/admin/staff', label: t.nav.staff },
        { to: '/admin/services', label: t.nav.catalogueAdmin },
        { to: '/admin/config', label: t.nav.configuration },
        { to: '/account/profile', label: t.nav.profile },
      ];
    default:
      return [
        { to: '/', label: t.nav.home, end: true },
        { to: '/services', label: t.nav.services },
        { to: '/login', label: t.nav.signIn },
        { to: '/register', label: t.nav.register },
      ];
  }
}

export function Layout() {
  const auth = useAuth();
  const logout = useLogout();
  const navigate = useNavigate();
  const role = auth.status === 'authenticated' ? auth.user.role : null;
  const isStaff = role !== null && role !== 'CITIZEN';

  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {t.skipToContent}
      </a>
      <header className={isStaff ? 'bg-slate-800 text-white' : 'bg-brand text-white'}>
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-lg font-bold">{t.appName}</p>
            <p className="text-sm text-blue-100">
              {isStaff && role ? `${t.roles[role]} · ` : ''}
              {t.tagline}
            </p>
          </div>
          {auth.status === 'authenticated' && (
            <button
              type="button"
              onClick={() => logout.mutate(undefined, { onSettled: () => void navigate('/login') })}
              className="shrink-0 rounded border border-white/60 px-3 py-1 text-sm hover:bg-white/10"
            >
              {t.nav.signOut}
            </button>
          )}
        </div>
        <nav aria-label={t.nav.main} className="mx-auto max-w-5xl overflow-x-auto px-2 pb-2">
          <ul className="flex gap-1 text-sm">
            {navFor(role).map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.end ?? false}
                  className={({ isActive }) =>
                    `block whitespace-nowrap rounded px-3 py-2 ${isActive ? 'bg-black/25 font-semibold underline' : 'hover:bg-black/20'}`
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

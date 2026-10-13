import { NavLink, Outlet } from 'react-router';
import { t } from '../strings';

const links = [
  { to: '/', label: t.nav.home, end: true },
  { to: '/citizen', label: t.nav.citizen, end: false },
  { to: '/officer', label: t.nav.officer, end: false },
  { to: '/admin', label: t.nav.admin, end: false },
];

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {t.skipToContent}
      </a>
      <header className="bg-brand text-white">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <p className="text-lg font-bold">{t.appName}</p>
          <p className="text-sm text-blue-100">{t.tagline}</p>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-5xl overflow-x-auto px-2 pb-2">
          <ul className="flex gap-1 text-sm">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    `block whitespace-nowrap rounded px-3 py-2 ${isActive ? 'bg-brand-dark font-semibold underline' : 'hover:bg-brand-dark'}`
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

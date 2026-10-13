import { Outlet, createBrowserRouter, type RouteObject } from 'react-router';
import { RedirectIfSignedIn, RequireRole } from './auth/guards';
import { Layout } from './components/Layout';
import { HomePage } from './routes/HomePage';
import { NotFoundPage } from './routes/NotFoundPage';

// Every page except the home page loads on demand to keep the initial bundle small (NFR-005).
const page = (load: () => Promise<{ Component: React.ComponentType }>) => ({ lazy: load });

const guestOnly = {
  element: (
    <RedirectIfSignedIn>
      <Outlet />
    </RedirectIfSignedIn>
  ),
};

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      {
        ...guestOnly,
        children: [
          {
            path: 'register',
            ...page(() =>
              import('./routes/auth/RegisterPage').then((m) => ({ Component: m.RegisterPage })),
            ),
          },
          {
            path: 'login',
            ...page(() =>
              import('./routes/auth/LoginPage').then((m) => ({ Component: m.LoginPage })),
            ),
          },
        ],
      },
      {
        path: 'verify',
        ...page(() =>
          import('./routes/auth/VerifyEmailPage').then((m) => ({ Component: m.VerifyEmailPage })),
        ),
      },
      {
        path: 'forgot-password',
        ...page(() =>
          import('./routes/auth/ForgotPasswordPage').then((m) => ({
            Component: m.ForgotPasswordPage,
          })),
        ),
      },
      {
        path: 'reset-password',
        ...page(() =>
          import('./routes/auth/ResetPasswordPage').then((m) => ({
            Component: m.ResetPasswordPage,
          })),
        ),
      },
      {
        path: 'invitation',
        ...page(() =>
          import('./routes/auth/AcceptInvitationPage').then((m) => ({
            Component: m.AcceptInvitationPage,
          })),
        ),
      },
      {
        path: 'account',
        element: (
          <RequireRole roles={['CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN']}>
            <Outlet />
          </RequireRole>
        ),
        children: [
          {
            path: 'profile',
            ...page(() =>
              import('./routes/account/ProfilePage').then((m) => ({ Component: m.ProfilePage })),
            ),
          },
        ],
      },
      {
        path: 'citizen',
        element: (
          <RequireRole roles={['CITIZEN']}>
            <Outlet />
          </RequireRole>
        ),
        children: [
          {
            index: true,
            ...page(() =>
              import('./routes/citizen/CitizenHome').then((m) => ({ Component: m.CitizenHome })),
            ),
          },
        ],
      },
      {
        path: 'officer',
        element: (
          <RequireRole roles={['OFFICER', 'SUPERVISOR']}>
            <Outlet />
          </RequireRole>
        ),
        children: [
          {
            index: true,
            ...page(() =>
              import('./routes/officer/OfficerHome').then((m) => ({ Component: m.OfficerHome })),
            ),
          },
        ],
      },
      {
        path: 'admin',
        element: (
          <RequireRole roles={['ADMIN']}>
            <Outlet />
          </RequireRole>
        ),
        children: [
          {
            index: true,
            ...page(() =>
              import('./routes/admin/AdminHome').then((m) => ({ Component: m.AdminHome })),
            ),
          },
          {
            path: 'staff',
            ...page(() =>
              import('./routes/admin/StaffPage').then((m) => ({ Component: m.StaffPage })),
            ),
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

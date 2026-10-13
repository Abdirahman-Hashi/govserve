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
        path: 'services',
        ...page(() =>
          import('./routes/catalogue/CataloguePage').then((m) => ({ Component: m.CataloguePage })),
        ),
      },
      {
        path: 'services/:code',
        ...page(() =>
          import('./routes/catalogue/ServiceDetailPage').then((m) => ({
            Component: m.ServiceDetailPage,
          })),
        ),
      },
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
          {
            path: 'applications/:id',
            ...page(() =>
              import('./routes/citizen/ApplicationPage').then((m) => ({
                Component: m.ApplicationPage,
              })),
            ),
          },
          {
            path: 'certificates',
            ...page(() =>
              import('./routes/citizen/CertificatesPage').then((m) => ({
                Component: m.CertificatesPage,
              })),
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
          {
            path: 'review/:id',
            ...page(() =>
              import('./routes/officer/ReviewPage').then((m) => ({ Component: m.ReviewPage })),
            ),
          },
          {
            path: 'payments',
            ...page(() =>
              import('./routes/officer/PaymentsQueuePage').then((m) => ({
                Component: m.PaymentsQueuePage,
              })),
            ),
          },
          {
            path: 'payments/:id',
            ...page(() =>
              import('./routes/officer/PaymentReviewPage').then((m) => ({
                Component: m.PaymentReviewPage,
              })),
            ),
          },
          {
            path: 'cash',
            ...page(() =>
              import('./routes/officer/CashDeskPage').then((m) => ({ Component: m.CashDeskPage })),
            ),
          },
          {
            path: 'refunds',
            element: (
              <RequireRole roles={['SUPERVISOR']}>
                <Outlet />
              </RequireRole>
            ),
            children: [
              {
                index: true,
                ...page(() =>
                  import('./routes/officer/RefundsPage').then((m) => ({
                    Component: m.RefundsPage,
                  })),
                ),
              },
            ],
          },
        ],
      },
      {
        path: 'verify/r/:receiptNo',
        ...page(() =>
          import('./routes/verify/VerifyReceiptPage').then((m) => ({
            Component: m.VerifyReceiptPage,
          })),
        ),
      },
      {
        path: 'verify/c/:certificateNo',
        ...page(() =>
          import('./routes/verify/VerifyCertificatePage').then((m) => ({
            Component: m.VerifyCertificatePage,
          })),
        ),
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
          {
            path: 'services',
            ...page(() =>
              import('./routes/admin/AdminServicesPage').then((m) => ({
                Component: m.AdminServicesPage,
              })),
            ),
          },
          {
            path: 'services/:id',
            ...page(() =>
              import('./routes/admin/AdminServicePage').then((m) => ({
                Component: m.AdminServicePage,
              })),
            ),
          },
          {
            path: 'versions/:id',
            ...page(() =>
              import('./routes/admin/VersionEditorPage').then((m) => ({
                Component: m.VersionEditorPage,
              })),
            ),
          },
          {
            path: 'config',
            ...page(() =>
              import('./routes/admin/ConfigPage').then((m) => ({ Component: m.ConfigPage })),
            ),
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

import { createBrowserRouter, type RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { AdminHome } from './routes/admin/AdminHome';
import { CitizenHome } from './routes/citizen/CitizenHome';
import { HomePage } from './routes/HomePage';
import { NotFoundPage } from './routes/NotFoundPage';
import { OfficerHome } from './routes/officer/OfficerHome';

// Role guards and separate citizen/officer layouts arrive with auth in Phase 02.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'citizen', element: <CitizenHome /> },
      { path: 'officer', element: <OfficerHome /> },
      { path: 'admin', element: <AdminHome /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

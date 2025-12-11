import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '../features/auth/ProtectedRoute'
import { LoginPage } from '../pages/Login'
import { TopicDetailPage } from '../pages/TopicDetail'
import { TopicsPage } from '../pages/Topics'
import { AppShell } from '../components/layout/AppShell'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/topics" replace /> },
      { path: 'topics', element: <TopicsPage /> },
      { path: 'topics/:topicId', element: <TopicDetailPage /> },
      { path: '*', element: <Navigate to="/topics" replace /> },
    ],
  },
  {
    path: '*',
    element: <Outlet />,
  },
])


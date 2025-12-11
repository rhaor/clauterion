import { lazy } from 'react'
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '../features/auth/ProtectedRoute'
import { AppShell } from '../components/layout/AppShell'

// Lazy load pages for code splitting
const LoginPage = lazy(() => import('../pages/Login').then(m => ({ default: m.LoginPage })))
const TopicDetailPage = lazy(() => import('../pages/TopicDetail').then(m => ({ default: m.TopicDetailPage })))
const TopicsPage = lazy(() => import('../pages/Topics').then(m => ({ default: m.TopicsPage })))
const CriteriaPage = lazy(() => import('../pages/Criteria').then(m => ({ default: m.CriteriaPage })))

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
      { path: 'criteria', element: <CriteriaPage /> },
      { path: '*', element: <Navigate to="/topics" replace /> },
    ],
  },
  {
    path: '*',
    element: <Outlet />,
  },
])


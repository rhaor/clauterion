import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useAuth } from '../../features/auth/AuthProvider'

export function AppShell() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xl font-semibold text-brand-DEFAULT">
              Clauterion
            </span>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <NavLink
                to="/topics"
                end
                className={({ isActive }) =>
                  [
                    'rounded border border-slate-200 px-3 py-2 text-sm font-medium transition hover:text-slate-700 hover:bg-sand-50',
                    isActive ? 'text-brand-dark' : 'text-slate-700',
                  ].join(' ')
                }
              >
                Topics
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-slate-800">
                {user?.email ?? 'Signed in'}
              </span>
              <span className="text-xs text-slate-500">Prototype</span>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-sand-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}


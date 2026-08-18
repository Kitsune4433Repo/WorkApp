import { NavLink } from 'react-router-dom';
import { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const NAV = [
  { to: '/', label: 'Job Board' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/out-of-inventory', label: 'Out Of Inventory' },
  { to: '/timecards', label: 'Timecards' },
  { to: '/chat', label: 'Chat' },
  { to: '/uploads', label: 'Resources' },
];

const CONFLICT_REVIEW_ROLES = ['admin', 'dispatcher'];
const PAYROLL_VIEW_ROLES = ['admin', 'dispatcher', 'crew_lead'];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const canReviewConflicts = !!user && CONFLICT_REVIEW_ROLES.includes(user.role);
  const canViewPayroll = !!user && PAYROLL_VIEW_ROLES.includes(user.role);

  const { data: pendingConflicts } = useQuery<unknown[]>({
    queryKey: ['sync-conflicts'],
    queryFn: async () => (await api.get('/sync/conflicts')).data,
    enabled: canReviewConflicts,
    refetchInterval: 30_000,
  });

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white p-4 md:h-screen md:w-56 md:border-b-0 md:border-r">
        <div className="mb-4 flex items-center justify-between md:mb-6">
          <div className="text-lg font-bold text-brand-700">Crew Hub</div>
          <button onClick={logout} className="text-sm text-brand-600 hover:underline md:hidden">
            Sign out
          </button>
        </div>
        <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {canViewPayroll && (
            <NavLink
              to="/payroll"
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              Payroll
            </NavLink>
          )}
          {canReviewConflicts && (
            <NavLink
              to="/conflicts"
              className={({ isActive }) =>
                `flex items-center justify-between whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <span>Conflicts</span>
              {!!pendingConflicts?.length && (
                <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {pendingConflicts.length}
                </span>
              )}
            </NavLink>
          )}
          {user?.role === 'admin' && (
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              Users
            </NavLink>
          )}
        </nav>
        <div className="mt-auto hidden pt-6 text-xs text-slate-500 md:block">
          <div className="font-medium text-slate-700">{user?.fullName}</div>
          <div>{user?.role}</div>
          <button onClick={logout} className="mt-2 text-brand-600 hover:underline">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}

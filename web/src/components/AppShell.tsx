import { NavLink } from 'react-router-dom';
import { ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

interface NavItem {
  to: string;
  label: string;
  badge?: number;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const CONFLICT_REVIEW_ROLES = ['admin', 'crew_lead'];
const PAYROLL_VIEW_ROLES = ['admin', 'crew_lead'];

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      <span>{item.label}</span>
      {!!item.badge && (
        <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">{item.badge}</span>
      )}
    </NavLink>
  );
}

function NavSections({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.label}>
          <div className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{section.label}</div>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => (
              <NavItemLink key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Lock background scroll while the mobile drawer is open, so the page underneath can't move
  // (and repaint stale) behind the fixed overlay.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const canReviewConflicts = !!user && CONFLICT_REVIEW_ROLES.includes(user.role);
  const canViewPayroll = !!user && PAYROLL_VIEW_ROLES.includes(user.role);

  const { data: pendingConflicts } = useQuery<unknown[]>({
    queryKey: ['sync-conflicts'],
    queryFn: async () => (await api.get('/sync/conflicts')).data,
    enabled: canReviewConflicts,
    refetchInterval: 30_000,
  });

  const sections: NavSection[] = [
    {
      label: 'Operations',
      items: [
        { to: '/', label: 'Job Board' },
        { to: '/timecards', label: 'Timecards' },
        { to: '/chat', label: 'Chat' },
      ],
    },
    {
      label: 'Materials',
      items: [
        { to: '/inventory', label: 'Inventory' },
        { to: '/out-of-inventory', label: 'Out Of Inventory' },
      ],
    },
    {
      label: 'Resources',
      items: [{ to: '/uploads', label: 'Resources' }],
    },
  ];

  if (canViewPayroll || canReviewConflicts || user?.role === 'admin') {
    sections.push({
      label: 'Admin',
      items: [
        ...(canViewPayroll ? [{ to: '/payroll', label: 'Payroll' }] : []),
        ...(canReviewConflicts ? [{ to: '/conflicts', label: 'Conflicts', badge: pendingConflicts?.length }] : []),
        ...(user?.role === 'admin' ? [{ to: '/users', label: 'Users' }] : []),
      ],
    });
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile top bar: title + hamburger, replaces the old horizontal-scroll nav strip */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4 md:hidden">
        <div className="text-lg font-bold text-brand-700">Crew Hub</div>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Mobile menu drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-bold text-brand-700">Crew Hub</div>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <NavSections sections={sections} onNavigate={() => setMenuOpen(false)} />
            <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">
              <div className="font-medium text-slate-700">{user?.fullName}</div>
              <div>{user?.role}</div>
              <button onClick={logout} className="mt-2 text-brand-600 hover:underline">
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex md:h-screen md:w-60 md:overflow-y-auto">
        <div className="mb-6 text-lg font-bold text-brand-700">Crew Hub</div>
        <NavSections sections={sections} />
        <div className="mt-auto pt-6 text-xs text-slate-500">
          <div className="font-medium text-slate-700">{user?.fullName}</div>
          <div>{user?.role}</div>
          <button onClick={logout} className="mt-2 text-brand-600 hover:underline">
            Sign out
          </button>
        </div>
      </aside>

      {/* relative + z-0 contains descendants' z-index (e.g. Leaflet's map panes, which use z-index up
          to 700 internally) inside this stacking context, so they can never paint above the z-50
          mobile drawer/backdrop even though 700 > 50 in absolute terms. */}
      <main className="relative z-0 flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}

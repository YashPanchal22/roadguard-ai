import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileDown,
  LayoutDashboard,
  LogIn,
  LogOut,
  Map as MapIcon,
  Menu,
  Moon,
  ScanSearch,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  TriangleAlert,
  User as UserIcon,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth, useTheme } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { metaApi } from '../services/endpoints';
import { Badge } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  restricted?: boolean;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Monitoring',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/report', label: 'Report damage', icon: TriangleAlert },
      { to: '/detection', label: 'AI detection', icon: ScanSearch },
      { to: '/map', label: 'Damage map', icon: MapIcon },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/reports', label: 'All reports', icon: Activity },
      { to: '/repairs', label: 'Repair management', icon: Wrench },
    ],
  },
  {
    title: 'Insight',
    items: [
      { to: '/analytics', label: 'Data analytics', icon: BarChart3 },
      { to: '/model', label: 'Model performance', icon: Cpu },
      { to: '/exports', label: 'Reports & exports', icon: FileDown },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

export function AppLayout() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout, canReview } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('roadguard.sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const health = useAsync(() => metaApi.health(), []);

  useEffect(() => {
    localStorage.setItem('roadguard.sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const currentTitle =
    NAV_SECTIONS.flatMap((section) => section.items).find((item) =>
      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
    )?.label ?? 'RoadGuard AI';

  const sidebarWidth = collapsed ? 'lg:w-[74px]' : 'lg:w-[248px]';

  return (
    <div className="flex min-h-screen bg-ink-50 dark:bg-ink-950">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-ink-200 bg-white transition-transform duration-200 dark:border-ink-800 dark:bg-ink-900 ${sidebarWidth} ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-ink-100 px-4 dark:border-ink-800">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-900 text-ember-500 dark:bg-ink-800">
            <ShieldCheck className="h-5 w-5" />
          </span>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-ink-900 dark:text-white">RoadGuard AI</p>
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Road damage intelligence
              </p>
            </div>
          ) : null}
          <button
            type="button"
            className="ml-auto rounded-md p-1 text-ink-500 hover:bg-ink-100 lg:hidden dark:hover:bg-ink-800"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              {!collapsed ? (
                <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">
                  {section.title}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
                            isActive
                              ? 'bg-ember-50 text-ember-700 dark:bg-ember-950/60 dark:text-ember-300'
                              : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                          } ${collapsed ? 'justify-center' : ''}`
                        }
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                        {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-ink-100 p-2.5 dark:border-ink-800">
          <div
            className={`mb-2 rounded-lg px-2.5 py-2 text-[11px] ${
              health.data?.detector.available
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                : 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
            } ${collapsed ? 'text-center' : ''}`}
            title={
              health.data?.detector.available
                ? `Detector ready · ${health.data.detector.model_version}`
                : 'Detection model unavailable — see Model performance'
            }
          >
            {collapsed ? (
              <span className="mx-auto block h-2 w-2 rounded-full bg-current" />
            ) : health.loading ? (
              'Checking detector…'
            ) : health.error ? (
              'API unreachable'
            ) : health.data?.detector.available ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-current" /> Detector ready
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-current" /> Model unavailable
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="hidden w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-ink-500 transition hover:bg-ink-100 lg:flex dark:text-ink-400 dark:hover:bg-ink-800"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed ? 'Collapse' : null}
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-ink-950/50 lg:hidden"
          aria-label="Close navigation overlay"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Main column */}
      <div className={`flex min-h-screen w-full flex-col transition-all duration-200 ${collapsed ? 'lg:pl-[74px]' : 'lg:pl-[248px]'}`}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100 lg:hidden dark:text-ink-300 dark:hover:bg-ink-800"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{currentTitle}</p>
            <p className="hidden text-[11px] text-ink-500 dark:text-ink-400 sm:block">
              {health.data
                ? `${health.data.reports.total} reports stored · ${health.data.reports.real} real · ${health.data.reports.synthetic} demo`
                : 'Road damage detection & monitoring'}
            </p>
          </div>

          <Badge tone={canReview ? 'info' : 'neutral'} className="hidden sm:inline-flex">
            {canReview ? 'Reviewer access' : user ? 'Citizen access' : 'Public view'}
          </Badge>

          <a
            href="https://github.com/YashPanchal22/roadguard-ai"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-ink-200 p-2 text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white"
            aria-label="GitHub Repository by Yash Panchal"
            title="GitHub: YashPanchal22/roadguard-ai"
          >
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
          </a>

          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg border border-ink-200 p-2 text-ink-600 transition hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-semibold text-ink-900 dark:text-white">{user.name}</p>
                <p className="text-[10px] uppercase tracking-wide text-ink-400">{user.role}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-ink-200 p-2 text-ink-600 transition hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <NavLink
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink-800 dark:bg-ink-100 dark:text-ink-900 dark:hover:bg-white"
            >
              <LogIn className="h-3.5 w-3.5" /> Sign in
            </NavLink>
          )}
        </header>

        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>

        <footer className="border-t border-ink-200 px-4 py-3 text-[11px] text-ink-500 dark:border-ink-800 dark:text-ink-400 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              RoadGuard AI · Developed by{' '}
              <a
                href="https://github.com/YashPanchal"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ember-600 underline-offset-2 hover:underline dark:text-ember-400"
              >
                Yash Panchal
              </a>{' '}
              · AI output is advisory — human verification is required before maintenance decisions.
            </span>
            <span className="inline-flex items-center gap-1">
              <UserIcon className="h-3 w-3" /> {user ? user.email : 'not signed in'}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

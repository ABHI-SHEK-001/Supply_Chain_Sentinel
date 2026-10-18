import { useState, useEffect, createContext, useContext } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  LayoutDashboard,
  GitBranch,
  AlertTriangle,
  ScanLine,
  Wrench,
  Brain,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
  Menu,
  X,
  Network,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getHealth } from '../../api/health';

const SidebarContext = createContext({ collapsed: false });
export const useSidebar = () => useContext(SidebarContext);

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/repositories', icon: GitBranch, label: 'Repositories' },
  { to: '/graph', icon: Network, label: 'Dependency Graph' },
  { to: '/scan', icon: ScanLine, label: 'Scan & Pipelines' },
  { to: '/vulnerabilities', icon: AlertTriangle, label: 'Vulnerabilities' },
  { to: '/remediation', icon: Wrench, label: 'Remediation' },
  { to: '/memory', icon: Brain, label: 'Decision Memory' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

function HealthDot() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    const check = async () => {
      try {
        await getHealth();
        setStatus('online');
      } catch {
        setStatus('offline');
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  const color = status === 'online' ? 'bg-status-success' : status === 'offline' ? 'bg-status-failed' : 'bg-status-queued';
  const label = status === 'online' ? 'API Online' : status === 'offline' ? 'API Offline' : 'Checking...';

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-300">
      <span className={cn('w-2 h-2 rounded-full', color, status === 'online' && 'shadow-[0_0_6px_rgba(57,255,133,0.4)]')} />
      {label}
    </div>
  );
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <div className="flex h-screen overflow-hidden bg-ink-950">
        {/* Mobile overlay */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside
          className={cn(
            'fixed lg:relative z-50 h-full flex flex-col bg-ink-900 border-r border-ink-700/50 transition-all duration-300 ease-out',
            collapsed ? 'w-16' : 'w-60',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
        >
          {/* Logo */}
          <div className="flex items-center gap-3 px-4 h-14 border-b border-ink-700/50 shrink-0">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 shrink-0">
              <Shield className="w-4.5 h-4.5 text-accent" />
              <div className="absolute inset-0 rounded-lg bg-accent/5 animate-pulse-subtle" />
            </div>
            {!collapsed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden">
                <h1 className="text-sm font-semibold text-ink-50 tracking-tight whitespace-nowrap">
                  SupplyChain Sentinel
                </h1>
              </motion.div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                    'hover:bg-ink-700/50 hover:text-ink-50',
                    isActive
                      ? 'bg-accent/10 text-accent border border-accent/20'
                      : 'text-ink-300 border border-transparent',
                    collapsed && 'justify-center px-0',
                  )
                }
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="w-4.5 h-4.5 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </nav>

          {/* Bottom section */}
          <div className="border-t border-ink-700/50 shrink-0">
            <HealthDot />
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden lg:flex items-center justify-center w-full p-3 text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top bar */}
          <header className="flex items-center gap-3 h-14 px-4 lg:px-6 border-b border-ink-700/50 bg-ink-900/50 backdrop-blur-sm shrink-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-ink-300 hover:text-ink-50 transition-colors"
              aria-label="Open navigation"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-2 text-sm text-ink-300">
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Supply Chain Security Intelligence</span>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-ink-800 border border-ink-700/50 text-xs text-ink-300 mono">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                v1.0.0
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            <div className="p-4 lg:p-6 max-w-[1440px] mx-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

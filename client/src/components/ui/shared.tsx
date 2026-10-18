import { cn } from '../../lib/utils';
import { AlertTriangle, RefreshCw, WifiOff, Inbox } from 'lucide-react';

// ── Loading Skeleton ─────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl bg-ink-800/50 border border-ink-700/40 p-5 space-y-4 animate-fade-in">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <div className="flex gap-3">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center p-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20 ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ── Error State ──────────────────────────────
interface ErrorStateProps {
  error: Error;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({ error, onRetry, compact }: ErrorStateProps) {
  const isNetworkError = error.name === 'NetworkError';

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      compact ? 'py-6 px-4' : 'py-16 px-6',
    )}>
      <div className={cn(
        'flex items-center justify-center rounded-xl mb-4',
        compact ? 'w-10 h-10' : 'w-14 h-14',
        isNetworkError ? 'bg-severity-high/10' : 'bg-severity-critical/10',
      )}>
        {isNetworkError ? (
          <WifiOff className={cn(isNetworkError ? 'text-severity-high' : 'text-severity-critical', compact ? 'w-5 h-5' : 'w-6 h-6')} />
        ) : (
          <AlertTriangle className={cn('text-severity-critical', compact ? 'w-5 h-5' : 'w-6 h-6')} />
        )}
      </div>
      <h3 className={cn('font-semibold text-ink-100', compact ? 'text-sm' : 'text-base')}>
        {isNetworkError ? 'Connection Failed' : 'Something went wrong'}
      </h3>
      <p className={cn('text-ink-400 mt-1 max-w-md', compact ? 'text-xs' : 'text-sm')}>
        {error.message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-ink-700 hover:bg-ink-600 text-ink-100 transition-colors border border-ink-600/50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

// ── Empty State ──────────────────────────────
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-ink-800 border border-ink-700/50 mb-4">
        {icon ?? <Inbox className="w-6 h-6 text-ink-400" />}
      </div>
      <h3 className="text-base font-semibold text-ink-100">{title}</h3>
      {description && <p className="text-sm text-ink-400 mt-1 max-w-md">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Status Badge ─────────────────────────────
interface BadgeProps {
  children: React.ReactNode;
  variant?: string;
  className?: string;
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border',
      className,
    )}>
      {children}
    </span>
  );
}

// ── Page Header ──────────────────────────────
interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-50 tracking-tight truncate">{title}</h1>
          {description && <p className="text-sm text-ink-400 mt-0.5 truncate">{description}</p>}
        </div>
      </div>
      {actions && <div className="sm:ml-auto flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ── Card ─────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, hoverable, onClick }: CardProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        'rounded-xl bg-ink-800/50 border border-ink-700/40 p-5',
        hoverable && 'cursor-pointer hover:bg-ink-700/50 hover:border-ink-600/50 transition-all duration-150',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Button ───────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ...props }: ButtonProps) {
  const variants = {
    primary: 'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25 hover:border-accent/50',
    secondary: 'bg-ink-700 text-ink-100 border-ink-600/50 hover:bg-ink-600 hover:border-ink-500/50',
    ghost: 'bg-transparent text-ink-300 border-transparent hover:bg-ink-800 hover:text-ink-100',
    danger: 'bg-severity-critical/10 text-severity-critical border-severity-critical/30 hover:bg-severity-critical/20',
  };
  const sizes = {
    sm: 'px-2.5 py-1 text-xs gap-1.5',
    md: 'px-3.5 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-sm gap-2',
  };

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg border transition-all duration-150',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon}
      {children}
    </button>
  );
}

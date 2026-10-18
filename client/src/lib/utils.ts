import type { TaskStatus, PipelineStatus } from '../types/api';

export function severityColor(severity: string | null): string {
  switch (severity?.toLowerCase()) {
    case 'critical': return 'text-severity-critical';
    case 'high': return 'text-severity-high';
    case 'medium': return 'text-severity-medium';
    case 'low': return 'text-severity-low';
    default: return 'text-severity-info';
  }
}

export function severityBg(severity: string | null): string {
  switch (severity?.toLowerCase()) {
    case 'critical': return 'bg-severity-critical/15 text-severity-critical border-severity-critical/30';
    case 'high': return 'bg-severity-high/15 text-severity-high border-severity-high/30';
    case 'medium': return 'bg-severity-medium/15 text-severity-medium border-severity-medium/30';
    case 'low': return 'bg-severity-low/15 text-severity-low border-severity-low/30';
    default: return 'bg-severity-info/15 text-severity-info border-severity-info/30';
  }
}

export const severityBadge = severityBg;

export function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'succeeded': return 'text-status-success';
    case 'running': return 'text-status-running';
    case 'queued': return 'text-status-queued';
    case 'failed': return 'text-status-failed';
    case 'skipped': return 'text-status-skipped';
  }
}

export function taskStatusBg(status: TaskStatus): string {
  switch (status) {
    case 'succeeded': return 'bg-status-success/15 text-status-success border-status-success/30';
    case 'running': return 'bg-status-running/15 text-status-running border-status-running/30';
    case 'queued': return 'bg-status-queued/15 text-status-queued border-status-queued/30';
    case 'failed': return 'bg-status-failed/15 text-status-failed border-status-failed/30';
    case 'skipped': return 'bg-status-skipped/15 text-status-skipped border-status-skipped/30';
  }
}

export function pipelineStatusBg(status: PipelineStatus): string {
  switch (status) {
    case 'succeeded': return 'bg-status-success/15 text-status-success border-status-success/30';
    case 'running': return 'bg-status-running/15 text-status-running border-status-running/30';
    case 'failed': return 'bg-status-failed/15 text-status-failed border-status-failed/30';
  }
}

export function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

export const formatDate = formatTimestamp;

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelative(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return ts;
  }
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

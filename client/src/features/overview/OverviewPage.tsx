import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield,
  GitBranch,
  AlertTriangle,
  ScanLine,
  Activity,
  ArrowRight,
  Wrench,
  Brain,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  Network,
  RefreshCw,
} from 'lucide-react';
import { Card, PageHeader, ErrorState, Button, Badge } from '../../components/ui/shared';
import { cn, formatRelative, pipelineStatusBg, taskStatusColor, severityBg } from '../../lib/utils';
import { getReadiness } from '../../api/health';
import { listRepositories } from '../../api/repositories';
import { listPipelines } from '../../api/pipelines';
import { listVulnerabilities } from '../../api/vulnerabilities';
import type { ReadinessData, RepositorySummary, PipelineSummary, VulnerabilitySummary } from '../../types/api';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

export default function OverviewPage() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<ReadinessData | null>(null);
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [vulns, setVulns] = useState<VulnerabilitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, r, v] = await Promise.allSettled([
        getReadiness(),
        listRepositories(),
        listVulnerabilities(50),
      ]);
      if (h.status === 'fulfilled') setHealth(h.value);
      if (r.status === 'fulfilled') {
        setRepos(r.value);
        // Load pipelines for first repo
        if (r.value.length > 0) {
          try {
            const p = await listPipelines(r.value[0]!.id);
            setPipelines(p);
          } catch { /* ignore */ }
        }
      }
      if (v.status === 'fulfilled') setVulns(v.value);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    }
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    await new Promise((r) => setTimeout(r, 600));
    setIsRefreshing(false);
  };

  useEffect(() => { load(); }, [load]);

  if (error && !health && repos.length === 0) {
    return (
      <div>
        <PageHeader
          title="Security Overview"
          icon={<Shield className="w-5 h-5 text-accent" />}
          actions={
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin text-accent')} />}
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          }
        />
        <ErrorState error={error} onRetry={load} />
      </div>
    );
  }

  const vulnList = Array.isArray(vulns) ? vulns : [];
  const bySeverity: Record<string, number> = {};
  for (const v of vulnList) {
    const label = v.severityLabel?.toLowerCase() ?? 'unknown';
    bySeverity[label] = (bySeverity[label] ?? 0) + 1;
  }

  return (
    <div>
      <PageHeader
        title="Security Overview"
        description="AI-powered supply chain security intelligence"
        icon={<Shield className="w-5 h-5 text-accent" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<ScanLine className="w-4 h-4" />}
              onClick={() => navigate('/scan')}
            >
              Start Scan
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin text-accent')} />}
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        }
      />

      <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
        {/* Status bar */}
        <motion.div variants={item}>
          <div className="flex flex-wrap gap-3">
            <StatusCard
              icon={<Activity className="w-4 h-4" />}
              label="System Status"
              value={health?.status === 'ok' ? 'Operational' : health?.status === 'degraded' ? 'Degraded' : loading ? 'Checking...' : 'Offline'}
              color={health?.status === 'ok' ? 'text-status-success' : health?.status === 'degraded' ? 'text-severity-high' : 'text-ink-400'}
              loading={loading}
            />
            <StatusCard
              icon={<GitBranch className="w-4 h-4" />}
              label="Repositories"
              value={String(repos.length)}
              color="text-ink-50"
              loading={loading}
            />
            <StatusCard
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Known Vulnerabilities"
              value={String(vulns.length)}
              color={vulns.length > 0 ? 'text-severity-high' : 'text-status-success'}
              loading={loading}
            />
            <StatusCard
              icon={<Zap className="w-4 h-4" />}
              label="Recent Pipelines"
              value={String(pipelines.length)}
              color="text-ink-50"
              loading={loading}
            />
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Severity breakdown */}
          <motion.div variants={item} className="lg:col-span-1">
            <Card className="h-full">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-severity-high" />
                <h3 className="text-sm font-semibold text-ink-100">Severity Breakdown</h3>
              </div>
              {vulns.length === 0 && !loading ? (
                <div className="text-sm text-ink-400 py-4">
                  <CheckCircle2 className="w-5 h-5 text-status-success inline mr-2" />
                  No known vulnerabilities detected
                </div>
              ) : (
                <div className="space-y-2">
                  {['critical', 'high', 'medium', 'low'].map((sev) => {
                    const count = bySeverity[sev] ?? 0;
                    const total = vulns.length || 1;
                    return (
                      <div key={sev} className="flex items-center gap-3">
                        <Badge className={cn(severityBg(sev), 'capitalize w-16 justify-center text-[10px]')}>
                          {sev}
                        </Badge>
                        <div className="flex-1 h-1.5 rounded-full bg-ink-700 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(count / total) * 100}%` }}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                            className={cn(
                              'h-full rounded-full',
                              sev === 'critical' && 'bg-severity-critical',
                              sev === 'high' && 'bg-severity-high',
                              sev === 'medium' && 'bg-severity-medium',
                              sev === 'low' && 'bg-severity-low',
                            )}
                          />
                        </div>
                        <span className="mono text-ink-300 w-8 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </motion.div>

          {/* Recent pipelines */}
          <motion.div variants={item} className="lg:col-span-2">
            <Card className="h-full">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-status-running" />
                  <h3 className="text-sm font-semibold text-ink-100">Recent Pipelines</h3>
                </div>
                <button
                  onClick={() => navigate('/scan')}
                  className="text-xs text-ink-400 hover:text-accent flex items-center gap-1 transition-colors"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {pipelines.length === 0 && !loading ? (
                <div className="text-sm text-ink-400 py-4">
                  No pipeline history yet. Start a scan to analyze your dependencies.
                </div>
              ) : (
                <div className="space-y-2">
                  {pipelines.slice(0, 5).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/scan/pipeline/${p.id}`)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg bg-ink-900/50 hover:bg-ink-700/50 transition-colors border border-ink-700/30 text-left"
                    >
                      <Badge className={pipelineStatusBg(p.status)}>
                        {p.status === 'succeeded' && <CheckCircle2 className="w-3 h-3" />}
                        {p.status === 'failed' && <XCircle className="w-3 h-3" />}
                        {p.status === 'running' && <Activity className="w-3 h-3 animate-pulse" />}
                        {p.status}
                      </Badge>
                      <span className="mono text-xs text-ink-300 truncate">{p.id}</span>
                      <div className="ml-auto flex items-center gap-3">
                        <div className="flex gap-1">
                          {(p.tasks ?? []).map((t) => (
                            <span key={t.id} className={cn('w-2 h-2 rounded-full', taskStatusColor(t.status).replace('text-', 'bg-'))} title={`${t.agent}: ${t.status}`} />
                          ))}
                        </div>
                        <span className="text-xs text-ink-400 hidden sm:inline">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {formatRelative(p.createdAt)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        </div>

        {/* Dependency Graph Feature Banner */}
        <motion.div variants={item}>
          <div className="p-6 rounded-2xl bg-gradient-to-r from-ink-900 via-ink-850 to-ink-900 border border-accent/30 shadow-[0_0_20px_rgba(57,255,133,0.06)] flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/15 text-accent border border-accent/30 shrink-0">
                <Network className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink-50 flex items-center gap-2">
                  Topological Dependency Network
                  <Badge className="bg-accent/15 text-accent border-accent/30 text-[10px]">
                    FalkorDB Engine
                  </Badge>
                </h3>
                <p className="text-xs text-ink-300 mt-1 max-w-xl leading-relaxed">
                  Explore full transitive dependency graphs, isolate direct vs transitive dependencies, and visualize vulnerability propagation paths from code entry points.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="primary"
                icon={<Network className="w-4 h-4" />}
                onClick={() => navigate('/graph')}
              >
                Launch Graph Explorer
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Quick actions */}
        <motion.div variants={item}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <QuickAction
              icon={<GitBranch className="w-5 h-5 text-accent" />}
              title="Repositories"
              desc="Manage monitored repos"
              onClick={() => navigate('/repositories')}
            />
            <QuickAction
              icon={<Network className="w-5 h-5 text-accent" />}
              title="Dependency Graph"
              desc="Visual topology network"
              onClick={() => navigate('/graph')}
            />
            <QuickAction
              icon={<AlertTriangle className="w-5 h-5 text-severity-high" />}
              title="Vulnerabilities"
              desc="Browse security findings"
              onClick={() => navigate('/vulnerabilities')}
            />
            <QuickAction
              icon={<Wrench className="w-5 h-5 text-accent" />}
              title="Remediation"
              desc="View upgrade plans"
              onClick={() => navigate('/remediation')}
            />
            <QuickAction
              icon={<Brain className="w-5 h-5 text-status-running" />}
              title="Decision Memory"
              desc="Agent decision history"
              onClick={() => navigate('/memory')}
            />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function StatusCard({ icon, label, value, color, loading }: {
  icon: React.ReactNode; label: string; value: string; color: string; loading: boolean;
}) {
  return (
    <div className="flex-1 min-w-[140px] flex items-center gap-3 p-3 rounded-xl bg-ink-800/50 border border-ink-700/40">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-ink-700/50 text-ink-300 shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-ink-400">{label}</p>
        {loading ? (
          <div className="skeleton h-4 w-12 mt-1" />
        ) : (
          <p className={cn('text-sm font-semibold', color)}>{value}</p>
        )}
      </div>
    </div>
  );
}

function QuickAction({ icon, title, desc, onClick }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void;
}) {
  return (
    <Card hoverable onClick={onClick} className="group">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-ink-700/50 text-ink-300 group-hover:text-accent group-hover:bg-accent/10 transition-colors">
          {icon}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-ink-100">{title}</h4>
          <p className="text-xs text-ink-400">{desc}</p>
        </div>
        <ArrowRight className="w-4 h-4 ml-auto text-ink-500 group-hover:text-accent transition-colors" />
      </div>
    </Card>
  );
}

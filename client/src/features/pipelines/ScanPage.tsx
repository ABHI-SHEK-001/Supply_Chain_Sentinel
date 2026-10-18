import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine, Play, RefreshCw, CheckCircle2, XCircle, Clock, Activity,
  SkipForward, ArrowRight, AlertTriangle, GitBranch, Network,
} from 'lucide-react';
import { PageHeader, Card, ErrorState, EmptyState, Button, Badge, CardSkeleton } from '../../components/ui/shared';
import { useApi } from '../../hooks/useApi';
import { listRepositories } from '../../api/repositories';
import { startAnalysis, listPipelines } from '../../api/pipelines';
import { cn, formatRelative, pipelineStatusBg, taskStatusBg, taskStatusColor } from '../../lib/utils';
import { ApiClientError } from '../../api/client';
import type { PipelineSummary } from '../../types/api';

export default function ScanPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [repoId, setRepoId] = useState<string>((location.state as { repoId?: string } | null)?.repoId ?? 'demo');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanGuard = useRef(false);

  const { data: repos } = useApi(
    useCallback((s: AbortSignal) => listRepositories(s), []),
  );
  const { data: pipelines, loading, error, refetch } = useApi(
    useCallback((s: AbortSignal) => listPipelines(repoId, s), [repoId]),
  );

  const handleScan = async () => {
    if (scanGuard.current || !repoId.trim()) return;
    scanGuard.current = true;
    setScanning(true);
    setScanError(null);

    try {
      const snapshot = await startAnalysis(repoId.trim());
      refetch();
      navigate(`/scan/pipeline/${snapshot.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setScanError(err.message);
      } else {
        setScanError(err instanceof Error ? err.message : 'Scan failed');
      }
    } finally {
      setScanning(false);
      scanGuard.current = false;
    }
  };

  return (
    <div>
      <PageHeader
        title="Scan & Pipelines"
        description="Orchestrate vulnerability scans and monitor agent pipelines"
        icon={<ScanLine className="w-5 h-5 text-accent" />}
      />

      {/* Scan launcher */}
      <Card className="mb-6 p-5 bg-ink-900 border-ink-700/60 shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="flex-1 min-w-0">
            <label htmlFor="repo-select" className="block text-xs font-semibold uppercase tracking-wider text-ink-300 mb-2">
              Select Repository to Analyze
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
                <select
                  id="repo-select"
                  value={repoId}
                  onChange={(e) => {
                    setRepoId(e.target.value);
                    setScanError(null);
                  }}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-100 focus:outline-none focus:border-accent"
                >
                  {repos && repos.length > 0 ? (
                    repos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.ecosystem || 'npm'} • {r.packageCount} pkgs)
                      </option>
                    ))
                  ) : (
                    <option value="demo">demo</option>
                  )}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  icon={<Play className="w-4 h-4" />}
                  onClick={handleScan}
                  loading={scanning}
                  disabled={!repoId.trim()}
                >
                  Start Scan Pipeline
                </Button>

                {repoId && (
                  <button
                    onClick={() => navigate(`/graph?repo=${repoId}`)}
                    className="flex items-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold bg-ink-800 border border-ink-700 text-accent hover:bg-accent/10 hover:border-accent/40 transition-all shrink-0"
                  >
                    <Network className="w-3.5 h-3.5" />
                    View Graph
                  </button>
                )}
              </div>
            </div>
            <AnimatePresence>
              {scanError && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-xs text-severity-critical mt-2 flex items-center gap-1"
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> {scanError}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Card>

      {/* Pipeline list */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink-200">Pipeline History — {repoId || '…'}</h2>
        <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={refetch}>
          Refresh
        </Button>
      </div>

      {loading && !pipelines && (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      )}
      {error && <ErrorState error={error} onRetry={refetch} compact />}

      {pipelines && pipelines.length === 0 && (
        <EmptyState
          icon={<ScanLine className="w-6 h-6 text-ink-400" />}
          title="No pipeline history"
          description={`No scans have been run for "${repoId}" yet. Start a scan above to begin.`}
        />
      )}

      {pipelines && pipelines.length > 0 && (
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} className="space-y-3">
          {pipelines.map((p) => (
            <PipelineCard key={p.id} pipeline={p} onClick={() => navigate(`/scan/pipeline/${p.id}`)} />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function PipelineCard({ pipeline, onClick }: { pipeline: PipelineSummary; onClick: () => void }) {
  const taskIcon = (status: string) => {
    switch (status) {
      case 'succeeded': return <CheckCircle2 className="w-3.5 h-3.5" />;
      case 'failed': return <XCircle className="w-3.5 h-3.5" />;
      case 'running': return <Activity className="w-3.5 h-3.5 animate-pulse" />;
      case 'skipped': return <SkipForward className="w-3.5 h-3.5" />;
      default: return <Clock className="w-3.5 h-3.5" />;
    }
  };

  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Card hoverable onClick={onClick} className="group">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Badge className={pipelineStatusBg(pipeline.status)}>
              {taskIcon(pipeline.status)}
              {pipeline.status}
            </Badge>
            <span className="mono text-xs text-ink-300 truncate">{pipeline.id}</span>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            {/* Agent stages */}
            <div className="flex items-center gap-1">
              {pipeline.tasks.map((t, i) => (
                <div key={t.id} className="flex items-center">
                  <Badge className={cn(taskStatusBg(t.status), 'text-[10px] py-0')}>
                    {taskIcon(t.status)}
                    <span className="hidden sm:inline">{t.agent}</span>
                  </Badge>
                  {i < pipeline.tasks.length - 1 && (
                    <div className={cn(
                      'w-4 h-px mx-0.5',
                      t.status === 'succeeded' ? 'bg-status-success/40' : 'bg-ink-600',
                    )} />
                  )}
                </div>
              ))}
            </div>

            <span className="text-xs text-ink-400 ml-2">
              {formatRelative(pipeline.createdAt)}
            </span>
            <ArrowRight className="w-4 h-4 text-ink-500 group-hover:text-accent transition-colors" />
          </div>
        </div>

        {/* Show skipped reason */}
        {pipeline.tasks.some((t) => t.status === 'skipped' && t.detail) && (
          <p className="text-xs text-ink-400 mt-2 pl-1 italic">
            {pipeline.tasks.find((t) => t.status === 'skipped')?.detail}
          </p>
        )}
      </Card>
    </motion.div>
  );
}

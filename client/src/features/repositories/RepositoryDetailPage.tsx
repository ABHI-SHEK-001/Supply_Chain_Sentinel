import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  GitBranch,
  Package,
  Calendar,
  Hash,
  ScanLine,
  ArrowLeft,
  RefreshCw,
  Network,
  History,
  Info,
} from 'lucide-react';
import { PageHeader, Card, ErrorState, Button, Badge } from '../../components/ui/shared';
import { useApi } from '../../hooks/useApi';
import { getRepository } from '../../api/repositories';
import { listPipelines } from '../../api/pipelines';
import { cn, formatRelative, formatTimestamp, pipelineStatusBg } from '../../lib/utils';
import type { RepositorySummary, PipelineSummary } from '../../types/api';
import DependencyGraphView from '../../components/graph/DependencyGraphView';

export default function RepositoryDetailPage() {
  const params = useParams<{ id?: string; repoId?: string }>();
  const repoId = params.id || params.repoId;
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'graph' | 'pipelines' | 'metadata'>('graph');

  const { data: repo, loading, error, refetch } = useApi<RepositorySummary>(
    useCallback(
      (s: AbortSignal) => (repoId ? getRepository(repoId, s) : Promise.reject(new Error('No repository ID specified'))),
      [repoId],
    ),
  );

  const { data: pipelines, refetch: refetchPipelines } = useApi<PipelineSummary[]>(
    useCallback(
      (s: AbortSignal) => (repoId ? listPipelines(repoId, s) : Promise.resolve([])),
      [repoId],
    ),
  );

  const handleRefreshAll = () => {
    refetch();
    refetchPipelines();
  };

  if (error) {
    return (
      <div>
        <div className="mb-4">
          <button
            onClick={() => navigate('/repositories')}
            className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Repositories
          </button>
        </div>
        <PageHeader title="Repository" icon={<GitBranch className="w-5 h-5 text-accent" />} />
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/repositories')}
          className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent transition-colors py-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Repositories
        </button>
      </div>

      <PageHeader
        title={repo?.name ?? repoId ?? 'Loading...'}
        description={repo ? `Repository Slug: ${repo.id} • ${repo.packageCount} manifest packages` : undefined}
        icon={<GitBranch className="w-5 h-5 text-accent" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<ScanLine className="w-4 h-4" />}
              onClick={() => navigate('/scan', { state: { repoId } })}
            >
              Run Scan Pipeline
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={handleRefreshAll}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {repo && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4 bg-ink-900 border-ink-700/60">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <Package className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs">Packages</span>
              </div>
              <p className="text-xl font-bold text-ink-50">{repo.packageCount}</p>
            </Card>

            <Card className="p-4 bg-ink-900 border-ink-700/60">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <span className="text-xs">Ecosystem</span>
              </div>
              <p className="text-xl font-bold text-ink-50 uppercase">{repo.ecosystem ?? 'NPM'}</p>
            </Card>

            <Card className="p-4 bg-ink-900 border-ink-700/60">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <Calendar className="w-3.5 h-3.5 text-status-running" />
                <span className="text-xs">Monitored Since</span>
              </div>
              <p className="text-xs font-medium text-ink-200 mt-1">{formatTimestamp(repo.createdAt)}</p>
            </Card>

            <Card className="p-4 bg-ink-900 border-ink-700/60">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <Hash className="w-3.5 h-3.5 text-ink-400" />
                <span className="text-xs">Lockfile SHA256</span>
              </div>
              <p className="mono text-[11px] text-ink-300 truncate mt-1">{repo.lockfileSha256 ?? 'N/A'}</p>
            </Card>
          </div>

          {/* Navigation Tab Bar */}
          <div className="flex items-center gap-2 border-b border-ink-800 pb-2">
            <button
              onClick={() => setActiveTab('graph')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                activeTab === 'graph'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-[0_0_12px_rgba(57,255,133,0.1)]'
                  : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800',
              )}
            >
              <Network className="w-4 h-4" />
              Dependency Graph
            </button>
            <button
              onClick={() => setActiveTab('pipelines')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                activeTab === 'pipelines'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-[0_0_12px_rgba(57,255,133,0.1)]'
                  : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800',
              )}
            >
              <History className="w-4 h-4" />
              Pipeline History ({pipelines?.length ?? 0})
            </button>
          </div>

          {/* Tab 1: Interactive Dependency Graph */}
          {activeTab === 'graph' && (
            <div className="space-y-4">
              <DependencyGraphView
                repositoryId={repo.id}
                onSelectVulnerability={(vulnId) => navigate('/vulnerabilities')}
              />
            </div>
          )}

          {/* Tab 2: Pipeline History */}
          {activeTab === 'pipelines' && (
            <Card className="p-6 bg-ink-900 border-ink-700/60">
              <h3 className="text-sm font-semibold text-ink-100 mb-4 flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-status-running" /> Pipeline Executions
              </h3>
              {!pipelines || pipelines.length === 0 ? (
                <div className="p-8 text-center text-ink-400 text-xs">
                  No automated pipeline runs found for this repository yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {pipelines.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/scan/pipeline/${p.id}`)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-ink-950/80 hover:bg-ink-800 transition-colors border border-ink-800 text-left"
                    >
                      <Badge className={pipelineStatusBg(p.status)}>{p.status}</Badge>
                      <span className="mono text-xs text-ink-200 font-semibold">{p.id}</span>
                      <span className="text-xs text-ink-400 ml-auto">{formatRelative(p.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}

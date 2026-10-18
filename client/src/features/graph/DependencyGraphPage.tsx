import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Network, GitBranch, RefreshCw, Sparkles, Layers } from 'lucide-react';
import { PageHeader, Card, Button } from '../../components/ui/shared';
import { useApi } from '../../hooks/useApi';
import { listRepositories } from '../../api/repositories';
import DependencyGraphView from '../../components/graph/DependencyGraphView';
import type { RepositorySummary } from '../../types/api';

export default function DependencyGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const repoParam = searchParams.get('repo');

  const [selectedRepoId, setSelectedRepoId] = useState<string>(repoParam || '');

  const { data: repos, loading: reposLoading, refetch } = useApi<RepositorySummary[]>(
    useCallback((s: AbortSignal) => listRepositories(s), []),
  );

  useEffect(() => {
    if (repos && repos.length > 0 && !selectedRepoId) {
      const defaultId = repoParam && repos.some((r) => r.id === repoParam) ? repoParam : repos[0]!.id;
      setSelectedRepoId(defaultId);
    }
  }, [repos, selectedRepoId, repoParam]);

  const handleSelectRepo = (id: string) => {
    setSelectedRepoId(id);
    setSearchParams({ repo: id });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dependency Graph Explorer"
        description="Interactive topological visualization of software supply chain dependency trees and vulnerability vectors"
        icon={<Network className="w-5 h-5 text-accent" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={refetch}
            >
              Refresh Repositories
            </Button>
          </div>
        }
      />

      {/* Repo Selector & Graph Metadata Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-ink-900 via-ink-850 to-ink-900 border border-ink-700/80 shadow-xl backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 border border-accent/40 text-accent">
            <GitBranch className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400 block">
              Active Manifest Scope
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <select
                value={selectedRepoId}
                onChange={(e) => handleSelectRepo(e.target.value)}
                disabled={reposLoading || !repos?.length}
                className="bg-ink-800 border border-ink-600/80 hover:border-accent text-white text-xs font-mono font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent shadow-inner transition-colors cursor-pointer"
              >
                {reposLoading ? (
                  <option>Loading repositories...</option>
                ) : !repos || repos.length === 0 ? (
                  <option value="">No repositories registered</option>
                ) : (
                  repos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.ecosystem || 'npm'} • {r.packageCount} pkgs)
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Status Indicator & Fast Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ink-800/80 border border-ink-700/80 text-xs text-ink-300">
            <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
            <span className="font-semibold text-white">FalkorDB</span>
            <span className="text-ink-400">Graph Engine Online</span>
          </div>
        </div>
      </div>

      {/* Interactive Dependency Graph Visualizer */}
      {selectedRepoId ? (
        <DependencyGraphView repositoryId={selectedRepoId} />
      ) : (
        <Card className="p-12 text-center text-ink-400">
          <Network className="w-10 h-10 text-ink-600 mx-auto mb-3" />
          <p className="text-sm">Please select a repository to render its dependency graph.</p>
        </Card>
      )}
    </div>
  );
}

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

      {/* Repo Selector Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-ink-900 border border-ink-700/60 shadow-md">
        <div className="flex items-center gap-3">
          <GitBranch className="w-4 h-4 text-accent shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-300">
            Active Repository:
          </span>
          <select
            value={selectedRepoId}
            onChange={(e) => handleSelectRepo(e.target.value)}
            disabled={reposLoading || !repos?.length}
            className="bg-ink-800 border border-ink-600/70 text-ink-100 text-sm font-semibold rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent"
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

        <div className="text-xs text-ink-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-status-success" />
          <span>FalkorDB Graph Engine Online</span>
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

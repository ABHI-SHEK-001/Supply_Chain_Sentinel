import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, RefreshCw, Search, ExternalLink, Shield, ChevronDown, ChevronRight,
  Package, GitBranch, CheckCircle2, Filter, Network,
} from 'lucide-react';
import { PageHeader, Card, ErrorState, EmptyState, Button, Badge, TableSkeleton } from '../../components/ui/shared';
import { useApi } from '../../hooks/useApi';
import { listVulnerabilities } from '../../api/vulnerabilities';
import { cn, severityBg, severityColor } from '../../lib/utils';
import type { VulnerabilitySummary } from '../../types/api';

export default function VulnerabilitiesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: vulns, loading, isRefreshing, error, refetch } = useApi(
    useCallback((s: AbortSignal) => listVulnerabilities(200, s), []),
  );

  const vulnList = Array.isArray(vulns) ? vulns : [];
  const filtered = vulnList.filter((v) => {
    if (search) {
      const q = search.toLowerCase();
      if (!v.id.toLowerCase().includes(q) &&
          !(v.summary ?? '').toLowerCase().includes(q) &&
          !v.aliases.some((a) => a.toLowerCase().includes(q))) {
        return false;
      }
    }
    if (severityFilter && v.severityLabel?.toLowerCase() !== severityFilter) return false;
    return true;
  });

  const severities = ['critical', 'high', 'medium', 'low'];
  const severityCounts: Record<string, number> = {};
  for (const v of vulnList) {
    const s = v.severityLabel?.toLowerCase() ?? 'unknown';
    severityCounts[s] = (severityCounts[s] ?? 0) + 1;
  }

  return (
    <div>
      <PageHeader
        title="Vulnerabilities"
        description="Known security vulnerabilities across all repositories"
        icon={<AlertTriangle className="w-5 h-5 text-severity-high" />}
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin text-accent')} />}
            onClick={refetch}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CVE, GHSA, or keyword…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-ink-900 border border-ink-700/50 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-accent/40 mono"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setSeverityFilter(null)}
            className={cn(
              'px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors',
              !severityFilter ? 'bg-ink-700 text-ink-100 border-ink-600' : 'bg-transparent text-ink-400 border-transparent hover:bg-ink-800',
            )}
          >
            All
          </button>
          {severities.map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(severityFilter === s ? null : s)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize',
                severityFilter === s ? severityBg(s) : 'bg-transparent text-ink-400 border-transparent hover:bg-ink-800',
              )}
            >
              {s} {severityCounts[s] ? `(${severityCounts[s]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {loading && !vulns && <TableSkeleton rows={8} />}
      {error && <ErrorState error={error} onRetry={refetch} />}

      {vulns && vulns.length === 0 && (
        <EmptyState
          icon={<CheckCircle2 className="w-6 h-6 text-status-success" />}
          title="No vulnerabilities found"
          description="No known vulnerabilities are currently tracked. Run a scan to check your dependencies."
          action={<Button variant="primary" onClick={() => navigate('/scan')}>Start Scan</Button>}
        />
      )}

      {filtered.length === 0 && (vulns ?? []).length > 0 && (
        <EmptyState
          icon={<Filter className="w-6 h-6 text-ink-400" />}
          title="No matching results"
          description="No vulnerabilities match the current filters."
        />
      )}

      {filtered.length > 0 && (
        <div className="rounded-xl border border-ink-700/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ink-800/60 border-b border-ink-700/40">
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-400 uppercase tracking-wider w-8" />
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-400 uppercase tracking-wider">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-400 uppercase tracking-wider">Severity</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-400 uppercase tracking-wider hidden md:table-cell">Summary</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-400 uppercase tracking-wider hidden lg:table-cell">Repos</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-400 uppercase tracking-wider hidden lg:table-cell">Packages</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <VulnRow
                    key={v.id}
                    vuln={v}
                    expanded={expandedId === v.id}
                    onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function VulnRow({ vuln, expanded, onToggle }: {
  vuln: VulnerabilitySummary; expanded: boolean; onToggle: () => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-ink-700/30 hover:bg-ink-800/40 cursor-pointer transition-colors"
      >
        <td className="px-4 py-3">
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-ink-400" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-400" />}
        </td>
        <td className="px-4 py-3">
          <span className="mono text-accent text-xs">{vuln.id}</span>
        </td>
        <td className="px-4 py-3">
          <Badge className={severityBg(vuln.severityLabel)}>
            {vuln.severityLabel ?? 'Unknown'}
          </Badge>
        </td>
        <td className="px-4 py-3 text-ink-300 max-w-xs truncate hidden md:table-cell">
          {vuln.summary ?? '—'}
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <span className="text-xs text-ink-300">{vuln.repositoryCount}</span>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <span className="text-xs text-ink-300">{vuln.packageVersionCount}</span>
        </td>
      </tr>
      <AnimatePresence>
        {expanded && (
          <tr>
            <td colSpan={6} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-4 bg-ink-900/50 border-b border-ink-700/30 space-y-3">
                  {vuln.summary && (
                    <p className="text-sm text-ink-200">{vuln.summary}</p>
                  )}
                  {vuln.aliases.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-ink-400">Aliases:</span>
                      {vuln.aliases.map((a) => (
                        <Badge key={a} className="bg-ink-700 text-ink-300 border-ink-600/50 mono text-[10px]">{a}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-ink-400">
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" /> {vuln.repositoryCount} {vuln.repositoryCount === 1 ? 'repo' : 'repos'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Package className="w-3 h-3" /> {vuln.packageVersionCount} affected versions
                    </span>
                    {vuln.sourceUrl && (
                      <a href={vuln.sourceUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-accent hover:underline">
                        <ExternalLink className="w-3 h-3" /> View source
                      </a>
                    )}
                  </div>
                  {vuln.repositories.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-ink-400">Affected Repositories:</span>
                      {vuln.repositories.map((r) => (
                        <button
                          key={r}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/graph?repo=${r}`);
                          }}
                          className="bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 px-2 py-0.5 rounded mono text-[10px] flex items-center gap-1 transition-all"
                        >
                          <Network className="w-3 h-3" />
                          <span>{r} (View Graph)</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

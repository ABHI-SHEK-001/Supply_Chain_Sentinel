import { useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch,
  Package,
  RefreshCw,
  Plus,
  Calendar,
  Hash,
  Network,
  ScanLine,
  Search,
  UploadCloud,
  FileCode,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader, Card, ErrorState, EmptyState, Button, Badge, CardSkeleton } from '../../components/ui/shared';
import { useApi } from '../../hooks/useApi';
import { listRepositories, registerRepository } from '../../api/repositories';
import { cn, formatRelative } from '../../lib/utils';
import type { RepositorySummary } from '../../types/api';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

export default function RepositoriesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({ name: '', ecosystem: 'npm', lockfile: '' });
  const [submitting, setSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);

  const { data: repos, loading, error, refetch } = useApi<RepositorySummary[]>(
    useCallback((s: AbortSignal) => listRepositories(s), []),
  );

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.ecosystem ?? '').toLowerCase().includes(q),
    );
  }, [repos, search]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerForm.name.trim() || !registerForm.lockfile.trim()) return;
    setSubmitting(true);
    setRegisterError(null);
    setRegisterSuccess(null);
    try {
      const res = await registerRepository({
        name: registerForm.name.trim(),
        ecosystem: registerForm.ecosystem,
        lockfile: registerForm.lockfile,
      });
      setRegisterSuccess(`Repository "${res.repository.name}" registered successfully!`);
      setIsRegisterOpen(false);
      setRegisterForm({ name: '', ecosystem: 'npm', lockfile: '' });
      refetch();
    } catch (err: unknown) {
      setRegisterError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRegisterForm((prev) => ({
        ...prev,
        lockfile: content,
        name: prev.name || file.name.replace(/\.(json|lock)$/, ''),
      }));
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repositories"
        description="Monitored software supply chain repositories & lockfile manifests"
        icon={<GitBranch className="w-5 h-5 text-accent" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setIsRegisterOpen(true)}
            >
              Register Repository
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin text-accent')} />}
              onClick={refetch}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {registerSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-lg bg-status-success/10 border border-status-success/30 text-status-success text-xs flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{registerSuccess}</span>
        </motion.div>
      )}

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-ink-900 border border-ink-700/60 shadow-md">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search repositories by name or ecosystem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-ink-800 border border-ink-700 rounded-lg text-ink-100 placeholder-ink-500 focus:outline-none focus:border-accent"
          />
        </div>

        <div className="text-xs text-ink-400 flex items-center gap-2">
          <span>{filteredRepos.length} of {repos?.length ?? 0} repositories</span>
        </div>
      </div>

      {loading && !repos && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {error && <ErrorState error={error} onRetry={refetch} />}

      {repos && filteredRepos.length === 0 && !loading && (
        <EmptyState
          icon={<GitBranch className="w-6 h-6 text-ink-400" />}
          title={search ? 'No matching repositories found' : 'No repositories registered'}
          description={
            search
              ? 'Try modifying your search criteria.'
              : 'Register a repository with its package-lock.json to start mapping dependency trees and scanning vulnerabilities.'
          }
          action={
            !search ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setIsRegisterOpen(true)}
              >
                Register First Repository
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Repository Cards Grid */}
      {filteredRepos.length > 0 && (
        <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRepos.map((repo) => (
            <motion.div key={repo.id} variants={item}>
              <div className="rounded-xl border border-ink-700/60 bg-ink-900/90 hover:border-ink-600 hover:bg-ink-850 transition-all duration-200 p-5 flex flex-col justify-between h-full shadow-lg">
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 text-accent shrink-0">
                        <GitBranch className="w-4.5 h-4.5" />
                      </div>
                      <div>
                        <h3
                          onClick={() => navigate(`/repositories/${repo.id}`)}
                          className="text-sm font-bold text-ink-50 hover:text-accent cursor-pointer transition-colors"
                        >
                          {repo.name}
                        </h3>
                        <p className="mono text-xs text-ink-400">{repo.id}</p>
                      </div>
                    </div>
                    {repo.ecosystem && (
                      <Badge className="bg-ink-800 text-ink-300 border-ink-700 font-mono text-[10px] uppercase">
                        {repo.ecosystem}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-2 text-xs text-ink-400 py-2 border-y border-ink-800/80 my-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-ink-400">
                        <Package className="w-3.5 h-3.5 text-accent" />
                        Packages
                      </span>
                      <span className="font-semibold text-ink-100">{repo.packageCount}</span>
                    </div>

                    {repo.createdAt && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-ink-400">
                          <Calendar className="w-3.5 h-3.5" />
                          Ingested
                        </span>
                        <span className="text-ink-300">{formatRelative(repo.createdAt)}</span>
                      </div>
                    )}

                    {repo.lockfileSha256 && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-ink-400">
                          <Hash className="w-3.5 h-3.5" />
                          Checksum
                        </span>
                        <span className="mono text-[11px] text-ink-400 truncate max-w-[140px]">
                          {repo.lockfileSha256.slice(0, 14)}…
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => navigate(`/graph?repo=${repo.id}`)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-all"
                  >
                    <Network className="w-3.5 h-3.5" />
                    Dependency Graph
                  </button>

                  <button
                    onClick={() => navigate(`/scan`, { state: { repoId: repo.id } })}
                    className="flex items-center justify-center p-2 rounded-lg text-xs font-semibold bg-ink-800 border border-ink-700 text-ink-300 hover:text-ink-100 hover:border-ink-600 transition-all"
                    title="Launch Scan Pipeline"
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Register Repository Modal */}
      <AnimatePresence>
        {isRegisterOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-ink-900 border border-ink-700/80 rounded-2xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-accent" />
                  <h3 className="text-base font-bold text-ink-50">Register New Repository</h3>
                </div>
                <button
                  onClick={() => setIsRegisterOpen(false)}
                  className="text-ink-400 hover:text-ink-100 text-sm"
                >
                  ✕
                </button>
              </div>

              {registerError && (
                <div className="p-3 rounded-lg bg-severity-critical/10 border border-severity-critical/30 text-severity-critical text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{registerError}</span>
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Repository Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. auth-service or payments-core"
                    value={registerForm.name}
                    onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-xs text-ink-100 focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Ecosystem
                  </label>
                  <select
                    value={registerForm.ecosystem}
                    onChange={(e) => setRegisterForm({ ...registerForm, ecosystem: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-xs text-ink-100 focus:outline-none focus:border-accent"
                  >
                    <option value="npm">npm (Node.js)</option>
                    <option value="PyPI">PyPI (Python)</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-ink-300">
                      Lockfile Content (package-lock.json) *
                    </label>
                    <label className="cursor-pointer text-[11px] text-accent hover:underline flex items-center gap-1">
                      <UploadCloud className="w-3.5 h-3.5" />
                      Upload File
                      <input
                        type="file"
                        accept=".json,.lock"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={6}
                    required
                    placeholder='Paste package-lock.json content here or upload a file...'
                    value={registerForm.lockfile}
                    onChange={(e) => setRegisterForm({ ...registerForm, lockfile: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-700 rounded-lg p-2.5 text-xs mono text-ink-100 focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsRegisterOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={submitting}
                  >
                    Ingest & Register
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

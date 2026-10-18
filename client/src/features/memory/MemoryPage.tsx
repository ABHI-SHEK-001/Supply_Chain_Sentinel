import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Shield,
  Search,
  Filter,
  Plus,
  RefreshCw,
  Clock,
  User,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  RotateCcw,
  GitBranch,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { PageHeader, Card, ErrorState, EmptyState, Button, Badge, Skeleton } from '../../components/ui/shared';
import { useApi } from '../../hooks/useApi';
import { listRepositories } from '../../api/repositories';
import { searchDecisions, recordDecision, revokeDecision } from '../../api/memory';
import { cn, formatDate } from '../../lib/utils';
import type { Decision, DecisionType, DecisionStatus, RepositorySummary } from '../../types/api';

const DECISION_TYPE_LABELS: Record<DecisionType, { label: string; color: string }> = {
  accepted_risk: { label: 'Accepted Risk', color: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30' },
  false_positive: { label: 'False Positive', color: 'bg-severity-low/15 text-severity-low border-severity-low/30' },
  fix_succeeded: { label: 'Fix Succeeded', color: 'bg-status-success/15 text-status-success border-status-success/30' },
  fix_failed: { label: 'Fix Failed', color: 'bg-severity-critical/15 text-severity-critical border-severity-critical/30' },
  plan_validated: { label: 'Plan Validated', color: 'bg-accent/15 text-accent border-accent/30' },
  note: { label: 'Audit Note', color: 'bg-ink-700 text-ink-200 border-ink-600' },
};

const STATUS_COLORS: Record<DecisionStatus, string> = {
  active: 'bg-status-success/10 text-status-success border-status-success/20',
  dormant: 'bg-ink-700 text-ink-300 border-ink-600',
  needs_review: 'bg-severity-high/15 text-severity-high border-severity-high/30',
  expired: 'bg-ink-700 text-ink-400 border-ink-600 line-through',
  superseded: 'bg-ink-700 text-ink-400 border-ink-600',
  revoked: 'bg-severity-critical/10 text-severity-critical border-severity-critical/30 line-through',
};

export default function MemoryPage() {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<DecisionType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal states
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // New decision form state
  const [formData, setFormData] = useState({
    type: 'accepted_risk' as DecisionType,
    vulnerabilityId: '',
    packageVersionId: '',
    actor: 'Security Engineer',
    explanation: '',
    validUntil: '',
  });

  // Repositories list
  const { data: repos, loading: reposLoading } = useApi<RepositorySummary[]>(
    useCallback((s: AbortSignal) => listRepositories(s), []),
  );

  useEffect(() => {
    if (repos && repos.length > 0 && !selectedRepoId) {
      setSelectedRepoId(repos[0].id);
    }
  }, [repos, selectedRepoId]);

  // Fetch decisions for repository
  const {
    data: decisions,
    loading: decisionsLoading,
    isRefreshing: decisionsRefreshing,
    error: decisionsError,
    refetch: refetchDecisions,
  } = useApi<Decision[]>(
    useCallback(
      (s: AbortSignal) => {
        if (!selectedRepoId) return Promise.resolve([]);
        return searchDecisions(
          {
            repositoryId: selectedRepoId,
            type: typeFilter === 'all' ? undefined : typeFilter,
            status: statusFilter === 'all' ? undefined : statusFilter,
            q: searchQuery || undefined,
          },
          s,
        );
      },
      [selectedRepoId, typeFilter, statusFilter, searchQuery],
    ),
  );

  // Handle record decision
  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoId) return;
    setSubmitting(true);
    setBannerMessage(null);
    try {
      await recordDecision({
        repositoryId: selectedRepoId,
        type: formData.type,
        vulnerabilityId: formData.vulnerabilityId || undefined,
        packageVersionId: formData.packageVersionId || undefined,
        actor: formData.actor,
        explanation: formData.explanation,
        validUntil: formData.validUntil ? new Date(formData.validUntil).toISOString() : undefined,
      });
      setIsRecordModalOpen(false);
      setFormData({
        type: 'accepted_risk',
        vulnerabilityId: '',
        packageVersionId: '',
        actor: 'Security Engineer',
        explanation: '',
        validUntil: '',
      });
      setBannerMessage({ text: 'Institutional decision committed to agent memory', type: 'success' });
      refetchDecisions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record decision';
      setBannerMessage({ text: msg, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle revoke decision
  const handleRevokeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokingId || !selectedRepoId) return;
    setSubmitting(true);
    setBannerMessage(null);
    try {
      await revokeDecision(revokingId, {
        repositoryId: selectedRepoId,
        reason: revokeReason || 'Revoked by analyst',
      });
      setRevokingId(null);
      setRevokeReason('');
      setBannerMessage({ text: 'Decision successfully revoked', type: 'success' });
      refetchDecisions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke decision';
      setBannerMessage({ text: msg, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Agent Decision Memory"
        description="Persistent audit trail of triage reasoning, risk acceptances, and institutional policy memory"
        icon={<Brain className="w-5 h-5 text-accent" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={!selectedRepoId}
              onClick={() => setIsRecordModalOpen(true)}
            >
              Record Decision
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={cn('w-3.5 h-3.5', decisionsRefreshing && 'animate-spin text-accent')} />}
              onClick={refetchDecisions}
              disabled={decisionsRefreshing}
            >
              {decisionsRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {/* Repository & Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 rounded-xl bg-ink-900 border border-ink-700/50 mb-6">
        {/* Repo Selector */}
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-ink-400 shrink-0" />
          <select
            value={selectedRepoId}
            onChange={(e) => setSelectedRepoId(e.target.value)}
            disabled={reposLoading || !repos?.length}
            className="w-full bg-ink-800 border border-ink-600/60 text-ink-100 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent"
          >
            {reposLoading ? (
              <option>Loading repos...</option>
            ) : !repos || repos.length === 0 ? (
              <option value="">No repositories</option>
            ) : (
              repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-ink-400 shrink-0" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="w-full bg-ink-800 border border-ink-600/60 text-ink-100 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent"
          >
            <option value="all">All Types</option>
            <option value="accepted_risk">Accepted Risk</option>
            <option value="false_positive">False Positive</option>
            <option value="plan_validated">Plan Validated</option>
            <option value="fix_succeeded">Fix Succeeded</option>
            <option value="fix_failed">Fix Failed</option>
            <option value="note">Audit Note</option>
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-full bg-ink-800 border border-ink-600/60 text-ink-100 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="needs_review">Needs Review</option>
            <option value="dormant">Dormant</option>
            <option value="revoked">Revoked</option>
            <option value="expired">Expired</option>
            <option value="superseded">Superseded</option>
          </select>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search decisions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-ink-800 border border-ink-600/60 rounded-lg text-ink-100 placeholder-ink-500 focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {bannerMessage && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'mb-4 p-3 rounded-lg text-sm flex items-center gap-2 border',
            bannerMessage.type === 'success'
              ? 'bg-status-success/10 border-status-success/30 text-status-success'
              : 'bg-severity-critical/10 border-severity-critical/30 text-severity-critical',
          )}
        >
          {bannerMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{bannerMessage.text}</span>
        </motion.div>
      )}

      {/* Decision Feed */}
      {decisionsLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : decisionsError ? (
        <ErrorState error={decisionsError} onRetry={refetchDecisions} />
      ) : !decisions || decisions.length === 0 ? (
        <EmptyState
          icon={<Brain className="w-8 h-8 text-ink-400" />}
          title="No Decision Records Found"
          description="Autonomous agents and engineers record policy memory, false-positive suppressions, and validated plans here."
          action={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setIsRecordModalOpen(true)}
            >
              Record First Decision
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {decisions.map((d) => {
            const typeConfig = DECISION_TYPE_LABELS[d.type] ?? {
              label: d.type,
              color: 'bg-ink-700 text-ink-200 border-ink-600',
            };
            const statusColor = STATUS_COLORS[d.status] ?? 'bg-ink-700 text-ink-300';
            const isActive = d.status === 'active';

            return (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'rounded-xl p-5 border transition-all duration-150 space-y-3',
                  isActive
                    ? 'bg-ink-900 border-ink-700/60 hover:border-ink-600/70'
                    : 'bg-ink-950/60 border-ink-800 opacity-75',
                )}
              >
                {/* Card Top: Badges and Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className={typeConfig.color}>{typeConfig.label}</Badge>
                    <Badge className={statusColor}>{d.status}</Badge>
                    <span className="mono text-xs text-ink-400">ID: {d.id.slice(0, 8)}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-ink-400">
                    <div className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-accent" />
                      <span className="text-ink-200">{d.actor}</span>
                    </div>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{formatDate(d.createdAt)}</span>
                    </div>
                    {isActive && (
                      <button
                        onClick={() => setRevokingId(d.id)}
                        className="text-severity-critical/80 hover:text-severity-critical text-xs ml-2 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>

                {/* Card Body: Explanation */}
                <p className="text-sm text-ink-100 font-medium leading-relaxed">
                  {d.explanation}
                </p>

                {/* Targets Row */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-ink-800/80 text-xs text-ink-400">
                  {d.vulnerabilityId && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-ink-800 border border-ink-700/60 mono text-severity-high">
                      <span>CVE:</span>
                      <span>{d.vulnerabilityId}</span>
                    </div>
                  )}

                  {d.packageVersionId && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-ink-800 border border-ink-700/60 mono text-ink-300">
                      <span>Package:</span>
                      <span>{d.packageVersionId}</span>
                    </div>
                  )}

                  {d.planId && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-ink-800 border border-ink-700/60 mono text-accent">
                      <span>Plan:</span>
                      <span>{d.planId.slice(0, 8)}</span>
                    </div>
                  )}

                  {d.validUntil && (
                    <div className="flex items-center gap-1 text-ink-400 ml-auto">
                      <span>Valid until:</span>
                      <span className="mono">{formatDate(d.validUntil)}</span>
                    </div>
                  )}

                  {d.statusReason && (
                    <div className="w-full text-xs text-ink-500 italic">
                      Status note: {d.statusReason}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Record Decision Modal */}
      <AnimatePresence>
        {isRecordModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-ink-900 border border-ink-700/80 rounded-2xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink-50 flex items-center gap-2">
                  <Brain className="w-4 h-4 text-accent" />
                  Record Institutional Triage Decision
                </h3>
                <button
                  onClick={() => setIsRecordModalOpen(false)}
                  className="text-ink-400 hover:text-ink-100 text-sm"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleRecordSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Decision Type *
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-accent"
                  >
                    <option value="accepted_risk">Accepted Risk (Known Vulnerability Deferred)</option>
                    <option value="false_positive">False Positive (Code path unreached or sanitized)</option>
                    <option value="plan_validated">Plan Validated (Remediation strategy approved)</option>
                    <option value="fix_succeeded">Fix Succeeded (Remediation applied and verified)</option>
                    <option value="fix_failed">Fix Failed (Upgrade caused regression)</option>
                    <option value="note">Audit Note / Architecture Context</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-ink-300 mb-1">
                      Target Vulnerability (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. GHSA-xxx or CVE-2024-..."
                      value={formData.vulnerabilityId}
                      onChange={(e) => setFormData({ ...formData, vulnerabilityId: e.target.value })}
                      className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-ink-300 mb-1">
                      Package Identifier (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. pkg:npm/lodash@4.17.20"
                      value={formData.packageVersionId}
                      onChange={(e) => setFormData({ ...formData, packageVersionId: e.target.value })}
                      className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Recorded By (Actor) *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.actor}
                    onChange={(e) => setFormData({ ...formData, actor: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Reasoning & Evidence *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Document the exact technical reasoning, threat model justification, or remediation plan context..."
                    value={formData.explanation}
                    onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-600 rounded-lg p-2.5 text-sm text-ink-100 focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Valid Until (Expiry Date, optional)
                  </label>
                  <input
                    type="date"
                    value={formData.validUntil}
                    onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsRecordModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={submitting}
                  >
                    Commit to Memory
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Revoke Modal */}
      <AnimatePresence>
        {revokingId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-ink-900 border border-ink-700/80 rounded-2xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2 text-severity-critical">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-base font-semibold text-ink-50">Revoke Decision</h3>
              </div>

              <p className="text-sm text-ink-300">
                Are you sure you want to revoke this decision? Revoked decisions remain in the historical audit ledger but will no longer suppress findings in agent pipelines.
              </p>

              <form onSubmit={handleRevokeSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Revocation Reason
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Code refactored, risk no longer accepted, or new exploit published..."
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    className="w-full bg-ink-800 border border-ink-600 rounded-lg p-2.5 text-sm text-ink-100 focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRevokingId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    loading={submitting}
                  >
                    Confirm Revocation
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

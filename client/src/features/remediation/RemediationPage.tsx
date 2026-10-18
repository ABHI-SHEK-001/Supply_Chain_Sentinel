import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  FileText,
  AlertOctagon,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers,
  Sparkles,
} from 'lucide-react';
import { PageHeader, Card, ErrorState, EmptyState, Button, Badge, Skeleton } from '../../components/ui/shared';
import { useApi } from '../../hooks/useApi';
import { listRepositories } from '../../api/repositories';
import { listPlans, getPlan, createPlan, validatePlan } from '../../api/remediation';
import { recordDecision } from '../../api/memory';
import { cn, formatDate, severityBadge } from '../../lib/utils';
import type { RemediationPlan, PlanSummary, PlanValidation, RepositorySummary } from '../../types/api';

export default function RemediationPage() {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<RemediationPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Decision recording state
  const [isRecordingDecision, setIsRecordingDecision] = useState(false);
  const [decisionExplanation, setDecisionExplanation] = useState('');
  const [decisionType, setDecisionType] = useState<'plan_validated' | 'accepted_risk'>('plan_validated');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Fetch repositories
  const { data: repos, loading: reposLoading } = useApi<RepositorySummary[]>(
    useCallback((s: AbortSignal) => listRepositories(s), []),
  );

  // Select first repo by default when loaded
  useEffect(() => {
    if (repos && repos.length > 0 && !selectedRepoId) {
      setSelectedRepoId(repos[0].id);
    }
  }, [repos, selectedRepoId]);

  // Fetch plans for selected repo
  const {
    data: plans,
    loading: plansLoading,
    error: plansError,
    refetch: refetchPlans,
  } = useApi<PlanSummary[]>(
    useCallback(
      (s: AbortSignal) => listPlans(selectedRepoId || undefined, s),
      [selectedRepoId],
    ),
  );

  // Automatically select first plan if available
  useEffect(() => {
    if (plans && plans.length > 0) {
      if (!selectedPlanId || !plans.some((p) => p.id === selectedPlanId)) {
        setSelectedPlanId(plans[0].id);
      }
    } else if (plans && plans.length === 0) {
      setSelectedPlanId(null);
      setSelectedPlan(null);
    }
  }, [plans, selectedPlanId]);

  // Fetch plan details whenever selectedPlanId changes
  const fetchPlanDetails = useCallback(async (id: string) => {
    setPlanLoading(true);
    try {
      const plan = await getPlan(id);
      setSelectedPlan(plan);
    } catch (err: unknown) {
      console.error('Failed to load plan details:', err);
    } finally {
      setPlanLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPlanId) {
      fetchPlanDetails(selectedPlanId);
    }
  }, [selectedPlanId, fetchPlanDetails]);

  // Handle plan validation
  const handleValidatePlan = async () => {
    if (!selectedPlanId) return;
    setValidating(true);
    setActionSuccess(null);
    try {
      const validation = await validatePlan(selectedPlanId);
      setSelectedPlan((prev) => (prev ? { ...prev, validation } : null));
      setActionSuccess('Plan validation completed successfully');
      refetchPlans();
    } catch (err: unknown) {
      console.error('Validation failed:', err);
    } finally {
      setValidating(false);
    }
  };

  // Handle plan creation
  const handleCreatePlan = async () => {
    if (!selectedRepoId) return;
    setGenerating(true);
    setGenerateError(null);
    setActionSuccess(null);
    try {
      const newPlan = await createPlan({ repositoryId: selectedRepoId });
      setSelectedPlan(newPlan);
      setSelectedPlanId(newPlan.id);
      setActionSuccess('Remediation plan generated successfully');
      refetchPlans();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate plan';
      setGenerateError(msg);
    } finally {
      setGenerating(false);
    }
  };

  // Handle recording decision into institutional memory
  const handleRecordDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return;
    setSubmittingDecision(true);
    try {
      await recordDecision({
        repositoryId: selectedPlan.repositoryId,
        type: decisionType,
        planId: selectedPlan.id,
        actor: 'Security Engineer',
        explanation: decisionExplanation || `Approved remediation plan ${selectedPlan.id.slice(0, 8)}`,
      });
      setIsRecordingDecision(false);
      setDecisionExplanation('');
      setActionSuccess('Triage decision committed to Agent Memory');
    } catch (err: unknown) {
      console.error('Failed to record decision:', err);
    } finally {
      setSubmittingDecision(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Remediation Planning"
        description="Dependency tree upgrade plans, breaking change validation, and automated fixes"
        icon={<Wrench className="w-5 h-5 text-accent" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Sparkles className="w-3.5 h-3.5" />}
              loading={generating}
              disabled={!selectedRepoId}
              onClick={handleCreatePlan}
            >
              Generate Plan
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={refetchPlans}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Repo Selector & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl bg-ink-900 border border-ink-700/50 mb-6">
        <div className="flex items-center gap-3">
          <GitBranch className="w-4 h-4 text-ink-400 shrink-0" />
          <span className="text-sm font-medium text-ink-200">Repository:</span>
          <select
            value={selectedRepoId}
            onChange={(e) => setSelectedRepoId(e.target.value)}
            disabled={reposLoading || !repos?.length}
            className="bg-ink-800 border border-ink-600/60 text-ink-100 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent"
          >
            {reposLoading ? (
              <option>Loading repositories...</option>
            ) : !repos || repos.length === 0 ? (
              <option value="">No repositories registered</option>
            ) : (
              repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.ecosystem || 'npm'})
                </option>
              ))
            )}
          </select>
        </div>

        {selectedPlan && (
          <div className="flex items-center gap-2 text-xs text-ink-400">
            <span>Targeting {selectedPlan.targeted?.findingCount ?? 0} findings</span>
            <span>•</span>
            <span>{selectedPlan.upgrades?.length ?? 0} upgrade steps</span>
          </div>
        )}
      </div>

      {actionSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 rounded-lg bg-status-success/10 border border-status-success/30 text-status-success text-sm flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </motion.div>
      )}

      {generateError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 rounded-lg bg-severity-critical/10 border border-severity-critical/30 text-severity-critical text-sm flex items-center gap-2"
        >
          <AlertOctagon className="w-4 h-4 shrink-0" />
          <span>{generateError}</span>
        </motion.div>
      )}

      {/* Main Grid: Plan List Sidebar + Plan Detail Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Plan History */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Remediation Plans ({plans?.length ?? 0})
            </h2>
          </div>

          {plansLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : plansError ? (
            <ErrorState error={plansError} onRetry={refetchPlans} compact />
          ) : !plans || plans.length === 0 ? (
            <Card className="text-center py-8">
              <Layers className="w-8 h-8 text-ink-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-ink-300">No remediation plans yet</p>
              <p className="text-xs text-ink-400 mt-1">
                Click "Generate Plan" to compute optimal dependency upgrades.
              </p>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
              {plans.map((p) => {
                const isSelected = p.id === selectedPlanId;
                const isValid = p.validationStatus === 'valid';
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlanId(p.id)}
                    className={cn(
                      'w-full text-left p-3.5 rounded-xl border transition-all duration-150',
                      isSelected
                        ? 'bg-accent/10 border-accent/40 shadow-[0_0_12px_rgba(57,255,133,0.06)]'
                        : 'bg-ink-900/60 border-ink-700/50 hover:bg-ink-800/60 hover:border-ink-600/60',
                    )}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="mono text-xs font-semibold text-ink-200">
                        PLAN-{p.id.slice(0, 8)}
                      </span>
                      <Badge
                        className={cn(
                          p.status === 'proposed'
                            ? 'bg-status-running/10 text-status-running border-status-running/20'
                            : 'bg-ink-700 text-ink-300 border-ink-600',
                        )}
                      >
                        {p.status ?? 'proposed'}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-ink-400">
                      <span>{p.upgradeCount} upgrade{p.upgradeCount !== 1 ? 's' : ''}</span>
                      {p.uncoveredCount > 0 && (
                        <span className="text-severity-high">
                          {p.uncoveredCount} uncovered
                        </span>
                      )}
                      {p.validationStatus && (
                        <span className={isValid ? 'text-status-success' : 'text-severity-high'}>
                          {p.validationStatus}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-ink-500 mt-2">
                      {formatDate(p.createdAt)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Selected Plan Detail Canvas */}
        <div className="lg:col-span-8">
          {planLoading ? (
            <Card className="p-6 space-y-4">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </Card>
          ) : !selectedPlan ? (
            <Card className="py-16 text-center">
              <Wrench className="w-10 h-10 text-ink-500 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-ink-100">No Plan Selected</h3>
              <p className="text-sm text-ink-400 mt-1 max-w-sm mx-auto">
                Select an existing plan from the history or click "Generate Plan" to compute upgrades.
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Plan Header Card */}
              <Card className="p-5 border-ink-700/60 bg-ink-900/80">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-ink-700/50">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="mono text-sm font-bold text-accent">
                        PLAN-{selectedPlan.id}
                      </span>
                      <Badge
                        className={cn(
                          selectedPlan.optimality === 'exact'
                            ? 'bg-status-success/10 text-status-success border-status-success/30'
                            : 'bg-severity-medium/10 text-severity-medium border-severity-medium/30',
                        )}
                      >
                        {selectedPlan.optimality}
                      </Badge>
                    </div>
                    <p className="text-xs text-ink-400">{selectedPlan.objective}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<ShieldCheck className="w-3.5 h-3.5" />}
                      loading={validating}
                      onClick={handleValidatePlan}
                    >
                      {selectedPlan.validation ? 'Re-validate Plan' : 'Validate Plan'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<FileText className="w-3.5 h-3.5" />}
                      onClick={() => setIsRecordingDecision(true)}
                    >
                      Record Triage
                    </Button>
                  </div>
                </div>

                {/* Metrics Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400">Status</div>
                    <div className="text-sm font-semibold text-ink-100 mt-0.5 capitalize">
                      {selectedPlan.status.replace('_', ' ')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400">Target Vulns</div>
                    <div className="text-sm font-semibold text-ink-100 mt-0.5">
                      {selectedPlan.targeted?.vulnerabilityCount ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400">Upgrades</div>
                    <div className="text-sm font-semibold text-accent mt-0.5">
                      {selectedPlan.upgrades?.length ?? 0} packages
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400">Coverage</div>
                    <div className="text-sm font-semibold text-ink-100 mt-0.5">
                      {selectedPlan.coverage?.complete ? '100% Complete' : `${selectedPlan.coverage?.packagesUnchecked ?? 0} unchecked`}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Validation Status Card if Validated */}
              {selectedPlan.validation && (
                <Card
                  className={cn(
                    'p-4 border',
                    selectedPlan.validation.status === 'valid'
                      ? 'bg-status-success/5 border-status-success/30'
                      : 'bg-severity-high/5 border-severity-high/30',
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {selectedPlan.validation.status === 'valid' ? (
                        <CheckCircle2 className="w-5 h-5 text-status-success" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-severity-high" />
                      )}
                      <div>
                        <h4 className="text-sm font-semibold text-ink-100 capitalize">
                          Plan Validation: {selectedPlan.validation.status}
                        </h4>
                        <p className="text-xs text-ink-400">
                          Eliminated {selectedPlan.validation.eliminatedFindings} finding(s) •{' '}
                          {selectedPlan.validation.fullyResolvesTargets
                            ? 'Fully resolves all targets'
                            : 'Partial resolution'}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] mono text-ink-400">
                      {formatDate(selectedPlan.validation.validatedAt)}
                    </span>
                  </div>

                  {selectedPlan.validation.parentRangeViolations?.length > 0 && (
                    <div className="mt-3 p-3 rounded-lg bg-severity-critical/10 border border-severity-critical/20 text-xs space-y-1">
                      <div className="font-semibold text-severity-critical">
                        Parent Range Violations Detected ({selectedPlan.validation.parentRangeViolations.length}):
                      </div>
                      {selectedPlan.validation.parentRangeViolations.map((v, idx) => (
                        <div key={idx} className="mono text-ink-300">
                          {v.packageVersionId} to {v.toVersion} breaks parent constraint ({v.range})
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedPlan.validation.notes?.length > 0 && (
                    <div className="mt-2 text-xs text-ink-300 space-y-1">
                      {selectedPlan.validation.notes.map((note, idx) => (
                        <div key={idx} className="flex items-start gap-1.5">
                          <span className="text-accent">•</span>
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Upgrades Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-semibold text-ink-100 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent" />
                    Recommended Upgrades ({selectedPlan.upgrades?.length ?? 0})
                  </h3>
                </div>

                {!selectedPlan.upgrades || selectedPlan.upgrades.length === 0 ? (
                  <Card className="p-5 text-center text-xs text-ink-400">
                    No package upgrades required.
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {selectedPlan.upgrades.map((u, i) => (
                      <div
                        key={i}
                        className="rounded-xl p-4 bg-ink-900 border border-ink-700/60 hover:border-ink-600/70 transition-all space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-ink-50 mono">{u.name}</span>
                            <Badge
                              className={cn(
                                u.kind === 'direct'
                                  ? 'bg-accent/10 text-accent border-accent/20'
                                  : 'bg-ink-700 text-ink-300 border-ink-600',
                              )}
                            >
                              {u.kind}
                            </Badge>
                            {u.majorBump && (
                              <Badge className="bg-severity-high/15 text-severity-high border-severity-high/30">
                                Major Bump (Breaking Risk)
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-xs mono">
                            <span className="text-ink-400">{u.fromVersion}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-accent" />
                            <span className="text-accent font-semibold">{u.toVersion}</span>
                          </div>
                        </div>

                        {/* Eliminates Vulnerabilities */}
                        {u.eliminates?.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="text-ink-400 text-[11px]">Eliminates:</span>
                            {u.eliminates.map((e, idx) => (
                              <span
                                key={idx}
                                className={cn('px-2 py-0.5 rounded text-[11px] mono font-medium', severityBadge(e.severityLabel))}
                              >
                                {e.vulnerabilityId}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Parent Compatibility / Suggested Action */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-ink-800 text-xs">
                          <div className="text-ink-400 flex items-center gap-2">
                            <span>Compatibility:</span>
                            <span
                              className={cn(
                                'font-medium',
                                u.parentCompatibility?.status === 'compatible'
                                  ? 'text-status-success'
                                  : 'text-severity-high',
                              )}
                            >
                              {u.parentCompatibility?.status ?? 'unknown'}
                            </span>
                          </div>

                          {u.suggestedAction && (
                            <div className="mono text-[11px] text-ink-300 bg-ink-950/80 px-2.5 py-1 rounded border border-ink-700/40">
                              {u.suggestedAction}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Uncovered Targets */}
              {selectedPlan.uncovered && selectedPlan.uncovered.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-severity-high flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-severity-high" />
                    Uncovered Targets ({selectedPlan.uncovered.length})
                  </h3>
                  <div className="space-y-2">
                    {selectedPlan.uncovered.map((t, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl p-3.5 bg-severity-high/5 border border-severity-high/20 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold mono text-ink-100">
                            {t.name} @ {t.version}
                          </span>
                          <Badge className="bg-severity-high/15 text-severity-high border-severity-high/30">
                            {t.reason.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <p className="text-ink-300">{t.detail}</p>
                        <div className="text-[11px] mono text-ink-400">
                          Vulnerabilities: {t.vulnerabilityIds.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assumptions */}
              {selectedPlan.assumptions && selectedPlan.assumptions.length > 0 && (
                <div className="p-4 rounded-xl bg-ink-900 border border-ink-700/50 text-xs space-y-2">
                  <div className="font-semibold text-ink-300 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-accent" />
                    Solver Assumptions
                  </div>
                  <ul className="space-y-1 text-ink-400 pl-4 list-disc">
                    {selectedPlan.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Record Decision Modal */}
      <AnimatePresence>
        {isRecordingDecision && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-ink-900 border border-ink-700/80 rounded-2xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink-50">
                  Record Triage Decision to Memory
                </h3>
                <button
                  onClick={() => setIsRecordingDecision(false)}
                  className="text-ink-400 hover:text-ink-100 text-sm"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleRecordDecision} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Decision Type
                  </label>
                  <select
                    value={decisionType}
                    onChange={(e) => setDecisionType(e.target.value as any)}
                    className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-accent"
                  >
                    <option value="plan_validated">Plan Validated (Approved for PR)</option>
                    <option value="accepted_risk">Accept Risk (Residual Vulnerabilities)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1">
                    Rationale / Audit Justification
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={decisionExplanation}
                    onChange={(e) => setDecisionExplanation(e.target.value)}
                    placeholder="Provide justification or test verification notes..."
                    className="w-full bg-ink-800 border border-ink-600 rounded-lg p-2.5 text-sm text-ink-100 focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsRecordingDecision(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={submittingDecision}
                  >
                    Save Decision
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

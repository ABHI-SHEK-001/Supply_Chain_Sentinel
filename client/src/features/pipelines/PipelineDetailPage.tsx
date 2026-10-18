import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  SkipForward,
  ScanLine,
  ShieldCheck,
  Wrench,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Code2,
  Layers,
  Copy,
  Check,
  Terminal,
  ShieldAlert,
  Sparkles,
  Zap,
  Brain,
  FileText,
} from 'lucide-react';
import { PageHeader, Card, ErrorState, Button, Badge } from '../../components/ui/shared';
import { getPipeline } from '../../api/pipelines';
import { cn, formatTimestamp, formatRelative, taskStatusBg, taskStatusColor, pipelineStatusBg, severityBadge } from '../../lib/utils';
import type { AgentTask, PipelineSnapshot } from '../../types/api';

const agentMeta: Record<string, { icon: typeof ScanLine; label: string; description: string; stepNumber: number }> = {
  scanner: { icon: ScanLine, label: 'Scanner Agent', description: 'Scans dependency graph & lockfile against OSV database', stepNumber: 1 },
  triager: { icon: ShieldCheck, label: 'Triager Agent', description: 'Evaluates graph reachability, policy suppressions & priority scoring', stepNumber: 2 },
  remediator: { icon: Wrench, label: 'Remediator Agent', description: 'Computes optimal semver upgrade plan & verifies breaking constraints', stepNumber: 3 },
};

export default function PipelineDetailPage() {
  const params = useParams<{ id?: string; pipelineId?: string }>();
  const pipelineId = params.id || params.pipelineId;
  const navigate = useNavigate();

  const [pipeline, setPipeline] = useState<PipelineSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedAgentIndex, setSelectedAgentIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'summary' | 'output' | 'input'>('summary');
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const isTerminal = (data: PipelineSnapshot | null) => {
    if (!data) return false;
    return data.status === 'succeeded' || data.status === 'failed';
  };

  // Fetch pipeline data
  const fetchPipeline = useCallback(async (isManual = false) => {
    if (!pipelineId) return;
    if (isManual) setRefreshing(true);
    try {
      const data = await getPipeline(pipelineId);
      setPipeline(data);
      setError(null);
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      if (isManual) {
        setTimeout(() => setRefreshing(false), 450);
      }
    }
  }, [pipelineId]);

  // Initial load
  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  // Auto-polling while running
  useEffect(() => {
    if (!pipeline || isTerminal(pipeline)) return;
    const interval = setInterval(() => {
      fetchPipeline();
    }, 2500);
    return () => clearInterval(interval);
  }, [pipeline, fetchPipeline]);

  // Default selected task when pipeline loads
  const tasks = pipeline?.tasks ?? [];
  const selectedTask: AgentTask | undefined = tasks[selectedAgentIndex] ?? tasks[0];

  const handleCopyPayload = (content: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(content, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  if (loading && !pipeline) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pipeline Detail" icon={<ScanLine className="w-5 h-5 text-accent" />} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="skeleton h-32 rounded-xl" />
          <div className="skeleton h-32 rounded-xl" />
          <div className="skeleton h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error && !pipeline) {
    return (
      <div>
        <PageHeader title="Pipeline Detail" icon={<ScanLine className="w-5 h-5 text-accent" />} />
        <ErrorState error={error} onRetry={() => fetchPipeline(true)} />
      </div>
    );
  }

  const finishedDuration = () => {
    if (!pipeline) return null;
    const firstTask = tasks[0];
    const lastTask = tasks[tasks.length - 1];
    if (firstTask?.startedAt && lastTask?.finishedAt) {
      const diffMs = new Date(lastTask.finishedAt).getTime() - new Date(firstTask.startedAt).getTime();
      return `${(diffMs / 1000).toFixed(1)}s`;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <button
          onClick={() => navigate('/scan')}
          className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent transition-colors py-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Scans
        </button>
      </div>

      {/* Main Header with working Refresh spinner */}
      <PageHeader
        title="Agent Execution Pipeline"
        description={`Pipeline ID: ${pipelineId}`}
        icon={<ScanLine className="w-5 h-5 text-accent" />}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-400 hidden sm:inline mr-1">
              Refreshed {formatRelative(lastRefreshedAt.toISOString())}
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin text-accent')} />}
              onClick={() => fetchPipeline(true)}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {pipeline && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Top Status & Meta Card */}
          <Card className="p-4 bg-ink-900 border-ink-700/60 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={cn(pipelineStatusBg(pipeline.status), 'text-xs font-semibold py-1 px-3 flex items-center gap-1.5')}>
                  {pipeline.status === 'succeeded' && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {pipeline.status === 'failed' && <XCircle className="w-3.5 h-3.5" />}
                  {pipeline.status === 'running' && <Activity className="w-3.5 h-3.5 animate-pulse" />}
                  <span className="capitalize">{pipeline.status}</span>
                </Badge>

                <div className="text-xs text-ink-300 flex items-center gap-1.5">
                  <span className="text-ink-400">Repository:</span>
                  <button
                    onClick={() => navigate(`/repositories/${pipeline.repositoryId}`)}
                    className="text-accent hover:underline mono font-semibold"
                  >
                    {pipeline.repositoryId}
                  </button>
                </div>

                <div className="text-xs text-ink-300 flex items-center gap-1.5">
                  <span className="text-ink-400">Started:</span>
                  <span className="mono">{formatTimestamp(pipeline.createdAt)}</span>
                </div>

                {finishedDuration() && (
                  <div className="text-xs text-ink-300 flex items-center gap-1.5">
                    <span className="text-ink-400">Total Duration:</span>
                    <span className="mono text-status-success font-medium">{finishedDuration()}</span>
                  </div>
                )}
              </div>

              {!isTerminal(pipeline) ? (
                <div className="flex items-center gap-2 text-xs text-status-running">
                  <Activity className="w-3.5 h-3.5 animate-pulse" />
                  <span>Pipeline active • Auto-polling</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  <span className="w-2 h-2 rounded-full bg-status-success" />
                  <span>Autonomous Pipeline Complete</span>
                </div>
              )}
            </div>
          </Card>

          {/* Interactive Agent Stage Cards (Scanner -> Triager -> Remediator) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {tasks.map((task, index) => {
              const meta = agentMeta[task.agent] ?? { icon: ScanLine, label: task.agent, description: '', stepNumber: index + 1 };
              const Icon = meta.icon;
              const isSelected = selectedAgentIndex === index;
              const isSucceeded = task.status === 'succeeded';
              const isRunning = task.status === 'running';
              const isSkipped = task.status === 'skipped';
              const isFailed = task.status === 'failed';

              return (
                <motion.div
                  key={task.id}
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.15 }}
                >
                  <button
                    onClick={() => setSelectedAgentIndex(index)}
                    className={cn(
                      'w-full text-left rounded-xl p-5 border transition-all duration-200 relative overflow-hidden',
                      isSelected
                        ? 'bg-ink-800/90 border-accent shadow-[0_0_15px_rgba(57,255,133,0.12)]'
                        : 'bg-ink-900 border-ink-700/60 hover:bg-ink-800/50 hover:border-ink-600/60',
                    )}
                  >
                    {/* Top colored status strip */}
                    <div
                      className={cn(
                        'absolute top-0 left-0 right-0 h-1',
                        isRunning && 'bg-status-running animate-pulse',
                        isSucceeded && 'bg-status-success',
                        isFailed && 'bg-status-failed',
                        isSkipped && 'bg-ink-600',
                      )}
                    />

                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'flex items-center justify-center w-10 h-10 rounded-xl transition-colors',
                            isSelected ? 'bg-accent/20 text-accent' : 'bg-ink-800 text-ink-300',
                          )}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-ink-50">{meta.label}</h4>
                          <p className="text-[11px] text-ink-400">Step {index + 1} of 3</p>
                        </div>
                      </div>

                      {/* Status Icon */}
                      {isSucceeded && <CheckCircle2 className="w-5 h-5 text-status-success" />}
                      {isFailed && <XCircle className="w-5 h-5 text-status-failed" />}
                      {isRunning && <Activity className="w-5 h-5 text-status-running animate-pulse" />}
                      {isSkipped && <SkipForward className="w-5 h-5 text-ink-400" />}
                    </div>

                    <p className="text-xs text-ink-400 line-clamp-2 mb-3">
                      {meta.description}
                    </p>

                    <div className="flex items-center justify-between text-xs pt-2 border-t border-ink-800">
                      <Badge className={taskStatusBg(task.status)}>
                        {task.status}
                      </Badge>

                      <span className="mono text-[11px] text-ink-400">
                        {task.finishedAt ? formatTimestamp(task.finishedAt) : 'Pending'}
                      </span>
                    </div>

                    {isSelected && (
                      <div className="mt-3 flex items-center justify-center gap-1 text-[11px] font-semibold text-accent pt-1">
                        <span>Viewing Stage Details</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>

          {/* Deep-Dive Agent Inspector Canvas */}
          {selectedTask && (
            <motion.div
              key={selectedTask.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl border border-ink-700/70 bg-ink-900/90 overflow-hidden shadow-2xl"
            >
              {/* Inspector Header with Tab Navigation */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-ink-700/60 bg-ink-950/60">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 text-accent">
                    {selectedTask.agent === 'scanner' && <ScanLine className="w-4 h-4" />}
                    {selectedTask.agent === 'triager' && <ShieldCheck className="w-4 h-4" />}
                    {selectedTask.agent === 'remediator' && <Wrench className="w-4 h-4" />}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ink-50 capitalize">
                      {selectedTask.agent} Agent Inspector
                    </h3>
                    <p className="text-xs text-ink-400 mono">
                      Task ID: {selectedTask.id}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-ink-800 p-1 rounded-lg border border-ink-700">
                  <button
                    onClick={() => setActiveTab('summary')}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded-md transition-all',
                      activeTab === 'summary' ? 'bg-accent/15 text-accent shadow' : 'text-ink-400 hover:text-ink-200',
                    )}
                  >
                    Summary
                  </button>
                  <button
                    onClick={() => setActiveTab('output')}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded-md transition-all',
                      activeTab === 'output' ? 'bg-accent/15 text-accent shadow' : 'text-ink-400 hover:text-ink-200',
                    )}
                  >
                    Output JSON
                  </button>
                  <button
                    onClick={() => setActiveTab('input')}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded-md transition-all',
                      activeTab === 'input' ? 'bg-accent/15 text-accent shadow' : 'text-ink-400 hover:text-ink-200',
                    )}
                  >
                    Input JSON
                  </button>
                </div>
              </div>

              {/* Inspector Body */}
              <div className="p-6">
                {activeTab === 'summary' && (
                  <div className="space-y-6">
                    {/* Triager Findings Section */}
                    {selectedTask.agent === 'triager' && (
                      <TriagerSummary output={selectedTask.output as any} onOpenVulns={() => navigate('/vulnerabilities')} />
                    )}

                    {/* Remediator Plan Section */}
                    {selectedTask.agent === 'remediator' && (
                      <RemediatorSummary
                        output={selectedTask.output as any}
                        detail={selectedTask.detail}
                        status={selectedTask.status}
                        onOpenPlan={() => navigate('/remediation')}
                        onOpenMemory={() => navigate('/memory')}
                      />
                    )}

                    {/* Scanner Section */}
                    {selectedTask.agent === 'scanner' && (
                      <ScannerSummary output={selectedTask.output as any} repositoryId={pipeline.repositoryId} />
                    )}

                    {/* Metadata strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-ink-950/60 border border-ink-800 text-xs">
                      <div>
                        <div className="text-ink-500 uppercase tracking-wider text-[10px]">Execution Status</div>
                        <div className="font-semibold text-ink-200 mt-0.5 capitalize">{selectedTask.status}</div>
                      </div>
                      <div>
                        <div className="text-ink-500 uppercase tracking-wider text-[10px]">Sequence</div>
                        <div className="font-semibold text-ink-200 mt-0.5">Stage {selectedTask.seq}</div>
                      </div>
                      <div>
                        <div className="text-ink-500 uppercase tracking-wider text-[10px]">Started At</div>
                        <div className="mono text-ink-300 mt-0.5">{formatTimestamp(selectedTask.startedAt)}</div>
                      </div>
                      <div>
                        <div className="text-ink-500 uppercase tracking-wider text-[10px]">Finished At</div>
                        <div className="mono text-ink-300 mt-0.5">{formatTimestamp(selectedTask.finishedAt)}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Raw Output Payload Tab */}
                {activeTab === 'output' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-400">Agent Output Payload</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={copiedPayload ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
                        onClick={() => handleCopyPayload(selectedTask.output)}
                      >
                        {copiedPayload ? 'Copied!' : 'Copy JSON'}
                      </Button>
                    </div>
                    <pre className="p-4 rounded-xl bg-ink-950 border border-ink-800 text-xs text-ink-200 mono overflow-x-auto max-h-[500px]">
                      {JSON.stringify(selectedTask.output, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Raw Input Payload Tab */}
                {activeTab === 'input' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-400">Agent Input Payload</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={copiedPayload ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
                        onClick={() => handleCopyPayload(selectedTask.input)}
                      >
                        {copiedPayload ? 'Copied!' : 'Copy JSON'}
                      </Button>
                    </div>
                    <pre className="p-4 rounded-xl bg-ink-950 border border-ink-800 text-xs text-ink-200 mono overflow-x-auto max-h-[500px]">
                      {JSON.stringify(selectedTask.input, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ── Scanner Summary Subcomponent ────────────────────────────
function ScannerSummary({ output, repositoryId }: { output: any; repositoryId: string }) {
  const vulnIds: string[] = output?.vulnerabilityIds ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-ink-800/50 border border-ink-700/40">
          <div className="text-xs text-ink-400">Matched Vulnerabilities</div>
          <div className="text-xl font-bold text-severity-high mt-1">{vulnIds.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-ink-800/50 border border-ink-700/40">
          <div className="text-xs text-ink-400">Target Ecosystem</div>
          <div className="text-xl font-bold text-ink-100 mt-1 capitalize">{output?.ecosystem || 'npm'}</div>
        </div>
        <div className="p-4 rounded-xl bg-ink-800/50 border border-ink-700/40">
          <div className="text-xs text-ink-400">Advisory Database</div>
          <div className="text-xl font-bold text-accent mt-1">OSV Live Feed</div>
        </div>
      </div>

      {vulnIds.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-ink-300 mb-2">Discovered Advisory Identifiers:</div>
          <div className="flex flex-wrap gap-2">
            {vulnIds.map((id) => (
              <span key={id} className="mono text-xs px-2.5 py-1 rounded bg-ink-800 border border-ink-700 text-ink-200">
                {id}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Triager Summary Subcomponent ────────────────────────────
function TriagerSummary({ output, onOpenVulns }: { output: any; onOpenVulns: () => void }) {
  const summary = output?.summary;
  const actionable: any[] = output?.actionable ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-ink-800/50 border border-ink-700/40">
          <div className="text-xs text-ink-400">Actionable Findings</div>
          <div className="text-xl font-bold text-severity-critical mt-1">{summary?.actionable ?? actionable.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-ink-800/50 border border-ink-700/40">
          <div className="text-xs text-ink-400">P1 High-Risk Targets</div>
          <div className="text-xl font-bold text-severity-high mt-1">{summary?.byPriority?.P1 ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl bg-ink-800/50 border border-ink-700/40">
          <div className="text-xs text-ink-400">Policy Suppressed</div>
          <div className="text-xl font-bold text-status-success mt-1">{summary?.suppressed ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl bg-ink-800/50 border border-ink-700/40 flex items-center justify-between">
          <div>
            <div className="text-xs text-ink-400">Triage Action</div>
            <div className="text-xs font-semibold text-accent mt-1">Exploration</div>
          </div>
          <Button variant="ghost" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />} onClick={onOpenVulns}>
            View
          </Button>
        </div>
      </div>

      {actionable.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-ink-300">Prioritized Actionable Findings ({actionable.length}):</div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {actionable.map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-ink-950/80 border border-ink-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Badge className={cn('text-xs mono font-bold', item.priority === 'P1' ? 'bg-severity-critical/15 text-severity-critical border-severity-critical/30' : 'bg-severity-medium/15 text-severity-medium')}>
                    {item.priority}
                  </Badge>
                  <span className="mono text-xs font-semibold text-ink-100">{item.vulnerabilityId}</span>
                  <span className="text-xs text-ink-400">• {item.name}@{item.version}</span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className={cn('px-2 py-0.5 rounded text-[11px] font-semibold', severityBadge(item.severityLabel))}>
                    {item.severityLabel}
                  </span>
                  <span className="mono text-ink-400 bg-ink-800 px-2 py-0.5 rounded text-[11px]">
                    Score: {item.score}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Remediator Summary Subcomponent ─────────────────────────
function RemediatorSummary({
  output,
  detail,
  status,
  onOpenPlan,
  onOpenMemory,
}: {
  output: any;
  detail: string | null;
  status: string;
  onOpenPlan: () => void;
  onOpenMemory: () => void;
}) {
  const hasPlan = Boolean(output?.planId);

  return (
    <div className="space-y-5">
      {hasPlan ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-status-success/5 border border-status-success/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <h4 className="text-sm font-bold text-ink-100">Optimal Remediation Plan Generated</h4>
                <Badge className="bg-status-success/15 text-status-success border-status-success/30">
                  {output.validationStatus ?? 'valid'}
                </Badge>
              </div>
              <p className="text-xs text-ink-400 mt-1 mono">
                Plan ID: {output.planId} • {output.upgradeCount} upgrade(s) computed
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />} onClick={onOpenPlan}>
                Inspect Plan
              </Button>
              {output.decisionId && (
                <Button variant="secondary" size="sm" icon={<Brain className="w-3.5 h-3.5" />} onClick={onOpenMemory}>
                  Audit Decision
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-ink-950 border border-ink-800 text-xs">
              <span className="text-ink-500">Plan Status</span>
              <div className="font-semibold text-ink-200 mt-0.5 capitalize">{output.planStatus}</div>
            </div>
            <div className="p-3 rounded-lg bg-ink-950 border border-ink-800 text-xs">
              <span className="text-ink-500">Optimality</span>
              <div className="font-semibold text-accent mt-0.5 capitalize">{output.optimality}</div>
            </div>
            <div className="p-3 rounded-lg bg-ink-950 border border-ink-800 text-xs">
              <span className="text-ink-500">Fully Resolves Targets</span>
              <div className="font-semibold text-status-success mt-0.5">{output.fullyResolvesTargets ? 'Yes (100%)' : 'No'}</div>
            </div>
            <div className="p-3 rounded-lg bg-ink-950 border border-ink-800 text-xs">
              <span className="text-ink-500">Audit Memory ID</span>
              <div className="font-semibold mono text-ink-300 mt-0.5 truncate">{output.decisionId ?? 'None'}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-ink-950 border border-ink-800 space-y-2">
          <div className="text-xs font-semibold text-ink-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-status-success" />
            Remediation Decision
          </div>
          <p className="text-xs text-ink-400">
            {detail || output?.message || 'No action needed or findings were skipped.'}
          </p>
        </div>
      )}
    </div>
  );
}

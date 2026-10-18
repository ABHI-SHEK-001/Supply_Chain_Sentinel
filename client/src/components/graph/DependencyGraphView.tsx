import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network,
  ShieldAlert,
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  Layers,
  ArrowRight,
  Maximize2,
  Minimize2,
  Package,
  ExternalLink,
  ChevronRight,
  Info,
  GitBranch,
  Sparkles,
} from 'lucide-react';
import { getRepositoryGraph } from '../../api/repositories';
import { Card, Badge, Button, Skeleton } from '../ui/shared';
import { cn, severityBadge } from '../../lib/utils';
import type { GraphView } from '../../types/api';

interface DependencyGraphViewProps {
  repositoryId: string;
  onSelectVulnerability?: (vulnId: string) => void;
  className?: string;
}

interface LayoutNode {
  id: string;
  name: string;
  version: string;
  ecosystem: string;
  direct: boolean;
  dev: boolean;
  optional: boolean;
  vulnerabilityIds: string[];
  depth: number;
  x: number;
  y: number;
}

export default function DependencyGraphView({
  repositoryId,
  onSelectVulnerability,
  className,
}: DependencyGraphViewProps) {
  const [graphData, setGraphData] = useState<GraphView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'vulnerable' | 'direct' | 'prod'>('all');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fetch graph data
  const fetchGraph = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRepositoryGraph(repositoryId);
      setGraphData(data);
      // Select first vulnerable node or first node by default
      const firstVuln = data.nodes.find((n) => n.vulnerabilityIds.length > 0);
      if (firstVuln) {
        setSelectedNodeId(firstVuln.id);
      } else if (data.nodes.length > 0) {
        setSelectedNodeId(data.nodes[0]!.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dependency graph');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (repositoryId) {
      fetchGraph();
    }
  }, [repositoryId]);

  // Compute depth and layered layout positions for nodes
  const layout = useMemo(() => {
    if (!graphData || !graphData.nodes.length) {
      return { nodes: [], edges: [], maxDepth: 0, width: 800, height: 500 };
    }

    const { nodes, edges } = graphData;
    const nodeMap = new Map<string, typeof nodes[0]>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    // Calculate depths via BFS starting from direct dependencies (roots)
    const depths = new Map<string, number>();
    const roots = nodes.filter((n) => n.direct);

    // If no direct nodes explicitly marked, treat all nodes with in-degree 0 as roots
    const targets = new Set(edges.map((e) => e.target));
    const effectiveRoots = roots.length > 0 ? roots : nodes.filter((n) => !targets.has(n.id));

    effectiveRoots.forEach((r) => depths.set(r.id, 0));

    // Adjacency list
    const adj = new Map<string, string[]>();
    edges.forEach((e) => {
      const list = adj.get(e.source) ?? [];
      list.push(e.target);
      adj.set(e.source, list);
    });

    // BFS queue
    const queue = [...effectiveRoots.map((r) => r.id)];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currDepth = depths.get(curr) ?? 0;
      const neighbors = adj.get(curr) ?? [];
      for (const nxt of neighbors) {
        if (!depths.has(nxt) || depths.get(nxt)! < currDepth + 1) {
          depths.set(nxt, currDepth + 1);
          queue.push(nxt);
        }
      }
    }

    // Default depth 0 for disconnected nodes
    nodes.forEach((n) => {
      if (!depths.has(n.id)) depths.set(n.id, 0);
    });

    // Group nodes by depth
    const levels = new Map<number, typeof nodes>();
    let maxDepth = 0;
    nodes.forEach((n) => {
      const d = depths.get(n.id) ?? 0;
      if (d > maxDepth) maxDepth = d;
      const list = levels.get(d) ?? [];
      list.push(n);
      levels.set(d, list);
    });

    // Calculate node (x, y) coordinates
    const layerWidth = 260;
    const nodeHeight = 85;
    const gapY = 24;
    const paddingX = 40;
    const paddingTop = 40;

    let maxNodesInLevel = 1;
    levels.forEach((list) => {
      if (list.length > maxNodesInLevel) maxNodesInLevel = list.length;
    });

    const totalWidth = Math.max(860, (maxDepth + 1) * layerWidth + paddingX * 2);
    const totalHeight = Math.max(500, maxNodesInLevel * (nodeHeight + gapY) + paddingTop * 2);

    const layoutNodes: LayoutNode[] = [];
    const layoutNodeMap = new Map<string, LayoutNode>();

    levels.forEach((levelNodes, depth) => {
      const totalLevelHeight = levelNodes.length * (nodeHeight + gapY) - gapY;
      const startY = Math.max(paddingTop, (totalHeight - totalLevelHeight) / 2);

      levelNodes.forEach((node, idx) => {
        const x = paddingX + depth * layerWidth;
        const y = startY + idx * (nodeHeight + gapY);
        const lNode: LayoutNode = {
          ...node,
          depth,
          x,
          y,
        };
        layoutNodes.push(lNode);
        layoutNodeMap.set(node.id, lNode);
      });
    });

    // Connect layout edges with source and target coordinates
    const layoutEdges = edges
      .map((edge) => {
        const source = layoutNodeMap.get(edge.source);
        const target = layoutNodeMap.get(edge.target);
        if (!source || !target) return null;
        return {
          ...edge,
          sourceNode: source,
          targetNode: target,
        };
      })
      .filter(Boolean) as Array<{
      source: string;
      target: string;
      kind: string;
      sourceNode: LayoutNode;
      targetNode: LayoutNode;
    }>;

    return {
      nodes: layoutNodes,
      edges: layoutEdges,
      maxDepth,
      width: totalWidth,
      height: totalHeight,
    };
  }, [graphData]);

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    return layout.nodes.filter((node) => {
      if (search) {
        const q = search.toLowerCase();
        if (!node.name.toLowerCase().includes(q) && !node.id.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (filterType === 'vulnerable' && node.vulnerabilityIds.length === 0) return false;
      if (filterType === 'direct' && !node.direct) return false;
      if (filterType === 'prod' && node.dev) return false;
      return true;
    });
  }, [layout.nodes, search, filterType]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  // Selected node
  const selectedNode = useMemo(() => {
    return layout.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [layout.nodes, selectedNodeId]);

  // Parents (Ancestors) & Children of selected node
  const relationships = useMemo(() => {
    if (!selectedNodeId || !graphData) return { parents: [], children: [] };
    const parents = graphData.edges
      .filter((e) => e.target === selectedNodeId)
      .map((e) => e.source);
    const children = graphData.edges
      .filter((e) => e.source === selectedNodeId)
      .map((e) => e.target);
    return { parents, children };
  }, [selectedNodeId, graphData]);

  return (
    <div
      className={cn(
        'rounded-2xl border border-ink-700/60 bg-ink-950 overflow-hidden flex flex-col transition-all duration-200',
        isFullscreen ? 'fixed inset-4 z-50 shadow-2xl' : 'relative',
        className,
      )}
    >
      {/* Top Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-ink-700/60 bg-ink-900/90 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 text-accent border border-accent/30">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink-50 flex items-center gap-2">
              Software Dependency Graph
              <Badge className="bg-ink-800 text-ink-300 border-ink-700 font-mono text-[10px]">
                {graphData?.nodes.length ?? 0} packages • {graphData?.edges.length ?? 0} relations
              </Badge>
            </h3>
            <p className="text-[11px] text-ink-400">
              Interactive topological dependency network from lockfile manifest
            </p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search package..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1 text-xs bg-ink-800 border border-ink-700 rounded-lg text-ink-100 placeholder-ink-500 focus:outline-none focus:border-accent w-36 sm:w-44"
            />
          </div>

          {/* Quick Filter buttons */}
          <div className="flex items-center bg-ink-800 p-0.5 rounded-lg border border-ink-700 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={cn(
                'px-2.5 py-1 rounded-md transition-colors',
                filterType === 'all' ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-400 hover:text-ink-200',
              )}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('vulnerable')}
              className={cn(
                'px-2.5 py-1 rounded-md transition-colors flex items-center gap-1',
                filterType === 'vulnerable' ? 'bg-severity-critical/20 text-severity-critical font-semibold' : 'text-ink-400 hover:text-ink-200',
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-severity-critical" />
              Vulnerable
            </button>
            <button
              onClick={() => setFilterType('direct')}
              className={cn(
                'px-2.5 py-1 rounded-md transition-colors',
                filterType === 'direct' ? 'bg-ink-700 text-ink-100 font-semibold' : 'text-ink-400 hover:text-ink-200',
              )}
            >
              Direct
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin text-accent')} />}
            onClick={fetchGraph}
            title="Refresh graph"
          />

          <Button
            variant="ghost"
            size="sm"
            icon={isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          />
        </div>
      </div>

      {/* Main Graph Content Area + Node Inspector Drawer */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden min-h-[480px]">
        {loading && !graphData ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
            <Network className="w-8 h-8 text-accent animate-pulse" />
            <p className="text-sm text-ink-300">Constructing topological dependency graph...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
            <ShieldAlert className="w-8 h-8 text-severity-critical" />
            <p className="text-sm font-semibold text-ink-100">{error}</p>
            <Button variant="secondary" size="sm" onClick={fetchGraph}>
              Retry
            </Button>
          </div>
        ) : !graphData || graphData.nodes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-ink-400">
            <Package className="w-8 h-8 text-ink-500 mb-2" />
            <p className="text-sm">No dependencies found in this repository manifest.</p>
          </div>
        ) : (
          <>
            {/* Scrollable Graph Canvas with SVG Connections */}
            <div className="flex-1 overflow-auto relative p-6 bg-[radial-gradient(#1f293d_1px,transparent_1px)] [background-size:20px_20px]">
              <div
                className="relative"
                style={{
                  width: `${layout.width}px`,
                  height: `${layout.height}px`,
                  minWidth: '100%',
                }}
              >
                {/* SVG Connections Layer */}
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={layout.width}
                  height={layout.height}
                  style={{ overflow: 'visible' }}
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#3a4257" />
                    </marker>
                    <marker
                      id="arrow-active"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#39ff85" />
                    </marker>
                  </defs>

                  {layout.edges.map((edge, idx) => {
                    const isRelated =
                      selectedNodeId === edge.source ||
                      selectedNodeId === edge.target ||
                      hoveredNodeId === edge.source ||
                      hoveredNodeId === edge.target;

                    const isDimmed =
                      (selectedNodeId || hoveredNodeId) && !isRelated;

                    // Compute curved bezier path between source right-edge and target left-edge
                    const sx = edge.sourceNode.x + 200;
                    const sy = edge.sourceNode.y + 35;
                    const tx = edge.targetNode.x;
                    const ty = edge.targetNode.y + 35;
                    const dx = Math.max(40, (tx - sx) / 2);

                    const path = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

                    return (
                      <g key={`edge-${idx}`}>
                        <path
                          d={path}
                          fill="none"
                          stroke={isRelated ? '#39ff85' : '#2b3447'}
                          strokeWidth={isRelated ? 2 : 1.2}
                          strokeDasharray={edge.kind === 'dev' ? '4 3' : undefined}
                          opacity={isDimmed ? 0.2 : 0.85}
                          markerEnd={isRelated ? 'url(#arrow-active)' : 'url(#arrow)'}
                          className="transition-all duration-150"
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* Nodes Layer */}
                {layout.nodes.map((node) => {
                  const isVisible = filteredNodeIds.has(node.id);
                  const isSelected = selectedNodeId === node.id;
                  const isHovered = hoveredNodeId === node.id;
                  const hasVulns = node.vulnerabilityIds.length > 0;
                  const isDimmed = !isVisible || ((selectedNodeId || hoveredNodeId) && !isSelected && !isHovered && !relationships.parents.includes(node.id) && !relationships.children.includes(node.id));

                  return (
                    <motion.div
                      key={node.id}
                      style={{
                        position: 'absolute',
                        left: `${node.x}px`,
                        top: `${node.y}px`,
                        width: '200px',
                      }}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: isDimmed ? 0.25 : 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <button
                        onClick={() => setSelectedNodeId(node.id)}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        className={cn(
                          'w-full text-left p-3 rounded-xl border transition-all duration-150 relative overflow-hidden backdrop-blur-md',
                          isSelected
                            ? 'bg-ink-800 border-accent shadow-[0_0_16px_rgba(57,255,133,0.2)]'
                            : hasVulns
                              ? 'bg-ink-900 border-severity-critical/50 hover:border-severity-critical shadow-[0_0_12px_rgba(255,71,87,0.15)]'
                              : 'bg-ink-900/90 border-ink-700/60 hover:bg-ink-800 hover:border-ink-500',
                          node.dev && 'border-dashed',
                        )}
                      >
                        {/* Top indicator tag */}
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={cn(
                              'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.2 rounded',
                              node.direct ? 'bg-accent/15 text-accent' : 'bg-ink-800 text-ink-400',
                            )}
                          >
                            {node.direct ? 'Direct' : 'Transitive'}
                          </span>

                          {hasVulns ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-severity-critical animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-severity-critical" />
                              {node.vulnerabilityIds.length} CVE
                            </span>
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-status-success" title="Clean" />
                          )}
                        </div>

                        {/* Package Name & Version */}
                        <div className="font-mono text-xs font-bold text-ink-100 truncate">
                          {node.name}
                        </div>
                        <div className="font-mono text-[11px] text-ink-400 truncate">
                          v{node.version}
                        </div>
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Right Node Inspector Drawer */}
            <AnimatePresence>
              {selectedNode && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-ink-700/60 bg-ink-900/95 p-5 space-y-4 overflow-y-auto max-h-[600px] shrink-0"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-accent" />
                        <h4 className="text-sm font-bold text-ink-50 mono break-all">
                          {selectedNode.name}
                        </h4>
                      </div>
                      <p className="text-xs text-ink-400 mono mt-0.5">
                        version {selectedNode.version} ({selectedNode.ecosystem})
                      </p>
                    </div>

                    <button
                      onClick={() => setSelectedNodeId(null)}
                      className="text-ink-400 hover:text-ink-100 text-xs p-1"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Attributes Matrix */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-ink-800/60 border border-ink-700/50">
                      <div className="text-[10px] uppercase text-ink-400">Dependency Type</div>
                      <div className="font-semibold text-ink-200 mt-0.5">
                        {selectedNode.direct ? 'Direct Import' : 'Transitive'}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-ink-800/60 border border-ink-700/50">
                      <div className="text-[10px] uppercase text-ink-400">Environment</div>
                      <div className="font-semibold text-ink-200 mt-0.5">
                        {selectedNode.dev ? 'DevDependency' : 'Production'}
                      </div>
                    </div>
                  </div>

                  {/* Vulnerabilities Alert Section */}
                  {selectedNode.vulnerabilityIds.length > 0 ? (
                    <div className="p-3 rounded-xl bg-severity-critical/10 border border-severity-critical/30 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-severity-critical">
                        <ShieldAlert className="w-4 h-4" />
                        <span>Security Advisories ({selectedNode.vulnerabilityIds.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {selectedNode.vulnerabilityIds.map((vulnId) => (
                          <div
                            key={vulnId}
                            className="flex items-center justify-between p-2 rounded bg-ink-950/80 border border-severity-critical/20 text-xs"
                          >
                            <span className="mono font-semibold text-severity-critical">
                              {vulnId}
                            </span>
                            {onSelectVulnerability ? (
                              <button
                                onClick={() => onSelectVulnerability(vulnId)}
                                className="text-[10px] text-accent hover:underline flex items-center gap-0.5"
                              >
                                View <ChevronRight className="w-3 h-3" />
                              </button>
                            ) : (
                              <a
                                href={`https://osv.dev/vulnerability/${vulnId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-accent hover:underline flex items-center gap-0.5"
                              >
                                OSV <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-status-success/10 border border-status-success/30 flex items-center gap-2 text-xs text-status-success">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>Zero known OSV security advisories reported for this package version.</span>
                    </div>
                  )}

                  {/* Relations: Ancestors & Descendants */}
                  <div className="space-y-3 pt-2 border-t border-ink-800 text-xs">
                    <div>
                      <span className="text-[11px] font-semibold text-ink-400 uppercase">
                        Imported By (Parents: {relationships.parents.length})
                      </span>
                      {relationships.parents.length === 0 ? (
                        <p className="text-ink-500 italic mt-1">None (Root application dependency)</p>
                      ) : (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {relationships.parents.map((p) => (
                            <button
                              key={p}
                              onClick={() => setSelectedNodeId(p)}
                              className="mono text-[11px] px-2 py-0.5 rounded bg-ink-800 border border-ink-700 text-ink-300 hover:text-accent hover:border-accent transition-colors"
                            >
                              {p.replace(/^npm:/, '')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-ink-400 uppercase">
                        Transitive Sub-dependencies ({relationships.children.length})
                      </span>
                      {relationships.children.length === 0 ? (
                        <p className="text-ink-500 italic mt-1">No sub-dependencies (Leaf node)</p>
                      ) : (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {relationships.children.map((c) => (
                            <button
                              key={c}
                              onClick={() => setSelectedNodeId(c)}
                              className="mono text-[11px] px-2 py-0.5 rounded bg-ink-800 border border-ink-700 text-ink-300 hover:text-accent hover:border-accent transition-colors"
                            >
                              {c.replace(/^npm:/, '')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}

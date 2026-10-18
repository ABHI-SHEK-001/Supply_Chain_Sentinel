import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Move,
  Compass,
  AlertTriangle,
  Eye,
  MapPin,
  Route,
  Activity,
  SlidersHorizontal,
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
  const [showMinimap, setShowMinimap] = useState(true);

  // Pan & Zoom state
  const [pan, setPan] = useState({ x: 60, y: 40 });
  const [zoom, setZoom] = useState(0.85);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch graph data
  const fetchGraph = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRepositoryGraph(repositoryId);
      setGraphData(data);
      // Select first vulnerable node or first direct node by default
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

  // Compute depth and smart balanced column layout
  const layout = useMemo(() => {
    if (!graphData || !graphData.nodes.length) {
      return {
        nodes: [],
        edges: [],
        maxDepth: 0,
        width: 1200,
        height: 700,
        directCount: 0,
        transitiveCount: 0,
        vulnNodesCount: 0,
      };
    }

    const { nodes, edges } = graphData;
    const nodeMap = new Map<string, typeof nodes[0]>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    let directCount = 0;
    let transitiveCount = 0;
    let vulnNodesCount = 0;

    nodes.forEach((n) => {
      if (n.direct) directCount++;
      else transitiveCount++;
      if (n.vulnerabilityIds.length > 0) vulnNodesCount++;
    });

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

    // Smart Multi-Column Configuration
    // Keeps large dependency trees (like 250+ packages) from stretching 15,000px vertically!
    const MAX_PER_SUBCOL = 8;
    const nodeWidth = 230;
    const nodeHeight = 90;
    const gapX = 36;
    const gapY = 24;
    const tierGap = 90; // gap between major depth levels
    const paddingX = 70;
    const paddingTop = 70;

    let currentX = paddingX;
    let maxLayoutHeight = 500;

    const layoutNodes: LayoutNode[] = [];
    const layoutNodeMap = new Map<string, LayoutNode>();

    for (let d = 0; d <= maxDepth; d++) {
      const levelNodes = levels.get(d) ?? [];
      if (levelNodes.length === 0) continue;

      const subCols = Math.ceil(levelNodes.length / MAX_PER_SUBCOL);
      const levelHeight = Math.min(levelNodes.length, MAX_PER_SUBCOL) * (nodeHeight + gapY) + paddingTop * 2;
      if (levelHeight > maxLayoutHeight) maxLayoutHeight = levelHeight;

      levelNodes.forEach((node, idx) => {
        const subColIdx = Math.floor(idx / MAX_PER_SUBCOL);
        const rowIdx = idx % MAX_PER_SUBCOL;

        const x = currentX + subColIdx * (nodeWidth + gapX);
        const y = paddingTop + rowIdx * (nodeHeight + gapY);

        const lNode: LayoutNode = {
          ...node,
          depth: d,
          x,
          y,
        };
        layoutNodes.push(lNode);
        layoutNodeMap.set(node.id, lNode);
      });

      currentX += subCols * (nodeWidth + gapX) + tierGap;
    }

    const totalWidth = Math.max(1300, currentX + paddingX);
    const totalHeight = Math.max(680, maxLayoutHeight + 80);

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
      directCount,
      transitiveCount,
      vulnNodesCount,
    };
  }, [graphData]);

  // Fit to screen calculation
  const fitToView = useCallback(() => {
    if (!containerRef.current || !layout.nodes.length) return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth === 0 || clientHeight === 0) return;

    const padding = 70;
    const scaleX = (clientWidth - padding) / layout.width;
    const scaleY = (clientHeight - padding) / layout.height;
    const fitZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 1.05);

    const fitPanX = Math.max(20, (clientWidth - layout.width * fitZoom) / 2);
    const fitPanY = Math.max(20, (clientHeight - layout.height * fitZoom) / 2);

    setZoom(Number(fitZoom.toFixed(2)));
    setPan({ x: Math.round(fitPanX), y: Math.round(fitPanY) });
  }, [layout.nodes.length, layout.width, layout.height]);

  // Auto-fit on initial graph load
  useEffect(() => {
    if (layout.nodes.length > 0) {
      fitToView();
    }
  }, [layout.nodes.length, fitToView]);

  // Center on a specific node smoothly
  const centerOnNode = useCallback(
    (nodeId: string) => {
      const node = layout.nodes.find((n) => n.id === nodeId);
      if (!node || !containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const targetZoom = Math.max(zoom, 0.85);
      const newPanX = clientWidth / 2 - (node.x + 115) * targetZoom;
      const newPanY = clientHeight / 2 - (node.y + 45) * targetZoom;
      setZoom(targetZoom);
      setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
    },
    [layout.nodes, zoom],
  );

  // Pan interaction handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.interactive-control')) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { x: pan.x, y: pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Wheel zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    const newZoom = Math.min(Math.max(Number((zoom * zoomFactor).toFixed(2)), 0.18), 2.5);

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
    const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

    setZoom(newZoom);
    setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
  };

  const handleZoomIn = () => {
    const newZoom = Math.min(Number((zoom * 1.25).toFixed(2)), 2.5);
    setZoom(newZoom);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(Number((zoom * 0.8).toFixed(2)), 0.18);
    setZoom(newZoom);
  };

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
    if (!selectedNodeId || !graphData) return { parents: [], children: [], rootPaths: [] };
    const parents = graphData.edges
      .filter((e) => e.target === selectedNodeId)
      .map((e) => e.source);
    const children = graphData.edges
      .filter((e) => e.source === selectedNodeId)
      .map((e) => e.target);

    // Compute supply chain attack path from root to current node
    const paths: string[][] = [];
    const visited = new Set<string>();

    function traceBack(curr: string, currentPath: string[]) {
      if (currentPath.length > 5 || visited.has(curr)) return;
      visited.add(curr);
      const upstream = graphData!.edges.filter((e) => e.target === curr).map((e) => e.source);
      if (upstream.length === 0) {
        paths.push([curr, ...currentPath]);
      } else {
        for (const p of upstream) {
          traceBack(p, [curr, ...currentPath]);
        }
      }
    }
    traceBack(selectedNodeId, []);

    return { parents, children, rootPaths: paths.slice(0, 3) };
  }, [selectedNodeId, graphData]);

  // Mini-map click to teleport pan
  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;

    const targetWorldX = clickX * layout.width;
    const targetWorldY = clickY * layout.height;

    const newPanX = clientWidth / 2 - targetWorldX * zoom;
    const newPanY = clientHeight / 2 - targetWorldY * zoom;

    setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
  };

  return (
    <div
      className={cn(
        'rounded-2xl border border-ink-700/80 bg-ink-950 overflow-hidden flex flex-col shadow-2xl transition-all duration-200 select-none',
        isFullscreen ? 'fixed inset-2 z-50 rounded-2xl' : 'relative',
        className,
      )}
    >
      {/* Top Header & Command Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 border-b border-ink-700/80 bg-ink-900/95 backdrop-blur-xl z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-accent/15 text-accent border border-accent/40 shadow-[0_0_15px_rgba(57,255,133,0.2)]">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                Topological Dependency Matrix
              </h3>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-ink-800 text-ink-300 border border-ink-700">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                {graphData?.nodes.length ?? 0} packages • {graphData?.edges.length ?? 0} relations
              </span>
            </div>
            <p className="text-[11px] text-ink-400 mt-0.5">
              Live software supply chain dependency graph with interactive pan, zoom, and vulnerability analysis
            </p>
          </div>
        </div>

        {/* Search, Filter Pills & Canvas Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search box with auto-select on enter */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search package..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filteredNodes.length > 0) {
                  setSelectedNodeId(filteredNodes[0]!.id);
                  centerOnNode(filteredNodes[0]!.id);
                }
              }}
              className="pl-8 pr-3 py-1.5 text-xs bg-ink-800/90 border border-ink-700 focus:border-accent rounded-lg text-white placeholder-ink-400 focus:outline-none w-36 sm:w-48 transition-colors shadow-inner"
            />
            {search && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-accent font-mono font-bold">
                {filteredNodes.length}
              </span>
            )}
          </div>

          {/* Quick Filter buttons */}
          <div className="flex items-center bg-ink-800/80 p-0.5 rounded-lg border border-ink-700 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={cn(
                'px-2.5 py-1 rounded-md transition-all font-medium',
                filterType === 'all'
                  ? 'bg-accent/20 text-accent font-semibold shadow-sm'
                  : 'text-ink-300 hover:text-white',
              )}
            >
              All ({layout.nodes.length})
            </button>
            <button
              onClick={() => setFilterType('vulnerable')}
              className={cn(
                'px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 font-medium',
                filterType === 'vulnerable'
                  ? 'bg-rose-500/25 text-rose-300 font-semibold shadow-sm border border-rose-500/30'
                  : 'text-ink-300 hover:text-rose-400',
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              Vulnerable ({layout.vulnNodesCount})
            </button>
            <button
              onClick={() => setFilterType('direct')}
              className={cn(
                'px-2.5 py-1 rounded-md transition-all font-medium',
                filterType === 'direct'
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
                  : 'text-ink-300 hover:text-white',
              )}
            >
              Direct ({layout.directCount})
            </button>
          </div>

          {/* Mini-map toggle */}
          <Button
            variant="ghost"
            size="sm"
            icon={<MapPin className={cn('w-3.5 h-3.5', showMinimap && 'text-accent')} />}
            onClick={() => setShowMinimap(!showMinimap)}
            title={showMinimap ? 'Hide Mini-Map' : 'Show Mini-Map'}
          />

          {/* Refresh button */}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin text-accent')} />}
            onClick={fetchGraph}
            title="Refresh graph"
          />

          {/* Fullscreen toggle */}
          <Button
            variant="ghost"
            size="sm"
            icon={isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          />
        </div>
      </div>

      {/* Main Interactive Graph Viewport + Drawer */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden min-h-[580px]">
        {loading && !graphData ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4 bg-ink-950">
            <div className="relative">
              <Network className="w-12 h-12 text-accent animate-pulse" />
              <div className="absolute inset-0 rounded-full blur-xl bg-accent/20 animate-ping" />
            </div>
            <div>
              <p className="text-base font-semibold text-white">Constructing Topological Dependency Matrix...</p>
              <p className="text-xs text-ink-400 mt-1">Traversing FalkorDB manifest nodes and OSV intelligence vectors</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-3 bg-ink-950">
            <ShieldAlert className="w-12 h-12 text-severity-critical" />
            <p className="text-base font-semibold text-white">{error}</p>
            <p className="text-xs text-ink-400">Unable to query graph relationships for repository.</p>
            <Button variant="secondary" size="sm" onClick={fetchGraph}>
              Retry Query
            </Button>
          </div>
        ) : !graphData || graphData.nodes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-ink-400 bg-ink-950">
            <Package className="w-12 h-12 text-ink-600 mb-3" />
            <p className="text-base font-semibold text-ink-200">No Dependencies Detected</p>
            <p className="text-xs text-ink-500 mt-1">This repository lockfile does not contain parsed dependencies.</p>
          </div>
        ) : (
          <>
            {/* Interactive Canvas Container (Handles Pan & Zoom Dragging) */}
            <div
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
              className={cn(
                'flex-1 relative overflow-hidden bg-ink-950',
                isDragging ? 'cursor-grabbing' : 'cursor-grab',
              )}
              style={{
                backgroundImage: `
                  radial-gradient(circle at 50% 50%, rgba(57, 255, 133, 0.04) 0%, transparent 70%),
                  radial-gradient(rgba(59, 130, 246, 0.15) 1px, transparent 1px)
                `,
                backgroundSize: '100% 100%, 28px 28px',
              }}
            >
              {/* Floating Canvas Controls Overlay (Zoom In, Out, Fit, Center) */}
              <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 p-1.5 rounded-xl bg-ink-900/90 border border-ink-700/80 shadow-2xl backdrop-blur-md interactive-control">
                <button
                  onClick={handleZoomIn}
                  className="p-1.5 rounded-lg text-ink-300 hover:text-white hover:bg-ink-800 transition-colors"
                  title="Zoom In (+)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={handleZoomOut}
                  className="p-1.5 rounded-lg text-ink-300 hover:text-white hover:bg-ink-800 transition-colors"
                  title="Zoom Out (-)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-ink-700 mx-0.5" />
                <button
                  onClick={fitToView}
                  className="px-2 py-1 rounded-lg text-xs font-semibold text-accent hover:bg-accent/15 transition-colors flex items-center gap-1"
                  title="Fit whole graph to screen"
                >
                  <Compass className="w-3.5 h-3.5" />
                  Fit View
                </button>
                <div className="w-px h-4 bg-ink-700 mx-0.5" />
                <span className="px-2 text-[11px] font-mono text-ink-300">
                  {Math.round(zoom * 100)}%
                </span>
              </div>

              {/* Bottom Instructions Badge & Legend */}
              <div className="absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-3 p-2 rounded-xl bg-ink-900/90 border border-ink-700/80 text-[11px] backdrop-blur-md shadow-xl interactive-control">
                <div className="flex items-center gap-1.5 text-ink-400 pr-2 border-r border-ink-800">
                  <Move className="w-3.5 h-3.5 text-accent" />
                  <span>Drag to pan • Scroll to zoom</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-emerald-300 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" /> Direct
                  </span>
                  <span className="flex items-center gap-1.5 text-cyan-300 font-medium">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" /> Transitive
                  </span>
                  <span className="flex items-center gap-1.5 text-rose-300 font-medium">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> Vulnerable
                  </span>
                </div>
              </div>

              {/* Floating Interactive Mini-Map (Radar View) */}
              <AnimatePresence>
                {showMinimap && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={handleMinimapClick}
                    className="absolute bottom-4 right-4 z-20 w-44 h-28 rounded-xl bg-ink-900/90 border border-ink-700/80 backdrop-blur-md shadow-2xl p-1.5 cursor-crosshair overflow-hidden interactive-control"
                    title="Click radar to navigate"
                  >
                    <div className="relative w-full h-full bg-ink-950/80 rounded-lg overflow-hidden border border-ink-800/80">
                      {/* Mini nodes preview */}
                      {layout.nodes.map((n) => {
                        const nx = (n.x / layout.width) * 100;
                        const ny = (n.y / layout.height) * 100;
                        const hasVuln = n.vulnerabilityIds.length > 0;
                        return (
                          <div
                            key={`mini-${n.id}`}
                            className={cn(
                              'absolute w-1 h-1 rounded-full -translate-x-1/2 -translate-y-1/2',
                              hasVuln
                                ? 'bg-rose-500 ring-1 ring-rose-400 shadow-[0_0_4px_#ff4757]'
                                : n.direct
                                  ? 'bg-emerald-400'
                                  : 'bg-cyan-500/70',
                            )}
                            style={{ left: `${nx}%`, top: `${ny}%` }}
                          />
                        );
                      })}

                      {/* Viewport Indicator Rectangle */}
                      {containerRef.current && (
                        <div
                          className="absolute border border-accent/80 bg-accent/10 rounded shadow-[0_0_8px_rgba(57,255,133,0.3)] pointer-events-none transition-all duration-75"
                          style={{
                            left: `${Math.max(0, (-pan.x / (layout.width * zoom)) * 100)}%`,
                            top: `${Math.max(0, (-pan.y / (layout.height * zoom)) * 100)}%`,
                            width: `${Math.min(100, (containerRef.current.clientWidth / (layout.width * zoom)) * 100)}%`,
                            height: `${Math.min(100, (containerRef.current.clientHeight / (layout.height * zoom)) * 100)}%`,
                          }}
                        />
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Transformed Canvas (Pan & Zoom wrapper) */}
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  transition: isDragging ? 'none' : 'transform 0.12s ease-out',
                  width: `${layout.width}px`,
                  height: `${layout.height}px`,
                  position: 'relative',
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
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>

                    <marker
                      id="arrow-default"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#475569" />
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

                    <marker
                      id="arrow-vuln"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#ff4757" />
                    </marker>
                  </defs>

                  {/* Render Connections */}
                  {layout.edges.map((edge, idx) => {
                    const isRelated =
                      selectedNodeId === edge.source ||
                      selectedNodeId === edge.target ||
                      hoveredNodeId === edge.source ||
                      hoveredNodeId === edge.target;

                    const isDimmed = (selectedNodeId || hoveredNodeId) && !isRelated;
                    const targetHasVulns = edge.targetNode.vulnerabilityIds.length > 0;

                    const sx = edge.sourceNode.x + 230;
                    const sy = edge.sourceNode.y + 45;
                    const tx = edge.targetNode.x;
                    const ty = edge.targetNode.y + 45;
                    const dx = Math.max(50, (tx - sx) * 0.45);

                    const path = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

                    let strokeColor = '#334155';
                    let markerEnd = 'url(#arrow-default)';
                    let strokeWidth = 1.4;

                    if (isRelated) {
                      if (targetHasVulns) {
                        strokeColor = '#ff4757';
                        markerEnd = 'url(#arrow-vuln)';
                      } else {
                        strokeColor = '#39ff85';
                        markerEnd = 'url(#arrow-active)';
                      }
                      strokeWidth = 2.5;
                    }

                    return (
                      <g key={`edge-${idx}`}>
                        <path
                          d={path}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeDasharray={edge.kind === 'dev' ? '5 4' : undefined}
                          opacity={isDimmed ? 0.12 : isRelated ? 1 : 0.65}
                          markerEnd={markerEnd}
                          filter={isRelated ? 'url(#glow)' : undefined}
                          className="transition-all duration-200"
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
                  const isRelated =
                    isSelected ||
                    isHovered ||
                    relationships.parents.includes(node.id) ||
                    relationships.children.includes(node.id);

                  const isDimmed = !isVisible || ((selectedNodeId || hoveredNodeId) && !isRelated);

                  return (
                    <div
                      key={node.id}
                      style={{
                        position: 'absolute',
                        left: `${node.x}px`,
                        top: `${node.y}px`,
                        width: '230px',
                        zIndex: isSelected ? 30 : isHovered ? 25 : 10,
                      }}
                      className={cn(
                        'transition-all duration-150',
                        isDimmed && 'opacity-20 pointer-events-none',
                      )}
                    >
                      <button
                        onClick={() => setSelectedNodeId(node.id)}
                        onDoubleClick={() => centerOnNode(node.id)}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        className={cn(
                          'w-full text-left p-3 rounded-xl border transition-all duration-150 relative overflow-hidden backdrop-blur-xl group cursor-pointer',
                          isSelected
                            ? 'bg-ink-850 border-accent shadow-[0_0_24px_rgba(57,255,133,0.35)] ring-2 ring-accent scale-[1.03]'
                            : hasVulns
                              ? 'bg-gradient-to-br from-rose-950/70 via-ink-900 to-ink-950 border-rose-500/70 hover:border-rose-400 shadow-[0_0_16px_rgba(244,63,94,0.25)] hover:scale-[1.02]'
                              : node.direct
                                ? 'bg-gradient-to-br from-emerald-950/40 via-ink-900 to-ink-950 border-emerald-500/50 hover:border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)] hover:scale-[1.02]'
                                : 'bg-gradient-to-br from-slate-900/90 via-ink-900 to-ink-950 border-ink-600/80 hover:border-cyan-400/80 hover:shadow-[0_0_15px_rgba(6,182,212,0.2)] hover:scale-[1.02]',
                          node.dev && 'border-dashed',
                        )}
                      >
                        {/* Status bar header */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className={cn(
                              'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border',
                              node.direct
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
                            )}
                          >
                            {node.direct ? 'Direct' : 'Transitive'}
                          </span>

                          {hasVulns ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/25 border border-rose-500/50 text-[10px] font-bold text-rose-300 animate-pulse shadow-sm">
                              <ShieldAlert className="w-3 h-3 text-rose-400" />
                              {node.vulnerabilityIds.length} CVE
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Clean
                            </span>
                          )}
                        </div>

                        {/* Package Name (High Contrast White) */}
                        <div
                          className="font-mono text-xs font-bold text-white truncate tracking-tight group-hover:text-accent transition-colors"
                          title={node.name}
                        >
                          {node.name}
                        </div>

                        {/* Version and Dev tags */}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-[11px] text-ink-300 bg-ink-800/90 px-1.5 py-0.2 rounded border border-ink-700/70 font-semibold truncate">
                            v{node.version}
                          </span>
                          {node.dev && (
                            <span className="text-[10px] text-amber-400/90 bg-amber-500/10 px-1.5 py-0.2 rounded font-mono border border-amber-500/20">
                              dev
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Node Inspector Drawer */}
            <AnimatePresence>
              {selectedNode && (
                <motion.div
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  className="w-full lg:w-92 border-t lg:border-t-0 lg:border-l border-ink-700/80 bg-ink-900/95 backdrop-blur-2xl p-5 space-y-4 overflow-y-auto max-h-[640px] shrink-0 z-20 shadow-2xl"
                >
                  {/* Top Node Header */}
                  <div className="flex items-start justify-between pb-3 border-b border-ink-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-accent" />
                        <h4 className="text-sm font-bold text-white font-mono break-all">
                          {selectedNode.name}
                        </h4>
                      </div>
                      <p className="text-xs text-ink-300 font-mono mt-0.5">
                        version <span className="text-white font-semibold">{selectedNode.version}</span> • {selectedNode.ecosystem}
                      </p>
                    </div>

                    <button
                      onClick={() => setSelectedNodeId(null)}
                      className="text-ink-400 hover:text-white text-xs p-1.5 rounded-lg hover:bg-ink-800 transition-colors"
                      title="Close inspector"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Focus on Node Button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-center text-xs font-semibold"
                    icon={<Eye className="w-3.5 h-3.5 text-accent" />}
                    onClick={() => centerOnNode(selectedNode.id)}
                  >
                    Center Node in Canvas
                  </Button>

                  {/* Attributes Matrix */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-ink-800/80 border border-ink-700/60">
                      <div className="text-[10px] uppercase font-semibold text-ink-400">Dependency Type</div>
                      <div className="font-bold text-white mt-0.5 flex items-center gap-1.5">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full',
                            selectedNode.direct ? 'bg-emerald-400' : 'bg-cyan-400',
                          )}
                        />
                        {selectedNode.direct ? 'Direct Import' : 'Transitive'}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-ink-800/80 border border-ink-700/60">
                      <div className="text-[10px] uppercase font-semibold text-ink-400">Scope</div>
                      <div className="font-bold text-white mt-0.5">
                        {selectedNode.dev ? 'DevDependency' : 'Production'}
                      </div>
                    </div>
                  </div>

                  {/* Supply Chain Trace Breadcrumb */}
                  {relationships.rootPaths.length > 0 && !selectedNode.direct && (
                    <div className="p-3 rounded-xl bg-ink-950/80 border border-ink-700/70 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-accent">
                        <Route className="w-3.5 h-3.5" />
                        <span>Supply Chain Import Path</span>
                      </div>
                      <div className="space-y-1">
                        {relationships.rootPaths.map((path, pIdx) => (
                          <div key={pIdx} className="flex flex-wrap items-center gap-1 text-[11px] font-mono">
                            {path.map((step, sIdx) => (
                              <React.Fragment key={step}>
                                <button
                                  onClick={() => {
                                    setSelectedNodeId(step);
                                    centerOnNode(step);
                                  }}
                                  className={cn(
                                    'px-1.5 py-0.5 rounded transition-colors',
                                    step === selectedNode.id
                                      ? 'bg-accent/20 text-accent font-bold'
                                      : 'bg-ink-800 text-ink-300 hover:text-white',
                                  )}
                                >
                                  {step.replace(/^npm:/, '').split('@')[0]}
                                </button>
                                {sIdx < path.length - 1 && (
                                  <ChevronRight className="w-3 h-3 text-ink-500" />
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Vulnerabilities Alert Section */}
                  {selectedNode.vulnerabilityIds.length > 0 ? (
                    <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-2.5 shadow-lg">
                      <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
                        <ShieldAlert className="w-4 h-4 text-rose-400" />
                        <span>Security Advisories ({selectedNode.vulnerabilityIds.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {selectedNode.vulnerabilityIds.map((vulnId) => (
                          <div
                            key={vulnId}
                            className="flex items-center justify-between p-2 rounded-lg bg-ink-950 border border-rose-500/25 text-xs shadow-inner"
                          >
                            <span className="font-mono font-bold text-rose-300">
                              {vulnId}
                            </span>
                            {onSelectVulnerability ? (
                              <button
                                onClick={() => onSelectVulnerability(vulnId)}
                                className="text-[11px] font-semibold text-accent hover:underline flex items-center gap-0.5"
                              >
                                View <ChevronRight className="w-3 h-3" />
                              </button>
                            ) : (
                              <a
                                href={`https://osv.dev/vulnerability/${vulnId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-semibold text-accent hover:underline flex items-center gap-0.5"
                              >
                                Advisory <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center gap-2.5 text-xs text-emerald-300 font-medium">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Zero known OSV security advisories reported for this package version.</span>
                    </div>
                  )}

                  {/* Relations: Ancestors & Descendants */}
                  <div className="space-y-3 pt-3 border-t border-ink-800 text-xs">
                    <div>
                      <span className="text-[11px] font-bold text-ink-300 uppercase tracking-wider flex items-center justify-between">
                        <span>Imported By (Parents)</span>
                        <span className="text-ink-400 font-mono font-normal">{relationships.parents.length}</span>
                      </span>
                      {relationships.parents.length === 0 ? (
                        <p className="text-ink-500 italic mt-1 text-[11px]">None (Root application dependency)</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {relationships.parents.map((p) => (
                            <button
                              key={p}
                              onClick={() => {
                                setSelectedNodeId(p);
                                centerOnNode(p);
                              }}
                              className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-ink-800 border border-ink-700/80 text-ink-200 hover:text-white hover:border-accent hover:bg-ink-750 transition-all shadow-sm"
                            >
                              {p.replace(/^npm:/, '')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-[11px] font-bold text-ink-300 uppercase tracking-wider flex items-center justify-between">
                        <span>Sub-dependencies</span>
                        <span className="text-ink-400 font-mono font-normal">{relationships.children.length}</span>
                      </span>
                      {relationships.children.length === 0 ? (
                        <p className="text-ink-500 italic mt-1 text-[11px]">No sub-dependencies (Leaf package)</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {relationships.children.map((c) => (
                            <button
                              key={c}
                              onClick={() => {
                                setSelectedNodeId(c);
                                centerOnNode(c);
                              }}
                              className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-ink-800 border border-ink-700/80 text-ink-200 hover:text-white hover:border-accent hover:bg-ink-750 transition-all shadow-sm"
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

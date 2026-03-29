'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';

export interface ThemeOverlapNode {
  id: string;
  label: string;
}

export interface ThemeOverlapEdge {
  source: string;
  target: string;
  weight: number;
}

export interface ThemeOverlapData {
  nodes: ThemeOverlapNode[];
  edges: ThemeOverlapEdge[];
  min_shared: number;
  max_shared: number;
}

/** Interpolate weight to color: dark blue (low) -> light blue -> yellow/orange -> dark red/brown (high) */
function weightToColor(weight: number, minW: number, maxW: number): string {
  if (maxW <= minW) return '#2166ac';
  const t = Math.max(0, Math.min(1, (weight - minW) / (maxW - minW)));
  const hex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  if (t <= 0.33) {
    const u = t / 0.33;
    const r = 33 + u * (78 - 33);
    const g = 102 + u * (205 - 102);
    const b = 172 + u * (230 - 172);
    return hex(r, g, b);
  }
  if (t <= 0.66) {
    const u = (t - 0.33) / 0.33;
    const r = 78 + u * (252 - 78);
    const g = 205 + u * (174 - 205);
    const b = 230 + u * (96 - 230);
    return hex(r, g, b);
  }
  const u = (t - 0.66) / 0.34;
  const r = 252 + u * (178 - 252);
  const g = 174 + u * (24 - 174);
  const b = 96 + u * (43 - 96);
  return hex(r, g, b);
}

interface ThemeOverlapNetworkProps {
  data: ThemeOverlapData | null;
  loading?: boolean;
  className?: string;
}

export default function ThemeOverlapNetwork({ data, loading, className = '' }: ThemeOverlapNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<{ destroy: () => void; png: (opts?: { scale?: number; full?: boolean }) => string } | null>(null);
  const [downloadReady, setDownloadReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [threshold, setThreshold] = useState(0);
  const [selectedEdge, setSelectedEdge] = useState<{ sourceLabel: string; targetLabel: string; weight: number } | null>(null);

  const filteredEdges = useMemo(() => {
    if (!data || !data.edges.length) return [];
    return data.edges.filter((e) => e.weight >= threshold);
  }, [data, threshold]);

  useEffect(() => {
    setSelectedEdge(null);
  }, [threshold]);

  const { minS, maxS } = useMemo(() => {
    if (!data || filteredEdges.length === 0) return { minS: 0, maxS: 1 };
    const weights = filteredEdges.map((e) => e.weight);
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    return { minS: minW, maxS: Math.max(maxW, minW + 1) };
  }, [data, filteredEdges]);

  const initCy = useCallback(() => {
    if (!data || !containerRef.current || typeof window === 'undefined') return;
    const nodes = data.nodes;
    const edges = filteredEdges;
    if (nodes.length === 0) return;

    import('cytoscape').then((cytoscapeLib) => {
      const cy = cytoscapeLib.default;
      if (!cy || !containerRef.current) return;

      const edgeElements = edges.map((e, i) => {
        const w = e.weight;
        const lineColor = weightToColor(w, minS, maxS);
        const t = maxS > minS ? (w - minS) / (maxS - minS) : 0.5;
        const lineWidth = 1 + t * 4;
        return {
          data: {
            id: `e-${e.source}-${e.target}-${i}`,
            source: e.source,
            target: e.target,
            weight: w,
            lineColor,
            lineWidth,
          },
        };
      });

      const elements = [
        ...nodes.map((n) => ({ data: { id: n.id, label: n.label || n.id } })),
        ...edgeElements,
      ];

      const n = nodes.length;
      const radius = 280;
      const positions: Record<string, { x: number; y: number }> = {};
      for (let i = 0; i < n; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        positions[nodes[i].id] = {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
        };
      }

      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }

      const instance = cy({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              label: 'data(label)',
              'background-color': '#64748b',
              color: '#111',
              'font-size': '10px',
              'text-valign': 'bottom',
              'text-halign': 'center',
              width: 24,
              height: 24,
              'text-wrap': 'wrap',
              'text-max-width': '120px',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 'data(lineWidth)',
              'line-color': 'data(lineColor)',
              'curve-style': 'bezier',
            },
          },
          { selector: 'edge:selected', style: { width: 'data(lineWidth)', 'line-color': '#1e293b', 'overlay-opacity': 0.3 } },
          { selector: 'edge.highlight', style: { width: 'data(lineWidth)', 'line-color': '#1e293b', 'overlay-opacity': 0.2 } },
          { selector: ':selected', style: { 'background-color': '#334155' } },
          { selector: ':hover', style: { 'background-color': '#475569' } },
        ],
        layout: {
          name: 'preset',
          positions,
          fit: true,
          padding: 60,
        },
      });

      const idToLabel: Record<string, string> = {};
      nodes.forEach((n) => { idToLabel[n.id] = n.label || n.id; });

      instance.on('tap', 'edge', (evt) => {
        const edge = evt.target;
        const weight = edge.data('weight') as number;
        const sourceId = edge.data('source') as string;
        const targetId = edge.data('target') as string;
        setSelectedEdge({
          sourceLabel: idToLabel[sourceId] ?? sourceId,
          targetLabel: idToLabel[targetId] ?? targetId,
          weight,
        });
        instance.elements().removeClass('highlight');
        instance.elements().unselect();
        edge.select();
      });

      instance.on('mouseover', 'edge', (evt) => {
        const edge = evt.target;
        edge.addClass('highlight');
        const weight = edge.data('weight') as number;
        const sourceId = edge.data('source') as string;
        const targetId = edge.data('target') as string;
        setSelectedEdge({
          sourceLabel: idToLabel[sourceId] ?? sourceId,
          targetLabel: idToLabel[targetId] ?? targetId,
          weight,
        });
      });

      instance.on('mouseout', 'edge', (evt) => {
        evt.target.removeClass('highlight');
        setSelectedEdge((prev) => {
          if (!prev) return null;
          const edge = evt.target;
          const sourceId = edge.data('source') as string;
          const targetId = edge.data('target') as string;
          const stillHover = prev.sourceLabel === (idToLabel[sourceId] ?? sourceId) && prev.targetLabel === (idToLabel[targetId] ?? targetId);
          return stillHover ? null : prev;
        });
      });

      instance.on('tap', (evt) => {
        if (evt.target === instance) {
          instance.elements().unselect();
          instance.elements().removeClass('highlight');
          setSelectedEdge(null);
        }
      });

      cyRef.current = instance;
      setDownloadReady(true);
    }).catch((e) => console.warn('Cytoscape init failed:', e));
  }, [data, minS, maxS, filteredEdges]);

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setDownloadReady(false);
      return;
    }
    initCy();
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      setDownloadReady(false);
    };
  }, [initCy, data?.nodes?.length, data?.edges?.length, filteredEdges.length]);

  const legendTicks = useMemo(() => {
    const out: number[] = [];
    const step = maxS > minS ? Math.ceil((maxS - minS) / 8) || 1 : 1;
    for (let v = minS; v <= maxS; v += step) out.push(v);
    if (out[out.length - 1] !== maxS) out.push(maxS);
    return out;
  }, [minS, maxS]);

  const gradientStops = useMemo(() => {
    const n = 20;
    const stops: string[] = [];
    for (let i = 0; i <= n; i++) {
      const w = minS + (i / n) * (maxS - minS);
      stops.push(`${weightToColor(w, minS, maxS)} ${(i / n) * 100}%`);
    }
    return stops.join(', ');
  }, [minS, maxS]);

  const handleDownload = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || typeof cy.png !== 'function') return;
    const opts = { scale: 2, full: true, bg: '#ffffff' };
    const filename = `theme-overlap-network-${Date.now()}.png`;

    const tryBlob = () => {
      const blobPromise = cy.png({ ...opts, output: 'blob-promise' } as { scale?: number; full?: boolean }) as unknown as Promise<Blob>;
      if (blobPromise && typeof blobPromise.then === 'function') {
        setDownloading(true);
        blobPromise
          .then((blob: Blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          })
          .catch((e: unknown) => {
            console.error('Download (blob) failed:', e);
            tryDataUri();
          })
          .finally(() => setDownloading(false));
        return;
      }
      tryDataUri();
    };

    const tryDataUri = () => {
      try {
        const dataUri = cy.png(opts);
        if (!dataUri || typeof dataUri !== 'string') return;
        const href = dataUri.startsWith('data:') ? dataUri : `data:image/png;base64,${dataUri}`;
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        console.error('Download failed:', e);
      }
    };

    tryBlob();
  }, []);

  if (loading) {
    return (
      <div className={`rounded-xl border border-gray-200 bg-gray-50 p-12 text-center ${className}`}>
        <p className="text-gray-600">Generating theme overlap network...</p>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className={`rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-gray-500 ${className}`}>
        No nodes to draw: no enriched GO terms matched your selected themes&apos; keywords, or there was no
        gene overlap between themes. Try more themes, adjust keywords, or use a larger gene list.
      </div>
    );
  }

  const dataMax = data ? Math.max(data.max_shared, data.min_shared + 1) : 100;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-4 mb-2">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Min overlap (threshold):</span>
          <input
            type="number"
            min={0}
            max={dataMax}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, Math.min(dataMax, Number(e.target.value) || 0)))}
            className="w-20 px-2 py-1.5 rounded border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </label>
        <span className="text-sm text-gray-500">
          Showing {filteredEdges.length} connection{filteredEdges.length !== 1 ? 's' : ''} (≥ {threshold})
        </span>
        {filteredEdges.length === 0 && data.edges.length > 0 && (
          <span className="text-sm text-amber-600">No connections at this threshold. Lower it to see edges.</span>
        )}
        <span className="text-xs text-gray-400">Click or hover an edge to see shared genes</span>
        {selectedEdge && (
          <div className="ml-auto px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-sm text-gray-800">
            <span className="font-medium">{selectedEdge.sourceLabel}</span>
            <span className="mx-2 text-indigo-600">↔</span>
            <span className="font-medium">{selectedEdge.targetLabel}</span>
            <span className="text-indigo-600 font-semibold ml-2">{selectedEdge.weight} shared genes</span>
          </div>
        )}
      </div>
      <div className="flex gap-4">
        <div className="flex-1 min-h-[400px] rounded-xl border border-gray-200 bg-white overflow-hidden" ref={containerRef} />
        <div className="flex flex-col items-center shrink-0">
          <span className="text-xs font-semibold text-gray-700 mb-2">Number of shared genes</span>
          <div className="flex items-stretch gap-1">
            <div className="h-48 w-5 rounded border border-gray-300 shrink-0" style={{ background: `linear-gradient(to top, ${gradientStops})` }} />
            <div className="flex flex-col justify-between h-48 text-xs text-gray-600 py-0.5">
              {legendTicks.slice().reverse().map((v) => (
                <span key={v}>{v}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleDownload}
          disabled={!downloadReady || downloading}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? 'Downloading...' : 'Download as PNG'}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Dynamically import Plotly to avoid SSR issues and improve initial page load
// Lazy load only when charts are needed
const Plot = dynamic(
  () => import('react-plotly.js'),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Loading chart...</p>
        </div>
      </div>
    )
  }
) as any;

type DataPreview = {
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

type CorrelationStats = {
  matrix_size: [number, number];
  statistics: {
    mean: number;
    std: number;
    min: number;
    max: number;
    median: number;
  };
};

type ClusterInfo = {
  optimal_k_elbow: number;
  optimal_k_silhouette: number;
  inertias: number[];
  silhouette_scores: number[];
  k_range: number[];
};

type PCAInfo = {
  explained_variance: number[];
  cumulative_variance: number[];
  n_components: number;
};

type ClusterAssignments = {
  [clusterId: number]: string[];
};

type TSNEInfo = {
  n_components: number;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const CORRELATION_METHODS = ['pearson', 'spearman', 'kendall'] as const;

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function IVCCAPage() {
  const dataFileRef = useRef<HTMLInputElement | null>(null);
  const filterFileRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const [analyzerId, setAnalyzerId] = useState('');
  const [method, setMethod] =
    useState<(typeof CORRELATION_METHODS)[number]>('pearson');

  const [preview, setPreview] = useState<DataPreview | null>(null);
  const [correlationStats, setCorrelationStats] =
    useState<CorrelationStats | null>(null);
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [pcaInfo, setPcaInfo] = useState<PCAInfo | null>(null);
  const [pcaClusterAssignments, setPcaClusterAssignments] = useState<ClusterAssignments | null>(null);
  const [tsneInfo, setTsneInfo] = useState<TSNEInfo | null>(null);

  const [heatmapImage, setHeatmapImage] = useState<string | null>(null);
  const [heatmapPlotData, setHeatmapPlotData] = useState<any>(null);
  const [sortedHeatmapImage, setSortedHeatmapImage] = useState<string | null>(
    null,
  );
  const [sortedHeatmapPlotData, setSortedHeatmapPlotData] = useState<any>(null);
  const [heatmapZoom, setHeatmapZoom] = useState(1);
  const [sortedHeatmapZoom, setSortedHeatmapZoom] = useState(1);
  const [histogramImage, setHistogramImage] = useState<string | null>(null);
  const [dendrogramImage, setDendrogramImage] = useState<string | null>(null);

  const [maxClusters, setMaxClusters] = useState(10);
  const [tsneComponents, setTsneComponents] = useState(2);
  const [tsnePerplexity, setTsnePerplexity] = useState(30);
  const [pcaClusters, setPcaClusters] = useState<number | null>(null);
  const [pcaDimensions, setPcaDimensions] = useState<2 | 3>(3);
  const [tsneClusters, setTsneClusters] = useState<number | null>(null);
  
  const [pcaScreeImage, setPcaScreeImage] = useState<string | null>(null);
  const [pcaScreePlotData, setPcaScreePlotData] = useState<any>(null);
  const [pcaScatterImage, setPcaScatterImage] = useState<string | null>(null);
  const [pcaScatterPlotData, setPcaScatterPlotData] = useState<any>(null);
  const [tsneScatterImage, setTsneScatterImage] = useState<string | null>(null);
  const [tsneScatterPlotData, setTsneScatterPlotData] = useState<any>(null);
  const [elbowSilhouetteImage, setElbowSilhouetteImage] = useState<string | null>(null);
  const [elbowSilhouettePlotData, setElbowSilhouettePlotData] = useState<any>(null);

  // Advanced Analysis states
  const [singlePathwayFile, setSinglePathwayFile] = useState<File | null>(null);
  const [singlePathwayResult, setSinglePathwayResult] = useState<any>(null);
  const [singleGene, setSingleGene] = useState('');
  const [targetGenesFile, setTargetGenesFile] = useState<File | null>(null);
  const [geneToGenesResult, setGeneToGenesResult] = useState<any>(null);
  const [pathwayFiles, setPathwayFiles] = useState<File[]>([]);
  const [geneToPathwaysResult, setGeneToPathwaysResult] = useState<any>(null);
  const [multiPathwayFiles, setMultiPathwayFiles] = useState<File[]>([]);
  const [multiPathwayResult, setMultiPathwayResult] = useState<any>(null);
  const [pathway1File, setPathway1File] = useState<File | null>(null);
  const [pathway2File, setPathway2File] = useState<File | null>(null);
  const [comparePathwaysResult, setComparePathwaysResult] = useState<any>(null);
  const [vennResult, setVennResult] = useState<any>(null);
  const [networkPathwayFile, setNetworkPathwayFile] = useState<File | null>(null);
  const [networkThreshold, setNetworkThreshold] = useState(0.75);
  const [networkDimensions, setNetworkDimensions] = useState<2 | 3>(2);
  const [networkResult, setNetworkResult] = useState<any>(null);

  const isDatasetLoaded = Boolean(analyzerId);
  const isCorrelationReady = Boolean(correlationStats);

  const resetAnalysisState = () => {
    setCorrelationStats(null);
    setClusterInfo(null);
    setPcaInfo(null);
    setPcaClusterAssignments(null);
    setTsneInfo(null);
    setHeatmapImage(null);
    setHeatmapPlotData(null);
    setSortedHeatmapImage(null);
    setSortedHeatmapPlotData(null);
    setHistogramImage(null);
    setDendrogramImage(null);
    setHeatmapZoom(1);
    setSortedHeatmapZoom(1);
    setPcaScreeImage(null);
    setPcaScreePlotData(null);
    setPcaScatterImage(null);
    setPcaScatterPlotData(null);
    setTsneScatterImage(null);
    setTsneScatterPlotData(null);
    setElbowSilhouetteImage(null);
    setElbowSilhouettePlotData(null);
    // Reset advanced analysis states
    setSinglePathwayFile(null);
    setSinglePathwayResult(null);
    setSingleGene('');
    setTargetGenesFile(null);
    setGeneToGenesResult(null);
    setPathwayFiles([]);
    setGeneToPathwaysResult(null);
    setMultiPathwayFiles([]);
    setMultiPathwayResult(null);
    setPathway1File(null);
    setPathway2File(null);
    setComparePathwaysResult(null);
    setVennResult(null);
    setNetworkPathwayFile(null);
    setNetworkResult(null);
  };

  const formatPreviewCell = (value: string | number | null) => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return String(value);
      return Math.abs(value) >= 1000
        ? value.toExponential(2)
        : numberFormatter.format(value);
    }
    return value;
  };

  const clampZoom = (value: number) =>
    Math.min(5, Math.max(0.4, Number(value.toFixed(2))));

  const changeHeatmapZoom = (delta: number) => {
    setHeatmapZoom((prev) => clampZoom(prev + delta));
  };

  const changeSortedHeatmapZoom = (delta: number) => {
    setSortedHeatmapZoom((prev) => clampZoom(prev + delta));
  };

  const handleSelectFile = (ref: RefObject<HTMLInputElement | null>) => () => {
    ref.current?.click();
  };

  const handleMaxClusterChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    if (!Number.isNaN(parsed)) {
      setMaxClusters(Math.min(Math.max(parsed, 3), 50));
    }
  };

  const handleTsnePerplexityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    if (!Number.isNaN(parsed)) {
      setTsnePerplexity(Math.min(Math.max(parsed, 5), 100));
    }
  };

  const buildFormData = (
    payload: Record<string, string | Blob>,
  ): FormData => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      formData.append(key, value);
    });
    return formData;
  };

  const postForm = async (
    endpoint: string,
    payload: Record<string, string | Blob>,
  ) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      body: buildFormData(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with status ${response.status}`);
    }

    return response.json();
  };

  const handleLoadData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatus('Uploading dataset…');
    setError('');
    resetAnalysisState();

    try {
      const formData = new FormData();
      formData.append('file', file);

      const filter = filterFileRef.current?.files?.[0];
      if (filter) {
        formData.append('filter_genes', filter);
      }

      const response = await fetch(`${API_BASE_URL}/api/ivcca/load-data`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Load failed (${response.status})`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Load data failed');
      }

      setAnalyzerId(payload.analyzer_id);
      setStatus(
        `Dataset loaded: ${payload.n_samples} samples × ${payload.n_genes} genes`,
      );
      setPreview(payload.preview ?? null);
    } catch (err) {
      setAnalyzerId('');
      setStatus('');
      setError(
        err instanceof Error ? err.message : 'Failed to load IVCCA dataset',
      );
      setPreview(null);
    } finally {
      setLoading(false);
      if (dataFileRef.current) {
        dataFileRef.current.value = '';
      }
    }
  };

  const handleLoadFilter = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus(`Filter file selected: ${file.name}`);
  };

  const handleCalculateCorrelation = async () => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus('Calculating correlation matrix…');
    setError('');

    try {
      const payload = await postForm('/api/ivcca/calculate-correlation', {
        analyzer_id: analyzerId,
        method,
      });

      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Correlation calculation failed');
      }

      setCorrelationStats({
        matrix_size: payload.matrix_size,
        statistics: payload.statistics,
      });
      setStatus('Correlation matrix ready');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to calculate correlation matrix',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleHeatmap = async (sorted: boolean) => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus(sorted ? 'Generating sorted heatmap…' : 'Generating heatmap…');
    setError('');

    try {
      const payload = await postForm('/api/ivcca/heatmap', {
        analyzer_id: analyzerId,
        sorted: sorted ? 'true' : 'false',
      });

      // Check if payload has the expected structure
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid response format');
      }

      if (payload.plot_type === 'plotly') {
        // Interactive Plotly plot
        if (!payload.content) {
          throw new Error('Plotly data missing or invalid');
        }
        try {
          const plotData = typeof payload.content === 'string' ? JSON.parse(payload.content) : payload.content;
          if (sorted) {
            setSortedHeatmapPlotData(plotData);
            setSortedHeatmapImage(null);
          } else {
            setHeatmapPlotData(plotData);
            setHeatmapImage(null);
          }
        } catch (e) {
          throw new Error('Invalid Plotly data format');
        }
      } else if (payload.plot_type === 'html') {
        // Fallback: HTML plot (legacy)
        if (!payload.content || typeof payload.content !== 'string') {
          throw new Error('HTML content missing or invalid');
        }
        // Try to extract plotly data from HTML or use as-is
        if (sorted) {
          setSortedHeatmapPlotData(null);
          setSortedHeatmapImage(null);
        } else {
          setHeatmapPlotData(null);
          setHeatmapImage(null);
        }
      } else if (payload.plot_type === 'image') {
        // Static image
        if (!payload.content || typeof payload.content !== 'string') {
          throw new Error('Image content missing or invalid');
        }
        // Only create data URL if content looks like base64
        if (payload.content.length > 0 && !payload.content.startsWith('<')) {
          const source = `data:image/png;base64,${payload.content}`;
          if (sorted) {
            setSortedHeatmapImage(source);
            setSortedHeatmapPlotData(null);
          } else {
            setHeatmapImage(source);
            setHeatmapPlotData(null);
          }
        } else {
          throw new Error('Invalid image content format');
        }
      } else {
        // Fallback: try to detect format from content
        if (payload.content && typeof payload.content === 'string') {
          if (payload.content.trim().startsWith('<')) {
            // Looks like HTML - try to parse as plotly JSON
            try {
              const plotData = JSON.parse(payload.content);
              if (sorted) {
                setSortedHeatmapPlotData(plotData);
                setSortedHeatmapImage(null);
              } else {
                setHeatmapPlotData(plotData);
                setHeatmapImage(null);
              }
            } catch (e) {
              // If not JSON, ignore
              if (sorted) {
                setSortedHeatmapPlotData(null);
                setSortedHeatmapImage(null);
              } else {
                setHeatmapPlotData(null);
                setHeatmapImage(null);
              }
            }
          } else {
            // Try as base64 image
            const source = `data:image/png;base64,${payload.content}`;
            if (sorted) {
              setSortedHeatmapImage(source);
              setSortedHeatmapPlotData(null);
            } else {
              setHeatmapImage(source);
              setHeatmapPlotData(null);
            }
          }
        } else {
          throw new Error(`Invalid plot type: ${payload.plot_type || 'unknown'}`);
        }
      }

      setStatus(sorted ? 'Sorted heatmap ready' : 'Heatmap ready');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate heatmap',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleHistogram = async () => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus('Generating histogram…');
    setError('');

    try {
      const payload = await postForm('/api/ivcca/histogram', {
        analyzer_id: analyzerId,
      });

      if (!payload.image_base64) {
        throw new Error('Histogram image missing');
      }

      setHistogramImage(`data:image/png;base64,${payload.image_base64}`);
      setStatus('Histogram ready');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate histogram',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDendrogram = async () => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus('Generating dendrogram…');
    setError('');

    try {
      const payload = await postForm('/api/ivcca/dendrogram', {
        analyzer_id: analyzerId,
        method: 'ward',
      });

      if (!payload.image_base64) {
        throw new Error('Dendrogram image missing');
      }

      setDendrogramImage(`data:image/png;base64,${payload.image_base64}`);
      setStatus('Dendrogram ready');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate dendrogram',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClusters = async () => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus('Calculating optimal clusters…');
    setError('');

    try {
      const payload = await postForm('/api/ivcca/optimal-clusters', {
        analyzer_id: analyzerId,
        max_k: String(maxClusters),
      });

      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Cluster analysis failed');
      }

      setClusterInfo({
        optimal_k_elbow: payload.optimal_k_elbow,
        optimal_k_silhouette: payload.optimal_k_silhouette,
        inertias: payload.inertias,
        silhouette_scores: payload.silhouette_scores,
        k_range: payload.k_range,
      });
      
      // Display visualization if available
      if (payload.plot_image) {
        if (typeof payload.plot_image === 'object' && payload.plot_image.type === 'plotly') {
          try {
            const plotData = typeof payload.plot_image.content === 'string' ? JSON.parse(payload.plot_image.content) : payload.plot_image.content;
            setElbowSilhouettePlotData(plotData);
            setElbowSilhouetteImage(null);
          } catch (e) {
            console.error('Failed to parse elbow/silhouette plot data:', e);
          }
        } else if (typeof payload.plot_image === 'object' && payload.plot_image.type === 'image') {
          if (payload.plot_image.content && typeof payload.plot_image.content === 'string' && !payload.plot_image.content.startsWith('<')) {
            setElbowSilhouetteImage(`data:image/png;base64,${payload.plot_image.content}`);
            setElbowSilhouettePlotData(null);
          }
        } else if (typeof payload.plot_image === 'string') {
          // Legacy format: assume base64
          setElbowSilhouetteImage(`data:image/png;base64,${payload.plot_image}`);
          setElbowSilhouettePlotData(null);
        }
      }
      
      setStatus('Cluster analysis ready');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to calculate clusters',
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePCA = async () => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus('Running PCA…');
    setError('');

    try {
      const formData: Record<string, string> = {
        analyzer_id: analyzerId,
        n_components: String(pcaDimensions),
      };
      
      if (pcaClusters !== null && pcaClusters > 0) {
        formData.n_clusters = String(pcaClusters);
        console.log('Sending n_clusters:', pcaClusters, 'as string:', String(pcaClusters));
      } else {
        console.log('NOT sending n_clusters, pcaClusters value:', pcaClusters);
      }

      console.log('FormData being sent:', formData);
      const payload = await postForm('/api/ivcca/pca', formData);

      if (payload.status !== 'success') {
        throw new Error(payload.message || 'PCA failed');
      }

      setPcaInfo({
        explained_variance: payload.explained_variance,
        cumulative_variance: payload.cumulative_variance,
        n_components: payload.n_components,
      });
      
      // Store cluster assignments if available
      console.log('Full PCA payload:', payload);
      console.log('pcaClusters value:', pcaClusters);
      console.log('cluster_assignments in payload?', 'cluster_assignments' in payload);
      
      // Check if cluster_assignments is in the top level
      let clusterAssignments = null;
      if (payload.cluster_assignments) {
        clusterAssignments = payload.cluster_assignments;
        console.log('Found cluster_assignments in payload top level');
      } 
      // Check if cluster_assignments is nested in scatter_plot
      else if (payload.scatter_plot && typeof payload.scatter_plot === 'object' && 'cluster_assignments' in payload.scatter_plot) {
        clusterAssignments = payload.scatter_plot.cluster_assignments;
        console.log('Found cluster_assignments in scatter_plot');
      }
      // Check if scatter_plot content is a string that might contain cluster_assignments
      else if (payload.scatter_plot && payload.scatter_plot.content) {
        try {
          const scatterContent = typeof payload.scatter_plot.content === 'string' 
            ? JSON.parse(payload.scatter_plot.content) 
            : payload.scatter_plot.content;
          if (scatterContent && scatterContent.cluster_assignments) {
            clusterAssignments = scatterContent.cluster_assignments;
            console.log('Found cluster_assignments in scatter_plot.content');
          }
        } catch (e) {
          console.log('Could not parse scatter_plot.content:', e);
        }
      }
      
      if (clusterAssignments) {
        console.log('PCA Cluster Assignments received:', clusterAssignments);
        console.log('Number of clusters:', Object.keys(clusterAssignments).length);
        console.log('First cluster sample:', clusterAssignments[Object.keys(clusterAssignments)[0]]);
        setPcaClusterAssignments(clusterAssignments);
      } else {
        console.log('No cluster_assignments found. Available keys:', Object.keys(payload));
        console.log('Payload scatter_plot:', payload.scatter_plot);
        console.log('Payload scatter_plot keys:', payload.scatter_plot ? Object.keys(payload.scatter_plot) : 'No scatter_plot');
        setPcaClusterAssignments(null);
      }
      
      // Display visualizations
      if (payload.scree_plot) {
        if (typeof payload.scree_plot === 'object' && payload.scree_plot.type === 'plotly') {
          try {
            const plotData = typeof payload.scree_plot.content === 'string' ? JSON.parse(payload.scree_plot.content) : payload.scree_plot.content;
            setPcaScreePlotData(plotData);
            setPcaScreeImage(null);
          } catch (e) {
            console.error('Failed to parse scree plot data:', e);
          }
        } else if (typeof payload.scree_plot === 'object' && payload.scree_plot.type === 'image') {
          if (payload.scree_plot.content && typeof payload.scree_plot.content === 'string' && !payload.scree_plot.content.startsWith('<')) {
            setPcaScreeImage(`data:image/png;base64,${payload.scree_plot.content}`);
            setPcaScreePlotData(null);
          }
        } else if (typeof payload.scree_plot === 'string') {
          // Legacy format: assume base64
          setPcaScreeImage(`data:image/png;base64,${payload.scree_plot}`);
          setPcaScreePlotData(null);
        }
      }
      if (payload.scatter_plot) {
        if (typeof payload.scatter_plot === 'object' && payload.scatter_plot.type === 'plotly') {
          try {
            const plotData = typeof payload.scatter_plot.content === 'string' ? JSON.parse(payload.scatter_plot.content) : payload.scatter_plot.content;
            setPcaScatterPlotData(plotData);
            setPcaScatterImage(null);
          } catch (e) {
            console.error('Failed to parse scatter plot data:', e);
          }
        } else if (typeof payload.scatter_plot === 'object' && payload.scatter_plot.type === 'image') {
          if (payload.scatter_plot.content && typeof payload.scatter_plot.content === 'string' && !payload.scatter_plot.content.startsWith('<')) {
            setPcaScatterImage(`data:image/png;base64,${payload.scatter_plot.content}`);
            setPcaScatterPlotData(null);
          }
        } else if (typeof payload.scatter_plot === 'string') {
          // Legacy format: assume base64
          setPcaScatterImage(`data:image/png;base64,${payload.scatter_plot}`);
          setPcaScatterPlotData(null);
        }
      }
      
      setStatus('PCA results ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run PCA');
    } finally {
      setLoading(false);
    }
  };

  const handleTSNE = async () => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus('Running t-SNE…');
    setError('');

    try {
      const formData: Record<string, string> = {
        analyzer_id: analyzerId,
        n_components: String(tsneComponents),
        perplexity: String(tsnePerplexity),
      };
      
      if (tsneClusters !== null && tsneClusters > 0) {
        formData.n_clusters = String(tsneClusters);
      }

      const payload = await postForm('/api/ivcca/tsne', formData);

      if (payload.status !== 'success') {
        throw new Error(payload.message || 't-SNE failed');
      }

      setTsneInfo({
        n_components: payload.n_components,
      });
      
      // Display visualization
      if (payload.scatter_plot) {
        if (typeof payload.scatter_plot === 'object' && payload.scatter_plot.type === 'plotly') {
          try {
            const plotData = typeof payload.scatter_plot.content === 'string' ? JSON.parse(payload.scatter_plot.content) : payload.scatter_plot.content;
            setTsneScatterPlotData(plotData);
            setTsneScatterImage(null);
          } catch (e) {
            console.error('Failed to parse t-SNE scatter plot data:', e);
          }
        } else if (typeof payload.scatter_plot === 'object' && payload.scatter_plot.type === 'image') {
          if (payload.scatter_plot.content && typeof payload.scatter_plot.content === 'string' && !payload.scatter_plot.content.startsWith('<')) {
            setTsneScatterImage(`data:image/png;base64,${payload.scatter_plot.content}`);
            setTsneScatterPlotData(null);
          }
        } else if (typeof payload.scatter_plot === 'string') {
          // Legacy format: assume base64
          setTsneScatterImage(`data:image/png;base64,${payload.scatter_plot}`);
          setTsneScatterPlotData(null);
        }
      }
      
      setStatus('t-SNE results ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run t-SNE');
    } finally {
      setLoading(false);
    }
  };

  const clusterSummary = useMemo(() => {
    if (!clusterInfo) return [];
    return clusterInfo.k_range.slice(0, 6).map((k, index) => ({
      k,
      inertia: clusterInfo.inertias[index],
      silhouette: clusterInfo.silhouette_scores[index],
    }));
  }, [clusterInfo]);

  const pcaSummary = useMemo(() => {
    if (!pcaInfo) return [];
    return pcaInfo.explained_variance.slice(0, 5).map((value, index) => ({
      component: index + 1,
      explained: value,
      cumulative: pcaInfo.cumulative_variance[index],
    }));
  }, [pcaInfo]);

  // Advanced Analysis Handlers
  const handleSinglePathway = async () => {
    if (!analyzerId || !singlePathwayFile) return;
    setLoading(true);
    setStatus('Analyzing single pathway…');
    setError('');

    try {
      const formData = new FormData();
      formData.append('analyzer_id', analyzerId);
      formData.append('pathway_file', singlePathwayFile);

      const response = await fetch(`${API_BASE_URL}/api/ivcca/single-pathway`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Single pathway analysis failed');
      }

      setSinglePathwayResult(payload);
      setStatus('Single pathway analysis ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze single pathway');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneToGenes = async () => {
    if (!analyzerId || !singleGene || !targetGenesFile) return;
    setLoading(true);
    setStatus('Calculating gene to genes correlations…');
    setError('');

    try {
      const formData = new FormData();
      formData.append('analyzer_id', analyzerId);
      formData.append('single_gene', singleGene);
      formData.append('target_genes_file', targetGenesFile);

      const response = await fetch(`${API_BASE_URL}/api/ivcca/gene-to-genes`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Gene to genes analysis failed');
      }

      setGeneToGenesResult(payload);
      setStatus('Gene to genes analysis ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze gene to genes');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneToPathways = async () => {
    if (!analyzerId || !singleGene || pathwayFiles.length === 0) return;
    setLoading(true);
    setStatus('Calculating gene to pathways correlations…');
    setError('');

    try {
      const formData = new FormData();
      formData.append('analyzer_id', analyzerId);
      formData.append('single_gene', singleGene);
      pathwayFiles.forEach((file) => {
        formData.append('pathway_files', file);
      });

      const response = await fetch(`${API_BASE_URL}/api/ivcca/gene-to-pathways`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Gene to pathways analysis failed');
      }

      setGeneToPathwaysResult(payload);
      setStatus('Gene to pathways analysis ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze gene to pathways');
    } finally {
      setLoading(false);
    }
  };

  const handleMultiPathway = async () => {
    if (!analyzerId || multiPathwayFiles.length === 0) return;
    setLoading(true);
    setStatus('Running multi-pathway analysis…');
    setError('');

    try {
      const formData = new FormData();
      formData.append('analyzer_id', analyzerId);
      formData.append('min_genes_threshold', '5');
      formData.append('sorted_matrix', 'false');
      multiPathwayFiles.forEach((file) => {
        formData.append('pathway_files', file);
      });

      const response = await fetch(`${API_BASE_URL}/api/ivcca/multi-pathway`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Multi-pathway analysis failed');
      }

      setMultiPathwayResult(payload);
      setStatus('Multi-pathway analysis ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze multi-pathway');
    } finally {
      setLoading(false);
    }
  };

  const handleComparePathways = async () => {
    if (!analyzerId || !pathway1File || !pathway2File) return;
    setLoading(true);
    setStatus('Comparing pathways…');
    setError('');

    try {
      const formData = new FormData();
      formData.append('analyzer_id', analyzerId);
      formData.append('pathway1_file', pathway1File);
      formData.append('pathway2_file', pathway2File);

      const response = await fetch(`${API_BASE_URL}/api/ivcca/compare-pathways`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Pathway comparison failed');
      }

      setComparePathwaysResult(payload);
      setStatus('Pathway comparison ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compare pathways');
    } finally {
      setLoading(false);
    }
  };

  const handleVennDiagram = async () => {
    if (!analyzerId || !pathway1File || !pathway2File) return;
    setLoading(true);
    setStatus('Generating Venn diagram…');
    setError('');

    try {
      const formData = new FormData();
      formData.append('analyzer_id', analyzerId);
      formData.append('pathway1_file', pathway1File);
      formData.append('pathway2_file', pathway2File);

      const response = await fetch(`${API_BASE_URL}/api/ivcca/venn-diagram`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Venn diagram generation failed');
      }

      setVennResult(payload);
      setStatus('Venn diagram ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate Venn diagram');
    } finally {
      setLoading(false);
    }
  };

  const handleNetworkAnalysis = async () => {
    if (!analyzerId) return;
    setLoading(true);
    setStatus('Generating network analysis…');
    setError('');

    try {
      const formData = new FormData();
      formData.append('analyzer_id', analyzerId);
      formData.append('threshold', String(networkThreshold));
      formData.append('plot_type', networkDimensions === 3 ? '3D' : '2D');
      if (networkPathwayFile) {
        formData.append('pathway_file', networkPathwayFile);
      }

      const response = await fetch(`${API_BASE_URL}/api/ivcca/network-analysis`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status !== 'success') {
        throw new Error(payload.message || 'Network analysis failed');
      }

      setNetworkResult(payload);
      setStatus('Network analysis ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate network analysis');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
      <div className="border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center text-gray-600 transition-colors hover:text-gray-900"
            >
              <svg
                className="mr-2 h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back to Home
            </Link>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6l4 2"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                IVCCA Analysis Suite
              </h1>
              <p className="text-sm text-gray-500">
                Inter-Variability Cross Correlation Analysis platform
              </p>
            </div>
          </div>
          <div className="rounded-full bg-indigo-50 px-4 py-2 text-xs font-medium text-indigo-700">
            API base:{' '}
            <span className="font-semibold">
              {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}
            </span>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <section className="rounded-3xl bg-white p-8 shadow-lg ring-1 ring-gray-100">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Step 1 · Load Dataset
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Upload a TSV/CSV/Excel file exported from the IVCCA MATLAB tool.
                Optionally include a plain-text gene filter list (one symbol per
                line).
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <input
                ref={dataFileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv"
                className="hidden"
                onChange={handleLoadData}
              />
              <input
                ref={filterFileRef}
                type="file"
                accept=".txt"
                className="hidden"
                onChange={handleLoadFilter}
              />
              <button
                type="button"
                onClick={handleSelectFile(dataFileRef)}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                  />
                </svg>
                {loading ? 'Processing…' : 'Load Dataset'}
              </button>
              <button
                type="button"
                onClick={handleSelectFile(filterFileRef)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:ring-offset-2"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
                Add Gene Filter
              </button>
            </div>
          </div>

          {analyzerId && (
            <div className="mt-6 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
              Analyzer ready · ID:{' '}
              <span className="font-mono">{analyzerId}</span>
            </div>
          )}

          {preview && (
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
                  Dataset Preview
                </h3>
                <span className="text-xs text-gray-400">
                  Showing complete dataset · {preview.rows.length} samples ·{' '}
                  {preview.columns.length - 1} genes
                </span>
              </div>
              <div className="max-h-[28rem] overflow-auto rounded-2xl border border-gray-200 bg-white shadow">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {preview.columns.map((column) => (
                        <th
                          key={column}
                          className="px-4 py-2 text-left font-semibold text-gray-700"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.rows.map((row, rowIndex) => (
                      <tr key={`preview-row-${rowIndex}`} className="hover:bg-gray-50/80">
                        {row.map((cell, cellIndex) => (
                          <td
                            key={`preview-cell-${rowIndex}-${cellIndex}`}
                            className={`px-4 py-2 ${
                              cellIndex === 0
                                ? 'font-medium text-gray-900'
                                : 'text-gray-700'
                            }`}
                          >
                            {formatPreviewCell(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Scroll to inspect the entire dataset that will be used for IVCCA analysis.
              </p>
            </div>
          )}
        </section>

        <section className="mt-10 rounded-3xl bg-white p-8 shadow-lg ring-1 ring-gray-100">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Step 2 · Correlation Matrix
              </h2>
              <p className="text-sm text-gray-600">
                Choose a correlation method and compute the IVCCA correlation matrix
                to unlock downstream visualisation and clustering tools.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as (typeof CORRELATION_METHODS)[number])
                }
                disabled={!isDatasetLoaded}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
              >
                {CORRELATION_METHODS.map((item) => (
                  <option key={item} value={item}>
                    {item.charAt(0).toUpperCase() + item.slice(1)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCalculateCorrelation}
                disabled={!isDatasetLoaded || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 17v-2m3 2v-4m3 4v-6m3 6V9M5 17v-4"
                  />
                </svg>
                Correlation
              </button>
            </div>
          </div>

          {correlationStats && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
                <p className="text-sm font-medium text-indigo-700">Matrix Size</p>
                <p className="mt-1 text-lg font-semibold text-indigo-900">
                  {correlationStats.matrix_size[0]} ×{' '}
                  {correlationStats.matrix_size[1]}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 p-5">
                <p className="text-sm font-medium text-gray-600">
                  Summary Statistics
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-700">
                  <dt>Mean</dt>
                  <dd className="font-mono">
                    {numberFormatter.format(correlationStats.statistics.mean)}
                  </dd>
                  <dt>Median</dt>
                  <dd className="font-mono">
                    {numberFormatter.format(correlationStats.statistics.median)}
                  </dd>
                  <dt>Min / Max</dt>
                  <dd className="font-mono">
                    {numberFormatter.format(correlationStats.statistics.min)} /{' '}
                    {numberFormatter.format(correlationStats.statistics.max)}
                  </dd>
                  <dt>Std Dev</dt>
                  <dd className="font-mono">
                    {numberFormatter.format(correlationStats.statistics.std)}
                  </dd>
                </dl>
              </div>
            </div>
          )}

          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => handleHeatmap(false)}
              disabled={!isCorrelationReady || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            >
              Heatmap
            </button>
            <button
              type="button"
              onClick={() => handleHeatmap(true)}
              disabled={!isCorrelationReady || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-purple-200 bg-white px-4 py-3 text-sm font-semibold text-purple-700 shadow-sm transition hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            >
              Sorted Heatmap
            </button>
            <button
              type="button"
              onClick={handleHistogram}
              disabled={!isCorrelationReady || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-orange-200 bg-white px-4 py-3 text-sm font-semibold text-orange-700 shadow-sm transition hover:border-orange-300 hover:bg-orange-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            >
              Histogram
            </button>
            <button
              type="button"
              onClick={handleDendrogram}
              disabled={!isCorrelationReady || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            >
              Dendrogram
            </button>
          </div>
        </section>

        <section className="mt-10 rounded-3xl bg-white p-8 shadow-lg ring-1 ring-gray-100">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Step 3 · Clustering & Dimensionality Reduction
              </h2>
              <p className="text-sm text-gray-600">
                Discover structure in your correlation matrix using K-means, PCA, and
                t-SNE projections.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                Max k:
                <input
                  type="number"
                  min={3}
                  max={50}
                  value={maxClusters}
                  onChange={handleMaxClusterChange}
                  disabled={!isCorrelationReady}
                  className="w-20 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                PCA Dimensions:
                <select
                  value={pcaDimensions}
                  onChange={(event) =>
                    setPcaDimensions(Number(event.target.value) as 2 | 3)
                  }
                  disabled={!isCorrelationReady}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                >
                  <option value={2}>2D</option>
                  <option value={3}>3D</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                PCA Clusters:
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={pcaClusters || ''}
                  onChange={(e) => setPcaClusters(e.target.value ? Number(e.target.value) : null)}
                  disabled={!isCorrelationReady}
                  placeholder="Optional"
                  className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                t-SNE dims:
                <select
                  value={tsneComponents}
                  onChange={(event) =>
                    setTsneComponents(Number(event.target.value))
                  }
                  disabled={!isCorrelationReady}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                >
                  <option value={2}>2 components</option>
                  <option value={3}>3 components</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                t-SNE Clusters:
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={tsneClusters || ''}
                  onChange={(e) => setTsneClusters(e.target.value ? Number(e.target.value) : null)}
                  disabled={!isCorrelationReady}
                  placeholder="Optional"
                  className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                Perplexity:
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={tsnePerplexity}
                  onChange={handleTsnePerplexityChange}
                  disabled={!isCorrelationReady}
                  className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                />
              </label>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <button
              type="button"
              onClick={handleClusters}
              disabled={!isCorrelationReady || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-sm font-semibold text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            >
              Optimal Clusters
            </button>
            <button
              type="button"
              onClick={handlePCA}
              disabled={!isCorrelationReady || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            >
              PCA
            </button>
            <button
              type="button"
              onClick={handleTSNE}
              disabled={!isCorrelationReady || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-white px-4 py-3 text-sm font-semibold text-green-700 shadow-sm transition hover:border-green-300 hover:bg-green-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            >
              t-SNE
            </button>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {clusterInfo && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-6">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-indigo-700">
                  Cluster Summary
                </h3>
                <p className="text-sm text-indigo-800">
                  Elbow k:{' '}
                  <strong>{clusterInfo.optimal_k_elbow}</strong> · Silhouette k:{' '}
                  <strong>{clusterInfo.optimal_k_silhouette}</strong>
                </p>
                <ul className="mt-3 space-y-2 text-xs text-indigo-900">
                  {clusterSummary.map((item) => (
                    <li
                      key={item.k}
                      className="flex justify-between rounded-lg bg-white/80 px-3 py-2"
                    >
                      <span className="font-medium">k = {item.k}</span>
                      <span className="font-mono">
                        inertia {numberFormatter.format(item.inertia)} · silhouette{' '}
                        {numberFormatter.format(item.silhouette)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pcaInfo && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-6">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue-700">
                  PCA Explained Variance
                </h3>
                <ul className="space-y-2 text-xs text-blue-900">
                  {pcaSummary.map((item) => (
                    <li
                      key={item.component}
                      className="flex justify-between rounded-lg bg-white/80 px-3 py-2"
                    >
                      <span className="font-medium">
                        PC{item.component}
                      </span>
                      <span className="font-mono">
                        {percentFormatter.format(item.explained)} · cum{' '}
                        {percentFormatter.format(item.cumulative)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tsneInfo && (
              <div className="rounded-2xl border border-green-100 bg-green-50/60 p-6 md:col-span-2">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-green-700">
                  t-SNE Status
                </h3>
                <p className="text-sm text-green-800">
                  Generated {tsneInfo.n_components}-dimensional embedding.
                </p>
              </div>
            )}
          </div>
          
          {/* Elbow/Silhouette Plot */}
          {(elbowSilhouetteImage || elbowSilhouettePlotData) && (
            <div className="mt-6">
              <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                {elbowSilhouettePlotData ? (
                  <Plot
                    data={elbowSilhouettePlotData.data}
                    layout={elbowSilhouettePlotData.layout}
                    config={{ responsive: true, displayModeBar: true }}
                    style={{ width: '100%', height: '500px' }}
                  />
                ) : elbowSilhouetteImage && elbowSilhouetteImage.startsWith('data:image') ? (
                  <img
                    src={elbowSilhouetteImage}
                    alt="Elbow and Silhouette plots"
                    className="w-full rounded-xl border border-gray-100 shadow"
                  />
                ) : null}
                <figcaption className="mt-2 text-sm text-gray-600">
                  Elbow curve and Silhouette analysis for optimal cluster number determination.
                </figcaption>
              </figure>
            </div>
          )}
          
          {/* t-SNE Visualization */}
          {(tsneScatterImage || tsneScatterPlotData) && (
            <div className="mt-6">
              <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                {tsneScatterPlotData ? (
                  <Plot
                    data={tsneScatterPlotData.data}
                    layout={tsneScatterPlotData.layout}
                    config={{ responsive: true, displayModeBar: true }}
                    style={{ width: '100%', height: '600px' }}
                  />
                ) : tsneScatterImage && tsneScatterImage.startsWith('data:image') ? (
                  <img
                    src={tsneScatterImage}
                    alt="t-SNE Scatter Plot"
                    className="w-full rounded-xl border border-gray-100 shadow"
                  />
                ) : null}
                <figcaption className="mt-2 text-sm text-gray-600">
                  t-SNE {tsneInfo?.n_components === 3 ? '3D' : '2D'} Scatter Plot
                  {tsneClusters && ` with ${tsneClusters} clusters`}. Click and drag to rotate (3D) or zoom.
                </figcaption>
              </figure>
            </div>
          )}
        </section>

        {/* PCA Visualizations - Dedicated Section */}
        {(pcaScreeImage || pcaScreePlotData || pcaScatterImage || pcaScatterPlotData) && (
          <section className="mt-10 rounded-3xl bg-white p-10 md:p-12 shadow-lg ring-1 ring-gray-100">
            <h2 className="text-xl font-semibold text-gray-900">
              PCA Visualization
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Principal Component Analysis results showing variance explained and gene distribution in PCA space.
            </p>
            <div className="mt-8 space-y-8">
              {(pcaScreeImage || pcaScreePlotData) && (
                <div className="w-full">
                  <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-6 md:p-8">
                    {pcaScreePlotData ? (
                      <Plot
                        data={pcaScreePlotData.data}
                        layout={pcaScreePlotData.layout}
                        config={{ responsive: true, displayModeBar: true }}
                        style={{ width: '100%', height: '450px' }}
                      />
                    ) : pcaScreeImage && pcaScreeImage.startsWith('data:image') ? (
                      <img
                        src={pcaScreeImage}
                        alt="PCA Scree Plot"
                        className="w-full rounded-xl border border-gray-100 shadow"
                      />
                    ) : null}
                    <figcaption className="mt-2 text-sm text-gray-600">
                      PCA Scree Plot: Cumulative variance explained by the first 25 principal components.
                    </figcaption>
                  </figure>
                </div>
              )}
              {(pcaScatterImage || pcaScatterPlotData) && (
                <div className="w-full overflow-auto">
                  <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-6 md:p-8 min-w-full">
                    {pcaScatterPlotData ? (
                      <div className="w-full" style={{ minHeight: pcaDimensions === 3 ? '600px' : '700px' }}>
                        <Plot
                          data={pcaScatterPlotData.data}
                          layout={pcaScatterPlotData.layout}
                          config={{ responsive: true, displayModeBar: true }}
                          style={{ width: '100%', height: '100%', minHeight: pcaDimensions === 3 ? '600px' : '700px' }}
                        />
                      </div>
                    ) : pcaScatterImage && pcaScatterImage.startsWith('data:image') ? (
                      <img
                        src={pcaScatterImage}
                        alt="PCA Scatter Plot"
                        className="w-full rounded-xl border border-gray-100 shadow"
                      />
                    ) : null}
                    <figcaption className="mt-2 text-sm text-gray-600">
                      PCA {pcaDimensions === 3 ? '3D' : '2D'} Scatter Plot
                      {pcaClusters && ` with ${pcaClusters} clusters`}. Click and drag to rotate (3D) or zoom.
                    </figcaption>
                  </figure>
                </div>
              )}
              
              {/* PCA Cluster Assignments - Always show if clusters were requested */}
              {pcaClusters && pcaClusters > 0 && (
                <div className="w-full mt-8">
                  <div className="rounded-2xl border-2 border-blue-400 bg-blue-100 p-6 md:p-8 shadow-xl">
                    <div className="mb-6 flex items-center justify-between">
                      <h3 className="text-xl font-bold text-blue-900">
                        PCA Cluster Assignments
                        {pcaClusterAssignments ? ` (${Object.keys(pcaClusterAssignments).length} clusters)` : ' (Loading...)'}
                      </h3>
                      {pcaClusterAssignments && Object.keys(pcaClusterAssignments).length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            // Convert cluster assignments to CSV format
                            const csvRows: string[] = ['Cluster ID,Gene Name'];
                            Object.entries(pcaClusterAssignments)
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .forEach(([clusterId, genes]) => {
                                genes.forEach((gene) => {
                                  csvRows.push(`${clusterId},"${gene}"`);
                                });
                              });
                            const csvContent = csvRows.join('\n');
                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            const url = URL.createObjectURL(blob);
                            link.setAttribute('href', url);
                            link.setAttribute('download', `pca_clusters_${new Date().toISOString().split('T')[0]}.csv`);
                            link.style.visibility = 'hidden';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                        >
                          <svg
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                            />
                          </svg>
                          Download CSV
                        </button>
                      )}
                    </div>
                    {pcaClusterAssignments && Object.keys(pcaClusterAssignments).length > 0 ? (
                      <div className="space-y-6">
                        {Object.entries(pcaClusterAssignments)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([clusterId, genes]) => (
                            <div
                              key={clusterId}
                              className="rounded-lg bg-white p-6 shadow-md border-2 border-blue-300"
                            >
                              <h4 className="mb-4 text-lg font-bold text-blue-900 border-b-2 border-blue-200 pb-2">
                                Cluster {clusterId} ({genes.length} genes)
                              </h4>
                              <div className="max-h-96 overflow-y-auto">
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                  {genes.map((gene, idx) => (
                                    <div
                                      key={idx}
                                      className="font-mono py-2 px-3 bg-blue-50 rounded border border-blue-200 text-sm text-blue-800 hover:bg-blue-100 transition"
                                    >
                                      {gene}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-blue-700">
                        <p className="text-lg">No cluster assignments available.</p>
                        <p className="text-sm mt-2">Please check the browser console for debugging information.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {((heatmapImage || heatmapPlotData) ||
          (sortedHeatmapImage || sortedHeatmapPlotData) ||
          histogramImage ||
          dendrogramImage) && (
          <section className="mt-10 rounded-3xl bg-white p-8 shadow-lg ring-1 ring-gray-100">
            <h2 className="text-xl font-semibold text-gray-900">
              Step 4 · Visual Outputs
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Right-click any image to save locally for reports or further analysis.
            </p>
            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              {(heatmapImage || heatmapPlotData) && (
                <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <figcaption className="text-sm font-semibold text-gray-700">
                      Correlation heatmap (unsorted)
                    </figcaption>
                  </div>
                  <div className="max-h-[32rem] overflow-auto rounded-lg border border-gray-200 bg-white">
                    {heatmapPlotData ? (
                      <Plot
                        data={heatmapPlotData.data}
                        layout={heatmapPlotData.layout}
                        config={{ responsive: true, displayModeBar: true }}
                        style={{ width: '100%', minHeight: '600px' }}
                      />
                    ) : heatmapImage && heatmapImage.startsWith('data:image') ? (
                      <img
                        src={heatmapImage}
                        alt="Correlation heatmap"
                        className="rounded-lg shadow"
                        style={{
                          transform: `scale(${heatmapZoom})`,
                          transformOrigin: 'top left',
                        }}
                      />
                    ) : null}
                  </div>
                </figure>
              )}

              {(sortedHeatmapImage || sortedHeatmapPlotData) && (
                <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <figcaption className="text-sm font-semibold text-gray-700">
                      Correlation heatmap (sorted by correlation magnitude)
                    </figcaption>
                  </div>
                  <div className="max-h-[32rem] overflow-auto rounded-lg border border-gray-200 bg-white">
                    {sortedHeatmapPlotData ? (
                      <Plot
                        data={sortedHeatmapPlotData.data}
                        layout={sortedHeatmapPlotData.layout}
                        config={{ responsive: true, displayModeBar: true }}
                        style={{ width: '100%', minHeight: '600px' }}
                      />
                    ) : sortedHeatmapImage && sortedHeatmapImage.startsWith('data:image') ? (
                      <img
                        src={sortedHeatmapImage}
                        alt="Sorted correlation heatmap"
                        className="rounded-lg shadow"
                        style={{
                          transform: `scale(${sortedHeatmapZoom})`,
                          transformOrigin: 'top left',
                        }}
                      />
                    ) : null}
                  </div>
                </figure>
              )}

              {histogramImage && (
                <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <img
                    src={histogramImage}
                    alt="Correlation histogram"
                    className="w-full rounded-xl border border-gray-100 shadow"
                  />
                  <figcaption className="mt-2 text-sm text-gray-600">
                    Distribution of off-diagonal correlation coefficients.
                  </figcaption>
                </figure>
              )}

              {dendrogramImage && (
                <figure className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <img
                    src={dendrogramImage}
                    alt="Correlation dendrogram"
                    className="w-full rounded-xl border border-gray-100 shadow"
                  />
                  <figcaption className="mt-2 text-sm text-gray-600">
                    Hierarchical clustering dendrogram using Ward linkage.
                  </figcaption>
                </figure>
              )}
            </div>
          </section>
        )}

        <section className="mt-10 rounded-3xl bg-white p-8 shadow-lg ring-1 ring-gray-100">
          <h2 className="text-xl font-semibold text-gray-900">
            Step 5 · Advanced Analysis
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Gene-to-gene, gene-to-pathway, multi-pathway, Venn diagram, and network analysis.
          </p>
          
          {/* Single Pathway Analysis */}
          <div className="mt-8 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Single Pathway Analysis</h3>
            <p className="text-sm text-gray-600 mb-4">Analyze correlations within a single pathway (set of genes).</p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway File (.txt, one gene per line)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setSinglePathwayFile(e.target.files?.[0] || null)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                />
              </div>
              <button
                type="button"
                onClick={handleSinglePathway}
                disabled={!isCorrelationReady || !singlePathwayFile || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                Analyze Pathway
              </button>
            </div>
            {singlePathwayResult && (
              <div className="mt-4 rounded-lg bg-white p-4 border border-indigo-200">
                <p className="text-sm font-semibold text-indigo-900 mb-2">
                  Pathway Size: {singlePathwayResult.pathway_size} genes
                </p>
                <p className="text-sm text-indigo-700 mb-3">
                  Mean Correlation: {numberFormatter.format(singlePathwayResult.mean_correlation)}
                </p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-indigo-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Gene</th>
                        <th className="px-2 py-1 text-right">Avg Correlation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {singlePathwayResult.sorted_genes?.slice(0, 50).map((gene: string, idx: number) => (
                        <tr key={idx} className="border-b border-gray-100">
                          <td className="px-2 py-1 font-mono">{gene}</td>
                          <td className="px-2 py-1 text-right">{numberFormatter.format(singlePathwayResult.sorted_scores[idx])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Gene to Genes */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Gene to Genes</h3>
            <p className="text-sm text-gray-600 mb-4">Calculate correlation between a single gene and a group of target genes.</p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Single Gene Name
                </label>
                <input
                  type="text"
                  value={singleGene}
                  onChange={(e) => setSingleGene(e.target.value)}
                  disabled={!isCorrelationReady}
                  placeholder="Enter gene name"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:bg-gray-100"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Genes File (.txt)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setTargetGenesFile(e.target.files?.[0] || null)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:bg-gray-100"
                />
              </div>
              <button
                type="button"
                onClick={handleGeneToGenes}
                disabled={!isCorrelationReady || !singleGene || !targetGenesFile || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-300"
              >
                Analyze
              </button>
            </div>
            {geneToGenesResult && (
              <div className="mt-4 rounded-lg bg-white p-4 border border-purple-200">
                <p className="text-sm font-semibold text-purple-900 mb-2">
                  Gene: {geneToGenesResult.single_gene} | Target Genes: {geneToGenesResult.n_targets}
                </p>
                <p className="text-sm text-purple-700 mb-3">
                  Average Absolute Correlation: {numberFormatter.format(geneToGenesResult.avg_abs_correlation)}
                </p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-purple-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Target Gene</th>
                        <th className="px-2 py-1 text-right">Correlation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {geneToGenesResult.target_genes?.slice(0, 50).map((gene: string, idx: number) => (
                        <tr key={idx} className="border-b border-gray-100">
                          <td className="px-2 py-1 font-mono">{gene}</td>
                          <td className="px-2 py-1 text-right">{numberFormatter.format(geneToGenesResult.correlations[idx])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Gene to Pathways */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Gene to Pathways</h3>
            <p className="text-sm text-gray-600 mb-4">Calculate correlation between a single gene and multiple pathways.</p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Single Gene Name
                </label>
                <input
                  type="text"
                  value={singleGene}
                  onChange={(e) => setSingleGene(e.target.value)}
                  disabled={!isCorrelationReady}
                  placeholder="Enter gene name"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway Files (.txt, multiple files)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  multiple
                  onChange={(e) => setPathwayFiles(Array.from(e.target.files || []))}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100"
                />
                {pathwayFiles.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">{pathwayFiles.length} file(s) selected</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleGeneToPathways}
                disabled={!isCorrelationReady || !singleGene || pathwayFiles.length === 0 || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                Analyze
              </button>
            </div>
            {geneToPathwaysResult && (
              <div className="mt-4 rounded-lg bg-white p-4 border border-indigo-200">
                <p className="text-sm font-semibold text-indigo-900 mb-3">
                  Gene: {geneToPathwaysResult.single_gene} | Pathways: {geneToPathwaysResult.n_pathways}
                </p>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {geneToPathwaysResult.pathways?.map((pathway: any, idx: number) => (
                    <div key={idx} className="p-3 bg-indigo-50 rounded-lg">
                      <p className="text-sm font-semibold text-indigo-900">{pathway.pathway_file}</p>
                      <p className="text-xs text-indigo-700">
                        Size: {pathway.pathway_size} | Found: {pathway.genes_found} | 
                        Avg Correlation: {numberFormatter.format(pathway.avg_correlation)} | 
                        Avg Abs: {numberFormatter.format(pathway.avg_abs_correlation)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Multi-Pathway */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Multi-Pathway Analysis (CECI)</h3>
            <p className="text-sm text-gray-600 mb-4">Calculate CECI (Cross-Enrichment Correlation Index) for multiple pathways.</p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway Files (.txt, multiple files)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  multiple
                  onChange={(e) => setMultiPathwayFiles(Array.from(e.target.files || []))}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:bg-gray-100"
                />
                {multiPathwayFiles.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">{multiPathwayFiles.length} file(s) selected</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleMultiPathway}
                disabled={!isCorrelationReady || multiPathwayFiles.length === 0 || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-teal-300"
              >
                Analyze
              </button>
            </div>
            {multiPathwayResult && (
              <div className="mt-4 rounded-lg bg-white p-4 border border-teal-200">
                <p className="text-sm font-semibold text-teal-900 mb-3">
                  Pathways Analyzed: {multiPathwayResult.n_pathways}
                </p>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-teal-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Pathway</th>
                        <th className="px-2 py-1 text-right">PAI</th>
                        <th className="px-2 py-1 text-right">PCI-A</th>
                        <th className="px-2 py-1 text-right">PCI-B</th>
                        <th className="px-2 py-1 text-right">CECI</th>
                        <th className="px-2 py-1 text-right">Z-Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {multiPathwayResult.pathways?.map((pathway: any, idx: number) => (
                        <tr key={idx} className="border-b border-gray-100">
                          <td className="px-2 py-1 font-mono text-xs">{pathway.pathway_file}</td>
                          <td className="px-2 py-1 text-right">{numberFormatter.format(pathway.pai)}</td>
                          <td className="px-2 py-1 text-right">{numberFormatter.format(pathway.pci_a)}</td>
                          <td className="px-2 py-1 text-right">{numberFormatter.format(pathway.pci_b)}</td>
                          <td className="px-2 py-1 text-right font-semibold">{numberFormatter.format(pathway.ceci)}</td>
                          <td className="px-2 py-1 text-right">{numberFormatter.format(pathway.z_score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Compare Pathways */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Compare Pathways</h3>
            <p className="text-sm text-gray-600 mb-4">Calculate cosine similarity between two pathways.</p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway 1 File (.txt)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setPathway1File(e.target.files?.[0] || null)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway 2 File (.txt)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setPathway2File(e.target.files?.[0] || null)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                />
              </div>
              <button
                type="button"
                onClick={handleComparePathways}
                disabled={!isCorrelationReady || !pathway1File || !pathway2File || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                Compare
              </button>
            </div>
            {comparePathwaysResult && (
              <div className="mt-4 rounded-lg bg-white p-4 border border-blue-200">
                <p className="text-sm font-semibold text-blue-900 mb-2">
                  Cosine Similarity: {numberFormatter.format(comparePathwaysResult.cosine_similarity)}
                </p>
                <p className="text-xs text-blue-700">
                  Pathway 1: {comparePathwaysResult.pathway1_size} genes | 
                  Pathway 2: {comparePathwaysResult.pathway2_size} genes | 
                  Intersection: {comparePathwaysResult.intersection_size} genes
                </p>
              </div>
            )}
          </div>

          {/* Venn Diagram */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Venn Diagram</h3>
            <p className="text-sm text-gray-600 mb-4">Generate Venn diagram for two pathways.</p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway 1 File (.txt)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setPathway1File(e.target.files?.[0] || null)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-200 disabled:bg-gray-100"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway 2 File (.txt)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setPathway2File(e.target.files?.[0] || null)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-200 disabled:bg-gray-100"
                />
              </div>
              <button
                type="button"
                onClick={handleVennDiagram}
                disabled={!isCorrelationReady || !pathway1File || !pathway2File || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-pink-300"
              >
                Generate
              </button>
            </div>
            {vennResult && vennResult.image_base64 && (
              <div className="mt-4 rounded-lg bg-white p-4 border border-pink-200">
                <img
                  src={`data:image/png;base64,${vennResult.image_base64}`}
                  alt="Venn Diagram"
                  className="w-full rounded-xl border border-gray-100 shadow"
                />
                <div className="mt-3 text-xs text-pink-700">
                  <p>Pathway 1: {vennResult.pathway1_size} genes</p>
                  <p>Pathway 2: {vennResult.pathway2_size} genes</p>
                  <p>Intersection: {vennResult.intersection_size} genes</p>
                </div>
              </div>
            )}
          </div>

          {/* Network Analysis */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Network Analysis</h3>
            <p className="text-sm text-gray-600 mb-4">Generate 2D or 3D network graph based on correlation threshold.</p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pathway File (Optional, .txt)
                </label>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => setNetworkPathwayFile(e.target.files?.[0] || null)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200 disabled:bg-gray-100"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Threshold
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={networkThreshold}
                  onChange={(e) => setNetworkThreshold(Number(e.target.value))}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200 disabled:bg-gray-100"
                />
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Dimensions
                </label>
                <select
                  value={networkDimensions}
                  onChange={(e) => setNetworkDimensions(Number(e.target.value) as 2 | 3)}
                  disabled={!isCorrelationReady}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200 disabled:bg-gray-100"
                >
                  <option value={2}>2D</option>
                  <option value={3}>3D</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleNetworkAnalysis}
                disabled={!isCorrelationReady || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300"
              >
                Generate Network
              </button>
            </div>
            {networkResult && (
              <div className="mt-4 rounded-lg bg-white p-4 border border-cyan-200">
                {networkResult.image_base64 ? (
                  <img
                    src={`data:image/png;base64,${networkResult.image_base64}`}
                    alt="Network Analysis"
                    className="w-full rounded-xl border border-gray-100 shadow"
                  />
                ) : networkResult.plot_type === 'plotly' && networkResult.content ? (
                  (() => {
                    try {
                      const plotData = typeof networkResult.content === 'string' 
                        ? JSON.parse(networkResult.content) 
                        : networkResult.content;
                      return (
                        <Plot
                          data={plotData.data}
                          layout={plotData.layout}
                          config={{ responsive: true, displayModeBar: true }}
                          style={{ width: '100%', height: networkDimensions === 3 ? '700px' : '600px' }}
                        />
                      );
                    } catch (e) {
                      return <p className="text-red-600">Error parsing network plot data</p>;
                    }
                  })()
                ) : null}
                <div className="mt-3 text-xs text-cyan-700">
                  <p>Nodes: {networkResult.n_nodes} | Edges: {networkResult.n_edges} | Threshold: {networkResult.threshold}</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="mt-10 rounded-3xl bg-white p-8 shadow-lg ring-1 ring-gray-100">
          <h2 className="text-xl font-semibold text-gray-900">Session Status</h2>
          <div className="mt-4 space-y-3 text-sm">
            {status && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-700">
                {status}
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-red-600">
                {error}
              </div>
            )}
            {!status && !error && (
              <p className="text-gray-500">
                Start by loading your IVCCA dataset (.xlsx, .csv, or .tsv). Follow the
                numbered workflow to reproduce the MATLAB pipeline.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}


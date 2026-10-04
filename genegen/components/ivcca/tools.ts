import type { ComponentType } from 'react';
import {
  BookOpen,
  ChartColumn,
  ChartScatter,
  CircleDot,
  Database,
  GitCompareArrows,
  GitFork,
  Grid3x3,
  Library,
  ListOrdered,
  Orbit,
  Share2,
  Sigma,
  Split,
  Target,
  Waypoints,
} from 'lucide-react';
import type { ToolId } from './types';

export type Requirement = 'none' | 'dataset' | 'correlation';

export type ToolDef = {
  id: ToolId;
  label: string;
  group: string;
  icon: ComponentType<{ className?: string }>;
  requires: Requirement;
  /** tool-state key whose `result` marks the tool as done */
  stateKey?: string;
};

/** Sidebar order of every IVCCA tool. */
export const TOOLS: ToolDef[] = [
  { id: 'data', label: 'Dataset', group: 'Workflow', icon: Database, requires: 'none' },
  { id: 'correlation', label: 'Correlation matrix', group: 'Workflow', icon: Sigma, requires: 'dataset' },
  { id: 'heatmap', label: 'Heatmap', group: 'Explore', icon: Grid3x3, requires: 'correlation' },
  { id: 'distribution', label: 'Distribution & pairs', group: 'Explore', icon: ChartColumn, requires: 'correlation' },
  { id: 'dendrogram', label: 'Dendrogram', group: 'Explore', icon: GitFork, requires: 'correlation', stateKey: 'dendrogram' },
  { id: 'optimal-k', label: 'Optimal clusters', group: 'Structure', icon: Target, requires: 'correlation', stateKey: 'optimal-k' },
  { id: 'pca', label: 'PCA', group: 'Structure', icon: Orbit, requires: 'correlation', stateKey: 'pca' },
  { id: 'tsne', label: 't-SNE', group: 'Structure', icon: ChartScatter, requires: 'correlation', stateKey: 'tsne' },
  { id: 'gene-sets', label: 'Gene set library', group: 'Gene sets', icon: Library, requires: 'none' },
  { id: 'pathway', label: 'Single pathway', group: 'Gene sets', icon: ListOrdered, requires: 'correlation' },
  { id: 'gene-genes', label: 'Gene → genes', group: 'Gene sets', icon: Waypoints, requires: 'correlation' },
  { id: 'gene-pathways', label: 'Gene → pathways', group: 'Gene sets', icon: Split, requires: 'correlation' },
  { id: 'ceci', label: 'Multi-pathway CECI', group: 'Gene sets', icon: CircleDot, requires: 'correlation', stateKey: 'ceci' },
  { id: 'compare', label: 'Pathway ↔ pathway', group: 'Gene sets', icon: GitCompareArrows, requires: 'correlation' },
  { id: 'network', label: 'Correlation network', group: 'Network', icon: Share2, requires: 'correlation' },
  { id: 'help', label: 'Help & guide', group: 'Help', icon: BookOpen, requires: 'none' },
];

export const GROUPS = ['Workflow', 'Explore', 'Structure', 'Gene sets', 'Network', 'Help'];

export const toolLabel = (id: ToolId) => TOOLS.find((t) => t.id === id)?.label ?? id;

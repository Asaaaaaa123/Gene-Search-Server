export const siteConfig = {
  name: 'Geno Intelligence',
  chemoTox: 'ChemoTox Explore',
  thematicGo: 'Thematic GO ontology',
  heroTitle: 'Computational Transcriptomics & Discovery Suite',
  tagline: 'Publication-ready gene intelligence at cosmic scale.',
  description:
    'Featuring ChemoTox™ collaborative gene expression resources for chemotherapy side effects, ThematicGO™ for ontology-driven transcriptomic discovery, and IVCCA™ (Inter-Variability Cross-Correlation Analysis) for multidimensional biological insight generation.',
  audience: 'Researchers, lab scientists, and bioinformatics professionals',
  producer: 'Zhimu Wang (Berezin Lab)',
  colors: {
    bg: '#0A0A0A',
    accent: '#00FFAA',
    accentAlt: '#22D3EE',
    purple: '#7C3AED',
  },
  links: {
    thematicGo: '/gene-ontology',
    geneSearch: '/gene-search',
    ivcca: '/ivcca',
    upload: '/upload-csv',
    dashboard: '/dashboard',
  },
  features: [
    {
      title: 'ChemoTox Explore',
      description:
        'Search across tissues with intelligent filtering, fold-change plots, and exportable result tables.',
      href: '/gene-search',
      icon: 'search' as const,
    },
    {
      title: 'Thematic GO ontology',
      description:
        'Cluster enrichment into biological themes with chord diagrams, overlap networks, and journal-grade heatmaps.',
      href: '/gene-ontology',
      icon: 'dna' as const,
    },
    {
      title: 'IVCCA',
      description:
        'Inter-variability cross-correlation with PCA, clustering, t-SNE, and interactive Plotly visualizations.',
      href: '/ivcca',
      icon: 'network' as const,
    },
    {
      title: 'Bulk Data Upload',
      description: 'Import CSV and gene lists to power downstream ontology and correlation pipelines.',
      href: '/upload-csv',
      icon: 'upload' as const,
    },
    {
      title: 'Theme Overlap Networks',
      description: 'Circular, chord, and log-scaled heatmap views of shared genes between GO themes.',
      href: '/gene-ontology/default-theme',
      icon: 'share' as const,
    },
    {
      title: 'Custom Theme Builder',
      description: 'Define keywords and themes for publication-specific ontology narratives.',
      href: '/gene-ontology/customize-theme',
      icon: 'sliders' as const,
    },
  ],
  steps: [
    { step: '01', title: 'Upload or search', body: 'Load a gene list or query expression data from the integrated database.' },
    { step: '02', title: 'Enrich & cluster', body: 'Run GProfiler-backed GO enrichment with thematic aggregation.' },
    { step: '03', title: 'Visualize', body: 'Generate networks, chords, and heatmaps with export-ready PNG/SVG.' },
    { step: '04', title: 'Publish', body: 'Download figures and gene lists formatted for top-tier journals.' },
  ],
  testimonials: [
    {
      quote: 'The thematic overlap chord view finally made our supplementary figures click with reviewers.',
      name: 'Dr. A. Chen',
      role: 'Computational biologist',
    },
    {
      quote: 'IVCCA clustering and PCA in one browser session replaced three desktop tools for our lab.',
      name: 'Prof. M. Rivera',
      role: 'Systems biology lab',
    },
    {
      quote: 'Clean exports and log heatmaps—exactly what we needed for a Nature-style submission.',
      name: 'Z. Wang',
      role: 'Berezin Lab',
    },
  ],
};

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface GeneData {
  organ: string;
  gene_symbol: string;
  gene_name: string;
  p_value: string;
  fdr_step_up: string;
  ratio: string;
  fold_change: string;
  lsmean_10mgkg: string;
  lsmean_control: string;
}

interface SearchResponse {
  gene_symbol: string;
  data: GeneData[];
}

interface PlotResponse {
  gene_symbol: string;
  image_base64: string;
}

interface GeneSymbol {
  symbol: string;
  name: string;
  tissue: string;
  expression: number;
}

export default function GeneSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTissue, setSelectedTissue] = useState('all');
  const [geneSymbols, setGeneSymbols] = useState<GeneSymbol[]>([]);
  const [filteredGenes, setFilteredGenes] = useState<GeneSymbol[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedGene, setSelectedGene] = useState<GeneSymbol | null>(null);
  
  // Original gene search functionality
  const [selectedGeneSymbol, setSelectedGeneSymbol] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GeneData[]>([]);
  const [currentPlot, setCurrentPlot] = useState<string>('');
  const [plotTitle, setPlotTitle] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isGeneratingPlot, setIsGeneratingPlot] = useState<boolean>(false);
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [connectionDetails, setConnectionDetails] = useState<string>('');

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Safe number formatting function
  const safeNumberFormat = (value: any, decimals: number = 3): string => {
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return 'N/A';
    return num.toFixed(decimals);
  };

  // Safe percentage calculation for progress bar
  const safePercentage = (value: any, max: number = 10): number => {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(value);
    if (isNaN(num)) return 0;
    return Math.min((num / max) * 100, 100);
  };

  const tissues = [
    { value: 'all', label: 'All Tissues', color: 'bg-gray-100 text-gray-800' },
    { value: 'BoneMarrow', label: 'Bone Marrow', color: 'bg-red-100 text-red-800' },
    { value: 'Cortex', label: 'Cortex', color: 'bg-blue-100 text-blue-800' },
    { value: 'DRG', label: 'DRG', color: 'bg-green-100 text-green-800' },
    { value: 'Fat', label: 'Fat', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'Heart', label: 'Heart', color: 'bg-pink-100 text-pink-800' },
    { value: 'Hypothalamus', label: 'Hypothalamus', color: 'bg-purple-100 text-purple-800' },
    { value: 'Kidneys', label: 'Kidneys', color: 'bg-indigo-100 text-indigo-800' },
    { value: 'Liver', label: 'Liver', color: 'bg-orange-100 text-orange-800' },
    { value: 'Muscle', label: 'Muscle', color: 'bg-teal-100 text-teal-800' }
  ];

  // Popular genes for quick selection
  const popularGenes = [
    { symbol: 'GAPDH', name: 'Glyceraldehyde-3-phosphate dehydrogenase', category: 'Housekeeping' },
    { symbol: 'ACTB', name: 'Actin beta', category: 'Housekeeping' },
    { symbol: 'TUBB', name: 'Tubulin beta class I', category: 'Cytoskeleton' },
    { symbol: 'HPRT1', name: 'Hypoxanthine phosphoribosyltransferase 1', category: 'Metabolism' },
    { symbol: 'PPIA', name: 'Peptidylprolyl isomerase A', category: 'Protein folding' },
    { symbol: 'RPL13A', name: 'Ribosomal protein L13a', category: 'Translation' },
    { symbol: 'B2M', name: 'Beta-2-microglobulin', category: 'Immune system' },
    { symbol: 'SDHA', name: 'Succinate dehydrogenase complex flavoprotein subunit A', category: 'Metabolism' },
    { symbol: 'TBP', name: 'TATA-box binding protein', category: 'Transcription' },
    { symbol: 'YWHAZ', name: 'Tyrosine 3-monooxygenase/tryptophan 5-monooxygenase activation protein zeta', category: 'Signaling' }
  ];

  useEffect(() => {
    loadGeneSymbols();
    checkApiStatus();
  }, []);

  useEffect(() => {
    filterGenes();
  }, [searchTerm, selectedTissue, geneSymbols]);

  const checkApiStatus = async () => {
    try {
      setApiStatus('checking');
      setConnectionDetails('Testing API connection...');
      
      // Try multiple endpoints to determine connection status
      const endpoints = [
        '/api/gene/symbols',
        '/api/health',
        '/docs',
        '/'
      ];
      
      let connected = false;
      let lastError = '';
      
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000) // 3 second timeout for each endpoint
          });
          
          if (response.ok) {
            connected = true;
            setApiStatus('connected');
            setConnectionDetails(`API is responding at ${endpoint}`);
            break;
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          console.log(`Failed to connect to ${endpoint}:`, error);
        }
      }
      
      if (!connected) {
        setApiStatus('disconnected');
        setConnectionDetails(`Could not connect to any API endpoints. Last error: ${lastError}`);
      }
    } catch (error) {
      console.log('API health check failed:', error);
      setApiStatus('disconnected');
      setConnectionDetails('API health check failed completely. Please check your backend configuration.');
    }
  };

  const loadGeneSymbols = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Check if the API endpoint exists before making the request
      const response = await fetch(`${API_BASE_URL}/api/gene/symbols`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // Add timeout and better error handling
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          // If endpoint doesn't exist, just log it and continue without error
          console.log('Gene symbols API endpoint not available, continuing without gene browser data');
          setGeneSymbols([]);
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      // Handle the API response format: {"gene_symbols": [...]}
      if (data.gene_symbols && Array.isArray(data.gene_symbols)) {
        // Convert to GeneSymbol objects - handle both string and object formats
        const validGeneSymbols = data.gene_symbols
          .filter((gene: any) => gene)
          .map((gene: any) => {
            // If it's a string, convert to object format
            if (typeof gene === 'string') {
              return {
                symbol: gene,
                name: gene,
                tissue: 'Unknown',
                expression: 0
              };
            }
            // If it's already an object with required fields, use it
            if (typeof gene === 'object' && gene.symbol) {
              return {
                symbol: gene.symbol,
                name: gene.name || gene.symbol,
                tissue: gene.tissue || 'Unknown',
                expression: gene.expression || 0
              };
            }
            return null;
          })
          .filter((gene: any) => gene !== null);
        setGeneSymbols(validGeneSymbols);
      } else if (Array.isArray(data)) {
        // Fallback for direct array response
        const validGeneSymbols = data
          .filter((gene: any) => gene)
          .map((gene: any) => {
            if (typeof gene === 'string') {
              return {
                symbol: gene,
                name: gene,
                tissue: 'Unknown',
                expression: 0
              };
            }
            if (typeof gene === 'object' && gene.symbol) {
              return {
                symbol: gene.symbol,
                name: gene.name || gene.symbol,
                tissue: gene.tissue || 'Unknown',
                expression: gene.expression || 0
              };
            }
            return null;
          })
          .filter((gene: any) => gene !== null);
        setGeneSymbols(validGeneSymbols);
      } else {
        console.log('Unexpected API response format:', data);
        setGeneSymbols([]);
      }
    } catch (error) {
      console.error('Error loading gene symbols:', error);
      // Don't show error to user if it's just a missing endpoint or network issue
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          console.log('Gene symbols API endpoint not available (network error), continuing without gene browser data');
          setGeneSymbols([]);
        } else if (error.name === 'AbortError') {
          console.log('Gene symbols API request timed out, continuing without gene browser data');
          setGeneSymbols([]);
        } else {
          setError('Failed to load gene symbols. Please try again later.');
        }
      } else {
        setError('Failed to load gene symbols. Please try again later.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const filterGenes = () => {
    let filtered = geneSymbols;

    // Filter by search term
    if (searchTerm.trim()) {
      filtered = filtered.filter(gene =>
        gene.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        gene.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filter by tissue
    if (selectedTissue !== 'all') {
      filtered = filtered.filter(gene => gene.tissue === selectedTissue);
    }

    setFilteredGenes(filtered);
  };

  const handleGeneSelect = (gene: GeneSymbol) => {
    setSelectedGene(gene);
    setSearchTerm(gene.symbol);
    setShowDropdown(false);
  };

  const handlePopularGeneSelect = (gene: { symbol: string; name: string; category: string }) => {
    // Find the gene in our actual data
    const foundGene = geneSymbols.find(g => g.symbol === gene.symbol);
    if (foundGene) {
      setSelectedGene(foundGene);
      setSearchTerm(gene.symbol);
    } else {
      // If not found in actual data, create a placeholder
      setSelectedGene({
        symbol: gene.symbol,
        name: gene.name,
        tissue: 'Unknown',
        expression: 0
      });
      setSearchTerm(gene.symbol);
    }
    setShowDropdown(false);
  };

  const clearSelection = () => {
    setSelectedGene(null);
    setSearchTerm('');
    setShowDropdown(false);
  };

  // Original gene search functionality
  const searchGene = async () => {
    if (!selectedGeneSymbol) {
      setError('Please enter a gene symbol');
      return;
    }

    setIsSearching(true);
    setError('');
    setSearchResults([]);
    setCurrentPlot('');
    setPlotTitle('');

    try {
      console.log('Searching for gene:', selectedGeneSymbol);
      console.log('API URL:', `${API_BASE_URL}/api/gene/symbol/search?gene_symbol=${selectedGeneSymbol}`);
      
      // First check if we can connect to the API
      if (apiStatus === 'disconnected') {
        setError('Cannot connect to the API. Please check your connection and try again.');
        return;
      }
      
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/search?gene_symbol=${selectedGeneSymbol}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000) // 15 second timeout for search
      });
      
      console.log('Search response status:', response.status);
      
      if (!response.ok) {
        if (response.status === 404) {
          setError('No results found for this gene symbol');
        } else {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return;
      }
      
      const data: SearchResponse = await response.json();
      console.log('Search response data:', data);
      
      // Validate the response data structure
      if (data && data.data && Array.isArray(data.data)) {
        // Filter out any invalid entries and ensure all required fields exist
        const validResults = data.data.filter(result => 
          result && 
          typeof result === 'object' &&
          result.gene_symbol &&
          result.organ
        );
        
        if (validResults.length > 0) {
          setSearchResults(validResults);
        } else {
          setSearchResults([]);
          setError('No valid results found for this gene symbol');
        }
      } else {
        setSearchResults([]);
        setError('Invalid response format from server');
      }
    } catch (error) {
      console.error('Error searching gene:', error);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          setError('Search request timed out. Please try again.');
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          setError(`Unable to connect to the server at ${API_BASE_URL}. Please check if the backend is running.`);
        } else {
          setError(`Failed to search for gene: ${error.message}`);
        }
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSearching(false);
    }
  };

  const showFoldChange = async () => {
    if (!selectedGeneSymbol) {
      setError('Please enter a gene symbol');
      return;
    }

    setIsGeneratingPlot(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/showFoldChange?gene_symbol=${selectedGeneSymbol}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20000) // 20 second timeout for chart generation
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: PlotResponse = await response.json();
      setCurrentPlot(`data:image/jpeg;base64,${data.image_base64}`);
      setPlotTitle(`Fold Change for ${selectedGeneSymbol}`);
    } catch (error) {
      console.error('Error generating fold change plot:', error);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          setError('Chart generation timed out. Please try again.');
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          setError('Unable to connect to the server. Please check your connection and try again.');
        } else {
          setError('Failed to generate fold change plot');
        }
      } else {
        setError('Failed to generate fold change plot');
      }
    } finally {
      setIsGeneratingPlot(false);
    }
  };

  const showLSMeanControl = async () => {
    if (!selectedGeneSymbol) {
      setError('Please enter a gene symbol');
      return;
    }

    setIsGeneratingPlot(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/showLSMeanControl?gene_symbol=${selectedGeneSymbol}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20000) // 20 second timeout for chart generation
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: PlotResponse = await response.json();
      setCurrentPlot(`data:image/jpeg;base64,${data.image_base64}`);
      setPlotTitle(`LSmean(Control) for ${selectedGeneSymbol}`);
    } catch (error) {
      console.error('Error generating LSmean(Control) plot:', error);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          setError('Chart generation timed out. Please try again.');
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          setError('Unable to connect to the server. Please check your connection and try again.');
        } else {
          setError('Failed to generate LSmean(Control) plot');
        }
      } else {
        setError('Failed to generate LSmean(Control) plot');
      }
    } finally {
      setIsGeneratingPlot(false);
    }
  };

  const showLSMean10mgkg = async () => {
    if (!selectedGeneSymbol) {
      setError('Please enter a gene symbol');
      return;
    }

    setIsGeneratingPlot(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/showLSMeanTenMgKg?gene_symbol=${selectedGeneSymbol}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20000) // 20 second timeout for chart generation
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: PlotResponse = await response.json();
      setCurrentPlot(`data:image/jpeg;base64,${data.image_base64}`);
      setPlotTitle(`LSmean(10mg/kg) for ${selectedGeneSymbol}`);
    } catch (error) {
      console.error('Error generating LSmean(10mg/kg) plot:', error);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          setError('Chart generation timed out. Please try again.');
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          setError('Unable to connect to the server. Please check your connection and try again.');
        } else {
          setError('Failed to generate LSmean(10mg/kg) plot');
        }
      } else {
        setError('Failed to generate LSmean(10mg/kg) plot');
      }
    } finally {
      setIsGeneratingPlot(false);
    }
  };

  const getTissueColor = (tissue: string) => {
    const tissueObj = tissues.find(t => t.value === tissue);
    return tissueObj ? tissueObj.color : 'bg-gray-100 text-gray-800';
  };

  const getTissueLabel = (tissue: string) => {
    const tissueObj = tissues.find(t => t.value === tissue);
    return tissueObj ? tissueObj.label : tissue;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Link href="/" className="flex items-center text-gray-600 hover:text-gray-900 transition-colors">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Home
              </Link>
            </div>
            <div className="flex items-center">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Gene Expression Search</h1>
            </div>
            
            {/* API Status Indicator */}
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${
                apiStatus === 'connected' ? 'bg-green-500' : 
                apiStatus === 'disconnected' ? 'bg-red-500' : 'bg-yellow-500'
              }`}></div>
              <span className={`text-sm ${
                apiStatus === 'connected' ? 'text-green-600' : 
                apiStatus === 'disconnected' ? 'text-red-600' : 'text-yellow-600'
              }`}>
                {apiStatus === 'connected' ? 'Connected' : 
                 apiStatus === 'disconnected' ? 'Disconnected' : 'Checking...'}
              </span>
              {apiStatus === 'disconnected' && (
                <button
                  onClick={() => {
                    setApiStatus('checking');
                    checkApiStatus();
                  }}
                  className="ml-2 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => {
                  setApiStatus('checking');
                  checkApiStatus();
                }}
                className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
              >
                Test Connection
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Status Panel */}
      {apiStatus === 'disconnected' && (
        <div className="bg-red-50 border border-red-200 mx-4 sm:mx-6 lg:mx-8 mb-6 rounded-xl p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-red-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-800">API Connection Issue</h3>
              <p className="text-sm text-red-700 mt-1">{connectionDetails}</p>
              <div className="mt-2 text-xs text-red-600">
                <p><strong>Current API URL:</strong> {API_BASE_URL}</p>
                <p><strong>Environment:</strong> {process.env.NODE_ENV || 'development'}</p>
              </div>
              <div className="mt-2 text-xs text-red-600">
                <p><strong>Troubleshooting:</strong></p>
                <ul className="list-disc list-inside ml-2 mt-1 space-y-1">
                  <li>Ensure your backend server is running</li>
                  <li>Check if the API URL is correct</li>
                  <li>Verify no firewall is blocking the connection</li>
                  <li>For cloud deployment, update NEXT_PUBLIC_API_URL in .env.local</li>
                </ul>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setApiStatus('checking');
                    checkApiStatus();
                  }}
                  className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                >
                  Test Connection
                </button>
                <button
                  onClick={() => {
                    // Try to open the API URL in a new tab
                    window.open(`${API_BASE_URL}/docs`, '_blank');
                  }}
                  className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                >
                  Open API Docs
                </button>
                <a
                  href="/API_SETUP.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                >
                  Setup Guide
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Advanced <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">Gene Search</span> Platform
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Search and analyze gene expression data across multiple tissues with intelligent filtering and comprehensive results
          </p>
        </div>

        {/* Gene Search Section */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-8">
          <h3 className="text-xl font-semibold text-gray-900 mb-6">Gene Expression Analysis</h3>
          
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Gene Symbol Input */}
            <div>
              <label htmlFor="gene-symbol" className="block text-sm font-medium text-gray-700 mb-2">
                Gene Symbol
              </label>
              <input
                id="gene-symbol"
                type="text"
                value={selectedGeneSymbol}
                onChange={(e) => setSelectedGeneSymbol(e.target.value)}
                placeholder="Enter gene symbol (e.g., GAPDH, ACTB)"
                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Search Button */}
            <div className="flex items-end">
              <button
                onClick={searchGene}
                disabled={isSearching || !selectedGeneSymbol}
                className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSearching ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Searching...
                  </>
                ) : (
                  'Search Gene'
                )}
              </button>
            </div>
          </div>

          {/* Chart Generation Buttons */}
          {searchResults.length > 0 && (
            <div className="border-t border-gray-200 pt-6">
              <h4 className="text-lg font-medium text-gray-900 mb-4">Generate Charts</h4>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={showFoldChange}
                  disabled={isGeneratingPlot}
                  className="px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {isGeneratingPlot ? 'Generating...' : 'Show Fold Change'}
                </button>
                <button
                  onClick={showLSMeanControl}
                  disabled={isGeneratingPlot}
                  className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {isGeneratingPlot ? 'Generating...' : 'Show LSmean (Control)'}
                </button>
                <button
                  onClick={showLSMean10mgkg}
                  disabled={isGeneratingPlot}
                  className="px-4 py-2 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
                >
                  {isGeneratingPlot ? 'Generating...' : 'Show LSmean (10mg/kg)'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Gene Browser Section */}
        {geneSymbols.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-6">Gene Browser & Tissue Filter</h3>
            
            <div className="grid md:grid-cols-2 gap-6">
              {/* Gene Selection */}
              <div>
                <label htmlFor="gene-select" className="block text-sm font-medium text-gray-700 mb-2">
                  Browse Genes
                </label>
                <div className="relative">
                  <div className="flex">
                    <input
                      id="gene-select"
                      type="text"
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setShowDropdown(true);
                        setSelectedGene(null);
                      }}
                      onFocus={() => setShowDropdown(true)}
                      placeholder="Search or select a gene..."
                      className="block w-full pl-4 pr-10 py-3 border border-gray-300 rounded-l-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    />
                    <button
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="px-3 py-3 bg-gray-100 border border-l-0 border-gray-300 rounded-r-xl hover:bg-gray-200 transition-colors"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {/* Dropdown */}
                  {showDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-xl shadow-lg max-h-96 overflow-y-auto">
                      {/* Popular Genes Section */}
                      <div className="p-3 border-b border-gray-200">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Popular Genes</h4>
                        <div className="grid grid-cols-1 gap-1">
                          {popularGenes.map((gene) => (
                            <button
                              key={gene.symbol}
                              onClick={() => handlePopularGeneSelect(gene)}
                              className="w-full text-left p-2 rounded-lg hover:bg-blue-50 transition-colors"
                            >
                              <div className="font-medium text-gray-900">{gene.symbol}</div>
                              <div className="text-xs text-gray-500 truncate">{gene.name}</div>
                              <div className="text-xs text-blue-600">{gene.category}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Search Results Section */}
                      <div className="p-3">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Search Results</h4>
                        {filteredGenes.length > 0 ? (
                          <div className="space-y-1">
                            {filteredGenes.slice(0, 20).map((gene, index) => (
                              <button
                                key={`${gene.symbol}-${gene.tissue}-${index}`}
                                onClick={() => handleGeneSelect(gene)}
                                className="w-full text-left p-2 rounded-lg hover:bg-blue-50 transition-colors"
                              >
                                <div className="font-medium text-gray-900">{gene.symbol}</div>
                                <div className="text-xs text-gray-500 truncate">{gene.name}</div>
                                <div className="text-xs text-blue-600">{getTissueLabel(gene.tissue)}</div>
                              </button>
                            ))}
                            {filteredGenes.length > 20 && (
                              <div className="text-xs text-gray-500 text-center py-2">
                                Showing first 20 results. Type more to narrow down.
                              </div>
                            )}
                          </div>
                        ) : searchTerm && (
                          <div className="text-sm text-gray-500 py-2">No genes found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected Gene Display */}
                {selectedGene && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-blue-900">{selectedGene.symbol}</div>
                        <div className="text-sm text-blue-700">{selectedGene.name}</div>
                        <div className="text-xs text-blue-600">{getTissueLabel(selectedGene.tissue)}</div>
                      </div>
                      <button
                        onClick={clearSelection}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Tissue Filter */}
              <div>
                <label htmlFor="tissue" className="block text-sm font-medium text-gray-700 mb-2">
                  Filter by Tissue
                </label>
                <select
                  id="tissue"
                  value={selectedTissue}
                  onChange={(e) => setSelectedTissue(e.target.value)}
                  className="block w-full px-3 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  {tissues.map((tissue) => (
                    <option key={tissue.value} value={tissue.value}>
                      {tissue.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Search Stats */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex flex-wrap items-center justify-between text-sm text-gray-600">
                <div className="flex items-center space-x-4">
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {filteredGenes.length} genes found
                  </span>
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7c0-2.21-3.582-4-8-4s-8 1.79-8 4z" />
                    </svg>
                    {tissues.length - 1} tissue types
                  </span>
                </div>
                {isLoading && (
                  <div className="flex items-center text-blue-600">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Gene Browser Not Available Message */}
        {!isLoading && geneSymbols.length === 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
            <div className="flex items-center">
              <svg className="w-6 h-6 text-blue-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-blue-800">Gene Browser Temporarily Unavailable</h3>
                                 <p className="text-sm text-blue-700 mt-1">
                   {apiStatus === 'disconnected' 
                     ? 'Unable to connect to the server. Please ensure the backend is running and accessible.'
                     : ''
                   }
                 </p>
                {apiStatus === 'disconnected' && (
                  <div className="mt-2 text-xs text-blue-600">
                    <p>• Check if the backend server is running</p>
                    <p>• Verify the API URL: {API_BASE_URL}</p>
                    <p>• Ensure no firewall is blocking the connection</p>
                    <button
                      onClick={() => {
                        setApiStatus('checking');
                        checkApiStatus();
                        loadGeneSymbols();
                      }}
                      className="mt-2 px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                    >
                      Retry Connection
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Search Results Table */}
        {searchResults.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Search Results for {selectedGeneSymbol}</h3>
              <p className="text-sm text-gray-600">{searchResults.length} data points found</p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Organ</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gene Symbol</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gene Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">P-value</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FDR Step Up</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ratio</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fold Change</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">LSMean (10mg/kg)</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">LSMean (Control)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {searchResults.map((result, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{result.organ || 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{result.gene_symbol || 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{result.gene_name || 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{safeNumberFormat(result.p_value, 3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{safeNumberFormat(result.fdr_step_up, 3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{safeNumberFormat(result.ratio, 3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{safeNumberFormat(result.fold_change, 3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{safeNumberFormat(result.lsmean_10mgkg, 3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{safeNumberFormat(result.lsmean_control, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Chart Display */}
        {currentPlot && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{plotTitle}</h3>
            <div className="flex justify-center">
              <img 
                src={currentPlot} 
                alt={plotTitle}
                className="max-w-full h-auto rounded-lg shadow-sm"
              />
            </div>
          </div>
        )}

        {/* Gene Browser Results */}
        {geneSymbols.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Gene Browser Results</h3>
            </div>
            
            {filteredGenes.length === 0 && !isLoading ? (
              <div className="p-12 text-center">
                <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No genes found</h3>
                <p className="text-gray-500">
                  {searchTerm || selectedTissue !== 'all' 
                    ? 'Try adjusting your search terms or tissue filter'
                    : 'Start typing to search for genes or select from popular options'
                  }
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Gene Symbol
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-800 uppercase tracking-wider">
                        Gene Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tissue
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Expression Level
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredGenes.map((gene, index) => (
                      <tr key={`${gene.symbol}-${gene.tissue}-${index}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{gene.symbol}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600 max-w-xs truncate" title={gene.name}>
                            {gene.name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getTissueColor(gene.tissue)}`}>
                            {getTissueLabel(gene.tissue)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-16 bg-gray-200 rounded-full h-2 mr-3">
                              <div 
                                className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${safePercentage(gene.expression, 10)}%` }}
                              ></div>
                            </div>
                            <span className="text-sm text-gray-600">{safeNumberFormat(gene.expression, 2)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyze Genes</h3>
            <p className="text-gray-600 mb-4 text-sm">
              Take your search results to the next level with comprehensive ontology analysis
            </p>
            <Link 
              href="/gene-ontology"
              className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium text-sm"
            >
              Start Analysis
              <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-200">
            <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Export Data</h3>
            <p className="text-gray-600 mb-4 text-sm">
              Download your search results in various formats for further analysis
            </p>
            <button className="inline-flex items-center text-green-600 hover:text-green-700 font-medium text-sm">
              Export Results
              <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl p-6 border border-purple-200">
            <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Get Help</h3>
            <p className="text-gray-600 mb-4 text-sm">
              Need assistance? Our support team is here to help you succeed
            </p>
            <button className="inline-flex items-center text-purple-600 hover:text-purple-700 font-medium text-sm">
              Contact Support
              <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 
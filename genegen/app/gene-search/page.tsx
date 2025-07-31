'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
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

export default function GeneSearch() {
  const [geneSymbols, setGeneSymbols] = useState<string[]>([]);
  const [filteredGenes, setFilteredGenes] = useState<string[]>([]);
  const [selectedGene, setSelectedGene] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GeneData[]>([]);
  const [currentPlot, setCurrentPlot] = useState<string>('');
  const [plotTitle, setPlotTitle] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [success, setSuccess] = useState<string>('');

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  // Create a search index for better performance
  const searchIndex = useMemo(() => {
    const index: { [key: string]: string[] } = {};
    
    geneSymbols.forEach(gene => {
      const lowerGene = gene.toLowerCase();
      
      // Create prefixes for faster prefix matching
      for (let i = 1; i <= Math.min(lowerGene.length, 10); i++) {
        const prefix = lowerGene.substring(0, i);
        if (!index[prefix]) {
          index[prefix] = [];
        }
        index[prefix].push(gene);
      }
      
      // Also add exact matches
      if (!index[lowerGene]) {
        index[lowerGene] = [];
      }
      index[lowerGene].push(gene);
    });
    
    return index;
  }, [geneSymbols]);

  // Debug logging
  useEffect(() => {
    console.log('API_BASE_URL:', API_BASE_URL);
    console.log('Environment variables:', {
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      NODE_ENV: process.env.NODE_ENV
    });
  }, [API_BASE_URL]);

  useEffect(() => {
    loadGeneSymbols();
  }, []);



  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const loadGeneSymbols = async () => {
    try {
      console.log('Attempting to fetch gene symbols from:', `${API_BASE_URL}/api/gene/symbols`);
      const response = await fetch(`${API_BASE_URL}/api/gene/symbols`);
      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Gene symbols data:', data);
      setGeneSymbols(data.gene_symbols);
      setFilteredGenes(data.gene_symbols.slice(0, 100)); // Only show first 100 initially
    } catch (error) {
      console.error('Error loading gene symbols:', error);
      setError(`Failed to load gene symbols: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Optimized filter function using search index
  const filterGenesOptimized = (searchTerm: string) => {
    const term = searchTerm.toLowerCase().trim();
    
    if (term === '') {
      // Show first 100 genes when search is empty
      setFilteredGenes(geneSymbols.slice(0, 100));
      return;
    }

    // Use search index for faster matching
    const results = new Set<string>();
    
    // Check for prefix matches first (most efficient)
    if (searchIndex[term]) {
      searchIndex[term].forEach(gene => results.add(gene));
    }
    
    // Also check for partial matches in the first few characters
    for (let i = 1; i <= Math.min(term.length, 5); i++) {
      const prefix = term.substring(0, i);
      if (searchIndex[prefix]) {
        searchIndex[prefix].forEach(gene => {
          if (gene.toLowerCase().includes(term)) {
            results.add(gene);
          }
        });
      }
    }
    
    // Convert to array and limit results
    const filtered = Array.from(results).slice(0, 50);
    setFilteredGenes(filtered);
  };

  // Debounced filter function
  const debouncedFilterGenes = (searchTerm: string) => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      filterGenesOptimized(searchTerm);
    }, 200); // Reduced to 200ms for better responsiveness
  };

  const handleGeneSelect = (gene: string) => {
    setSelectedGene(gene);
    setIsDropdownOpen(false);
  };

  const handleInputChange = (value: string) => {
    setSelectedGene(value);
    
    if (value.trim() === '') {
      // If input is empty, show first 100 genes
      setFilteredGenes(geneSymbols.slice(0, 100));
      setIsDropdownOpen(true);
    } else {
      // Use debounced filter for non-empty input
      debouncedFilterGenes(value);
      setIsDropdownOpen(true);
    }
  };

  const searchGene = async () => {
    if (!selectedGene) {
      setError('Please enter a gene symbol');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('Searching for gene:', selectedGene);
      console.log('API URL:', `${API_BASE_URL}/api/gene/symbol/search?gene_symbol=${selectedGene}`);
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/search?gene_symbol=${selectedGene}`);
      console.log('Search response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: SearchResponse = await response.json();
      console.log('Search response data:', data);
      
      if (data.data && data.data.length > 0) {
        setSearchResults(data.data);
      } else {
        setSearchResults([]);
        setError('No results found for this gene symbol');
      }
    } catch (error) {
      console.error('Error searching gene:', error);
      setError(`Failed to search for gene: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const showFoldChange = async () => {
    if (!selectedGene) {
      setError('Please enter a gene symbol');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/showFoldChange?gene_symbol=${selectedGene}`);
      const data: PlotResponse = await response.json();
      setCurrentPlot(`data:image/jpeg;base64,${data.image_base64}`);
      setPlotTitle(`Fold Change for ${selectedGene}`);
    } catch (error) {
      setError('Failed to generate fold change plot');
      console.error('Error generating fold change plot:', error);
    } finally {
      setLoading(false);
    }
  };

  const showLSMeanControl = async () => {
    if (!selectedGene) {
      setError('Please enter a gene symbol');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/showLSMeanControl?gene_symbol=${selectedGene}`);
      const data: PlotResponse = await response.json();
      setCurrentPlot(`data:image/jpeg;base64,${data.image_base64}`);
      setPlotTitle(`LSmean(Control) for ${selectedGene}`);
    } catch (error) {
      setError('Failed to generate LSmean(Control) plot');
      console.error('Error generating LSmean(Control) plot:', error);
    } finally {
      setLoading(false);
    }
  };

  const showLSMean10mgkg = async () => {
    if (!selectedGene) {
      setError('Please enter a gene symbol');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/showLSMeanTenMgKg?gene_symbol=${selectedGene}`);
      const data: PlotResponse = await response.json();
      setCurrentPlot(`data:image/jpeg;base64,${data.image_base64}`);
      setPlotTitle(`LSmean(10mg/kg) for ${selectedGene}`);
    } catch (error) {
      setError('Failed to generate LSmean(10mg/kg) plot');
      console.error('Error generating LSmean(10mg/kg) plot:', error);
    } finally {
      setLoading(false);
    }
  };



  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const authToken = localStorage.getItem('authToken');
      if (!authToken) {
        setError('Authentication token not found. Please login again.');
        return;
      }
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE_URL}/api/gene/upload_csv?token=${authToken}`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      setSuccess('CSV uploaded successfully!');
    } catch (error) {
      setError(`Failed to upload CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header with back button */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Gene Expression Search
            </h1>
            <p className="text-lg text-gray-600">Berezin Lab</p>
          </div>
          <Link 
            href="/"
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </Link>
        </div>

        {/* Gene Input Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="flex-1 relative" ref={dropdownRef}>
              <label htmlFor="gene-symbol" className="block text-sm font-medium text-gray-700 mb-2">
                Gene Symbol:
              </label>
              <div className="relative">
                <input
                  id="gene-symbol"
                  type="text"
                  value={selectedGene}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onFocus={() => setIsDropdownOpen(true)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500"
                  placeholder="Enter gene symbol..."
                />
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              
              {/* Dropdown */}
              {isDropdownOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {filteredGenes.length > 0 ? (
                    filteredGenes.slice(0, 50).map((gene) => (
                      <button
                        key={gene}
                        type="button"
                        onClick={() => handleGeneSelect(gene)}
                        className="w-full px-3 py-2 text-left text-gray-900 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                      >
                        {gene}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-gray-500">No genes found</div>
                  )}
                  {filteredGenes.length > 50 && (
                    <div className="px-3 py-2 text-gray-500 text-sm border-t">
                      Showing first 50 results. Type more to narrow down.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={searchGene}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={showFoldChange}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Show Fold Change
              </button>
              <button
                onClick={showLSMeanControl}
                disabled={loading}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Show LSmean (Control)
              </button>
              <button
                onClick={showLSMean10mgkg}
                disabled={loading}
                className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Show LSmean (10mg/kg)
              </button>
              {/* Upload Gene CSV File Button */}
              <button
                onClick={() => { window.location.href = '/login'; }}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                Upload Gene CSV File
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}
        {/* Success Message */}
        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
            {success}
          </div>
        )}

        {/* Results Table */}
        {searchResults.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900">Search Results</h2>
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
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{result.organ}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.gene_symbol}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.gene_name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{Number(result.p_value).toFixed(3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{Number(result.fdr_step_up).toFixed(3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{Number(result.ratio).toFixed(3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{Number(result.fold_change).toFixed(3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{Number(result.lsmean_10mgkg).toFixed(3)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{Number(result.lsmean_control).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Plot Display */}
        {currentPlot && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900">{plotTitle}</h2>
            <div className="flex justify-center">
              <img 
                src={currentPlot} 
                alt={plotTitle}
                className="max-w-full h-auto rounded-lg shadow-sm"
              />
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {loading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="text-gray-700">Loading...</span>
            </div>
          </div>
        )}

        {/* Hidden file input for CSV upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
} 
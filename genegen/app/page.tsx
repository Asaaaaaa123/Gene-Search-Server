'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

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

export default function Home() {
  const [geneSymbols, setGeneSymbols] = useState<string[]>([]);
  const [filteredGenes, setFilteredGenes] = useState<string[]>([]);
  const [selectedGene, setSelectedGene] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GeneData[]>([]);
  const [currentPlot, setCurrentPlot] = useState<string>('');
  const [plotTitle, setPlotTitle] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  useEffect(() => {
    loadGeneSymbols();
  }, []);

  const loadGeneSymbols = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbols`);
      const data = await response.json();
      setGeneSymbols(data.gene_symbols);
      setFilteredGenes(data.gene_symbols);
    } catch (error) {
      setError('Failed to load gene symbols');
      console.error('Error loading gene symbols:', error);
    }
  };

  const filterGenes = (searchTerm: string) => {
    const filtered = geneSymbols.filter(gene => 
      gene.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredGenes(filtered);
  };

  const searchGene = async () => {
    if (!selectedGene) {
      setError('Please enter a gene symbol');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/gene/symbol/search?gene_symbol=${selectedGene}`);
      const data: SearchResponse = await response.json();
      
      if (data.data && data.data.length > 0) {
        setSearchResults(data.data);
      } else {
        setSearchResults([]);
        setError('No results found for this gene symbol');
      }
    } catch (error) {
      setError('Failed to search for gene');
      console.error('Error searching gene:', error);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Gene Expression Search
          </h1>
          <p className="text-lg text-gray-600">Berezin Lab</p>
        </div>

        {/* Gene Input Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="flex-1">
              <label htmlFor="gene-symbol" className="block text-sm font-medium text-gray-700 mb-2">
                Gene Symbol:
              </label>
              <input
                id="gene-symbol"
                type="text"
                value={selectedGene}
                onChange={(e) => {
                  setSelectedGene(e.target.value);
                  filterGenes(e.target.value);
                }}
                list="gene-list"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter gene symbol..."
              />
              <datalist id="gene-list">
                {filteredGenes.map((gene, index) => (
                  <option key={index} value={gene} />
                ))}
              </datalist>
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
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {/* Results Table */}
        {searchResults.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Search Results</h2>
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.p_value}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.fdr_step_up}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.ratio}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.fold_change}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.lsmean_10mgkg}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.lsmean_control}</td>
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
            <h2 className="text-xl font-semibold mb-4">{plotTitle}</h2>
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
      </div>
    </div>
  );
}

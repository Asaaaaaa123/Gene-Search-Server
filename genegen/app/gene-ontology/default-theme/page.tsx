'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';

interface OntologyResult {
  theme: string;
  score: number;
  terms: number;
}

interface SubtermResult {
  name: string;
  score: number;
}

export default function DefaultTheme() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<OntologyResult[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string>('');
  const [subtermResults, setSubtermResults] = useState<SubtermResult[]>([]);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [currentChart, setCurrentChart] = useState<string>('');
  const [summaryChart, setSummaryChart] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        setSelectedFile(file);
        setError('');
        setSuccess('');
        setResults([]);
        setSubtermResults([]);
        setCurrentChart('');
        setSummaryChart('');
      } else {
        setError('Please select a valid text file (.txt)');
        setSelectedFile(null);
      }
    }
  };

  const handleFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const analyzeGenes = async () => {
    if (!selectedFile) {
      setError('Please select a gene file first');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setSuccess('');
    setResults([]);
    setSubtermResults([]);
    setCurrentChart('');
    setSummaryChart('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${API_BASE_URL}/api/ontology/analyze`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('API response data:', data);
      
      const results = data.results || [];
      console.log('Results array:', results);
      console.log('Results length:', results.length);
      
      setResults(results);
      setSuccess('Gene ontology analysis completed successfully!');
      
              if (results.length > 0) {
          const availableThemes = results.map((r: OntologyResult) => r.theme);
          console.log('Available themes from analysis:', availableThemes);
          console.log('Available themes count:', availableThemes.length);
          
          await generateSummaryChart();
        }
    } catch (error) {
      console.error('Error analyzing genes:', error);
      setError(`Failed to analyze genes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateThemeChart = async (themeName: string) => {
    if (!selectedFile) {
      setError('Please select a gene file first');
      return;
    }

    setIsAnalyzing(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('theme', themeName);

      const response = await fetch(`${API_BASE_URL}/api/ontology/theme-chart`, {
        method: 'POST',
        body: formData,
      });

      console.log(`Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      setCurrentChart(`data:image/png;base64,${data.chart_base64}`);
      setSubtermResults(data.subterms || []);
      setSelectedTheme(themeName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(`Failed to generate chart: ${errorMessage}`);
      console.error('Error generating theme chart:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateSummaryChart = async () => {
    try {
      setError('');
      
      if (!selectedFile) {
        setError('No file selected');
        return;
      }

      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${API_BASE_URL}/api/ontology/summary-chart`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Summary chart generation failed:', response.status, errorText);
        throw new Error(`Failed to generate summary chart: HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      setSummaryChart(`data:image/png;base64,${data.chart}`);
      
    } catch (error) {
      console.error('Error generating summary chart:', error);
      setError(`Failed to generate summary chart: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const downloadResults = () => {
    if (results.length === 0) {
      setError('No results to download');
      return;
    }

    const csvContent = [
      'Theme,Score,Terms',
      ...results.map(result => `${result.theme},${result.score},${result.terms}`)
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gene_ontology_results.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header with back button */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Default Theme Analysis
            </h1>
            <p className="text-lg text-gray-600">Interactive functional enrichment analysis with predefined themes</p>
          </div>
          <Link 
            href="/gene-ontology"
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Options
          </Link>
        </div>

        {/* File Upload Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900">Gene File Selection</h2>
          
          <div className="space-y-6">
            {/* Custom File Upload */}
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Upload Gene File</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Gene List File (.txt)
                  </label>
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={handleFileUpload}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                    >
                      Choose File
                    </button>
                    {selectedFile && (
                      <span className="text-sm text-gray-600">
                        Selected: {selectedFile.name}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    Upload a text file containing one gene symbol per line
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <button
                  onClick={analyzeGenes}
                  disabled={!selectedFile || isAnalyzing}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isAnalyzing ? 'Analyzing...' : 'Analyze Genes'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Error and Success Messages */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}
        
        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
            {success}
          </div>
        )}

        {/* Results and Interactive Section */}
        {results.length > 0 && (
          <>
            {/* Summary Chart Section */}
            {summaryChart && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h3 className="text-lg font-semibold mb-4 text-gray-900">Analysis Summary</h3>
                <div className="flex justify-center">
                  <img 
                    src={summaryChart} 
                    alt="Gene Ontology Analysis Summary" 
                    className="w-full max-w-5xl h-auto"
                    style={{ minHeight: '300px' }}
                  />
                </div>
              </div>
            )}
            
            {/* Theme Selection and Results Table */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* Left Side - Theme Selection */}
              <div className="lg:col-span-1 space-y-6">
                {/* Theme Selection */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold mb-4 text-gray-900">Select Theme for Detailed Analysis</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {results.map((result) => (
                      <button
                        key={result.theme}
                        onClick={() => generateThemeChart(result.theme)}
                        disabled={isAnalyzing}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selectedTheme === result.theme
                            ? 'bg-blue-50 border-blue-300 text-black'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100 text-black'
                        } ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <div className="font-bold text-black">{result.theme}</div>
                        <div className="text-sm text-gray-700 mt-1">
                          Score: {result.score.toFixed(3)} | Terms: {result.terms}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subterm Results */}
                {subtermResults.length > 0 && (
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900">
                      Top GO Terms in {selectedTheme}
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {subtermResults.map((subterm, index) => (
                        <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                          <span className="text-sm text-gray-900">{subterm.name}</span>
                          <span className="text-sm font-medium text-blue-600">
                            {subterm.score.toFixed(3)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side - Results Table */}
              <div className="lg:col-span-2 space-y-6">
                {/* Main Results Table */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Analysis Results</h3>
                    <button
                      onClick={downloadResults}
                      className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                    >
                      Download Results
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/3">
                            Theme
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/6">
                            Score
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/6">
                            Terms
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {results.map((result, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-medium text-gray-900">
                              {result.theme}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {result.score.toFixed(3)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {result.terms}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Instructions */}
                {!currentChart && (
                  <div className="bg-blue-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-blue-900 mb-3">How to Use</h3>
                    <div className="text-blue-800 space-y-2 text-sm">
                      <p>1. Upload your gene list file (.txt format)</p>
                      <p>2. Click &quot;Analyze Genes&quot; to perform the initial analysis</p>
                      <p>3. Select a theme from the left panel to generate detailed charts</p>
                      <p>4. View the interactive charts and subterm results on the right</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Theme Chart Display - Full Width at Bottom */}
            {currentChart && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h3 className="text-lg font-semibold mb-4 text-gray-900">
                  {selectedTheme} - GO Terms
                </h3>
                <div className="flex justify-center">
                  <img 
                    src={currentChart} 
                    alt={`${selectedTheme} GO Terms Chart`}
                    className="w-full max-w-7xl h-auto rounded-lg shadow-sm"
                    style={{ minHeight: '700px' }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Information Section */}
        <div className="bg-blue-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">About Default Theme Analysis</h3>
          <div className="text-blue-800 space-y-2">
            <p>
              This analysis uses predefined biological themes to perform functional enrichment analysis on your gene list.
            </p>
            <p>
              The system automatically identifies the most relevant themes from your gene set and provides detailed analysis for each theme.
            </p>
            <p>
              <strong>Features:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Automatic theme detection from your gene list</li>
              <li>Interactive theme selection with predefined biological themes</li>
              <li>Dynamic chart generation for each selected theme</li>
              <li>Detailed subterm analysis with scores</li>
              <li>Export results to CSV format</li>
            </ul>
          </div>
        </div>

        {/* Loading Indicator */}
        {isAnalyzing && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
              <span className="text-gray-700">Processing...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 
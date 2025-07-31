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

interface ThemeOption {
  id: string;
  name: string;
  description: string;
  category: string;
}

export default function CustomizeTheme() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
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

  // Predefined theme options
  const themeOptions: ThemeOption[] = [
    // Biological Processes
    { id: 'metabolism', name: 'Metabolism', description: 'Metabolic processes and pathways', category: 'Biological Process' },
    { id: 'cell_cycle', name: 'Cell Cycle', description: 'Cell division and cycle regulation', category: 'Biological Process' },
    { id: 'apoptosis', name: 'Apoptosis', description: 'Programmed cell death', category: 'Biological Process' },
    { id: 'immune_response', name: 'Immune Response', description: 'Immune system and defense', category: 'Biological Process' },
    { id: 'development', name: 'Development', description: 'Organism development and differentiation', category: 'Biological Process' },
    { id: 'signaling', name: 'Signaling', description: 'Cell signaling and communication', category: 'Biological Process' },
    { id: 'transport', name: 'Transport', description: 'Molecular transport and trafficking', category: 'Biological Process' },
    { id: 'transcription', name: 'Transcription', description: 'Gene transcription and regulation', category: 'Biological Process' },
    { id: 'translation', name: 'Translation', description: 'Protein translation and synthesis', category: 'Biological Process' },
    { id: 'stress_response', name: 'Stress Response', description: 'Cellular stress and adaptation', category: 'Biological Process' },
    
    // Molecular Functions
    { id: 'enzyme_activity', name: 'Enzyme Activity', description: 'Catalytic and enzymatic functions', category: 'Molecular Function' },
    { id: 'binding', name: 'Binding', description: 'Molecular binding and interactions', category: 'Molecular Function' },
    { id: 'receptor_activity', name: 'Receptor Activity', description: 'Receptor and signal transduction', category: 'Molecular Function' },
    { id: 'transporter_activity', name: 'Transporter Activity', description: 'Membrane transport functions', category: 'Molecular Function' },
    { id: 'structural_molecule', name: 'Structural Molecule', description: 'Structural and architectural functions', category: 'Molecular Function' },
    
    // Cellular Components
    { id: 'membrane', name: 'Membrane', description: 'Membrane and membrane-bound organelles', category: 'Cellular Component' },
    { id: 'nucleus', name: 'Nucleus', description: 'Nuclear components and processes', category: 'Cellular Component' },
    { id: 'cytoplasm', name: 'Cytoplasm', description: 'Cytoplasmic components and processes', category: 'Cellular Component' },
    { id: 'mitochondria', name: 'Mitochondria', description: 'Mitochondrial functions and processes', category: 'Cellular Component' },
    { id: 'endoplasmic_reticulum', name: 'Endoplasmic Reticulum', description: 'ER and secretory pathway', category: 'Cellular Component' },
    { id: 'golgi', name: 'Golgi Apparatus', description: 'Golgi complex and vesicle trafficking', category: 'Cellular Component' },
    { id: 'cytoskeleton', name: 'Cytoskeleton', description: 'Cytoskeletal components and organization', category: 'Cellular Component' },
  ];

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

  const handleThemeToggle = (themeId: string) => {
    setSelectedThemes(prev => 
      prev.includes(themeId) 
        ? prev.filter(id => id !== themeId)
        : [...prev, themeId]
    );
  };

  const analyzeGenes = async () => {
    if (!selectedFile) {
      setError('Please select a gene file first');
      return;
    }

    if (selectedThemes.length === 0) {
      setError('Please select at least one theme for analysis');
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
      formData.append('themes', JSON.stringify(selectedThemes));

      const response = await fetch(`${API_BASE_URL}/api/ontology/custom-analyze`, {
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
      setSuccess('Custom theme analysis completed successfully!');
      
      console.log('Analysis completed with results:', results);
      
      if (results.length > 0) {
        console.log('Calling generateSummaryChart...');
        await generateSummaryChart();
      } else {
        console.log('No results to generate chart for');
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
      console.log('Starting to generate summary chart...');
      
      if (!selectedFile) {
        setError('No file selected');
        return;
      }

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('themes', JSON.stringify(selectedThemes));
      
      console.log('Sending request to custom-summary-chart with themes:', selectedThemes);

      const response = await fetch(`${API_BASE_URL}/api/ontology/custom-summary-chart`, {
        method: 'POST',
        body: formData,
      });

      console.log('Summary chart response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Summary chart generation failed:', response.status, errorText);
        throw new Error(`Failed to generate summary chart: HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log('Summary chart data received:', data);
      
      if (data.chart) {
        setSummaryChart(`data:image/png;base64,${data.chart}`);
        console.log('Summary chart set successfully');
      } else {
        console.error('No chart data in response');
        setError('No chart data received from server');
      }
      
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
    a.download = 'custom_theme_analysis_results.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const groupedThemes = themeOptions.reduce((acc, theme) => {
    if (!acc[theme.category]) {
      acc[theme.category] = [];
    }
    acc[theme.category].push(theme);
    return acc;
  }, {} as Record<string, ThemeOption[]>);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header with back button */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Customize Theme Analysis
            </h1>
            <p className="text-lg text-gray-600">Select specific themes for targeted functional enrichment analysis</p>
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
              </div>
            </div>
          </div>
        </div>

        {/* Theme Selection Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900">Theme Selection</h2>
          <p className="text-gray-600 mb-6">Select the themes you want to analyze. You can choose multiple themes from different categories.</p>
          
          <div className="space-y-6">
            {Object.entries(groupedThemes).map(([category, themes]) => (
              <div key={category} className="border rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">{category}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {themes.map((theme) => (
                    <div
                      key={theme.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedThemes.includes(theme.id)
                          ? 'bg-blue-50 border-blue-300'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                      onClick={() => handleThemeToggle(theme.id)}
                    >
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={selectedThemes.includes(theme.id)}
                          onChange={() => handleThemeToggle(theme.id)}
                          className="rounded"
                        />
                        <div>
                          <div className="font-medium text-gray-900">{theme.name}</div>
                          <div className="text-sm text-gray-600">{theme.description}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 space-x-4">
            <button
              onClick={analyzeGenes}
              disabled={!selectedFile || selectedThemes.length === 0 || isAnalyzing}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isAnalyzing ? 'Analyzing...' : `Analyze Genes (${selectedThemes.length} themes selected)`}
            </button>
            
            {/* Debug button to test chart generation */}
            {results.length > 0 && (
              <button
                onClick={generateSummaryChart}
                disabled={isAnalyzing}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Generate Chart (Debug)
              </button>
            )}
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
                    alt="Custom Theme Analysis Summary" 
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
                      <p>2. Select the themes you want to analyze</p>
                      <p>3. Click &quot;Analyze Genes&quot; to perform the analysis</p>
                      <p>4. Select a theme from the left panel to generate detailed charts</p>
                      <p>5. View the interactive charts and subterm results on the right</p>
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
          <h3 className="text-lg font-semibold text-blue-900 mb-3">About Customize Theme Analysis</h3>
          <div className="text-blue-800 space-y-2">
            <p>
              This analysis allows you to select specific biological themes for targeted functional enrichment analysis.
            </p>
            <p>
              Choose from predefined themes across three main categories: Biological Processes, Molecular Functions, and Cellular Components.
            </p>
            <p>
              <strong>Features:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Select specific themes of interest</li>
              <li>Targeted analysis for your research focus</li>
              <li>Interactive theme selection with descriptions</li>
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
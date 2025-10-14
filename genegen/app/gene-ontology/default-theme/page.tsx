'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

interface OntologyResult {
  theme: string;
  score: number;
  terms: number;
}

export default function DefaultTheme() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [results, setResults] = useState<OntologyResult[]>([]);
  const [summaryChart, setSummaryChart] = useState<string>('');
  const [themeChart, setThemeChart] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [showTutorial, setShowTutorial] = useState(true);
  const [selectedTheme, setSelectedTheme] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Safe number formatting functions for theme data
  const safeNumberFormat = (value: any, decimals: number = 3): string => {
    console.log('safeNumberFormat input:', value, 'type:', typeof value);
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    console.log('safeNumberFormat converted:', num, 'isNaN:', isNaN(num));
    if (isNaN(num)) return 'N/A';
    return num.toFixed(decimals);
  };

  // Filter results by selected theme
  const filteredResults = selectedTheme 
    ? results.filter(result => result.theme === selectedTheme)
    : results;

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
      setResults([]);
      setSummaryChart('');
      setThemeChart('');
      setCurrentStep(2);
    }
  };

  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'text/plain') {
      setSelectedFile(file);
      setError('');
      setResults([]);
      setSummaryChart('');
      setThemeChart('');
      setCurrentStep(2);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const analyzeGenes = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    setIsLoading(true);
    setError('');
    setResults([]);
    setSummaryChart('');
    setThemeChart('');

    try {
      console.log('API_BASE_URL:', API_BASE_URL);
      console.log('Making request to:', `${API_BASE_URL}/api/ontology/analyze`);
      console.log('Selected file:', selectedFile.name, 'Size:', selectedFile.size);
      
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      const response = await fetch(`${API_BASE_URL}/api/ontology/analyze`, {
        method: 'POST',
        body: formData,
      });

      console.log('Analysis response status:', response.status);
      console.log('Analysis response headers:', response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Analysis failed:', response.status, errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Analysis response data:', data);
      
      if (data.results && Array.isArray(data.results)) {
        setResults(data.results);
        setCurrentStep(3);
        
        // Generate summary chart
        console.log('Starting summary chart generation...');
        await generateSummaryChart();
      } else {
        console.error('Invalid response format:', data);
        setError('Invalid response format from server');
      }
      
    } catch (error) {
      console.error('Error analyzing genes:', error);
      setError(`Failed to analyze genes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSummaryChart = async () => {
    if (!selectedFile) return;

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      const response = await fetch(`${API_BASE_URL}/api/ontology/summary-chart`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Summary chart response:', data);
        // Backend returns {"chart": chart_base64}
        if (data.chart) {
          setSummaryChart(`data:image/png;base64,${data.chart}`);
        } else {
          console.error('No chart data in response:', data);
        }
      } else {
        console.error('Failed to generate summary chart:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error generating summary chart:', error);
    }
  };

  const generateThemeChart = async (theme: string) => {
    if (!selectedFile) return;

    try {
      console.log('Generating theme chart for:', theme);
      setSelectedTheme(theme); // Set the selected theme to filter results
      
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('theme', theme);
      
      const response = await fetch(`${API_BASE_URL}/api/ontology/theme-chart`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Theme chart response:', data);
        // Backend returns {"chart_base64": chart_base64, "subterms": [...]}
        if (data.chart_base64) {
          setThemeChart(`data:image/png;base64,${data.chart_base64}`);
        } else {
          console.error('No chart data in response:', data);
        }
      } else {
        console.error('Failed to generate theme chart:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error generating theme chart:', error);
    }
  };

  const clearThemeSelection = () => {
    setSelectedTheme('');
    setThemeChart('');
  };

  const resetAnalysis = () => {
    setSelectedFile(null);
    setResults([]);
    setSummaryChart('');
    setThemeChart('');
    setSelectedTheme(''); // Clear selected theme
    setError('');
    setCurrentStep(1);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getThemeColor = (theme: string) => {
    const colors = [
      'bg-blue-100 text-blue-800',
      'bg-green-100 text-green-800',
      'bg-purple-100 text-purple-800',
      'bg-yellow-100 text-yellow-800',
      'bg-red-100 text-red-800',
      'bg-indigo-100 text-indigo-800',
      'bg-pink-100 text-pink-800',
      'bg-teal-100 text-teal-800',
    ];
    const index = theme.length % colors.length;
    return colors[index];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold mb-4">Default Theme Analysis</h1>
            <p className="text-xl text-blue-100 max-w-2xl mx-auto">
              Analyze gene ontology with automatic theme detection and comprehensive visualization
            </p>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center mb-8">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold ${
                currentStep >= step 
                  ? 'bg-blue-600 text-white shadow-lg' 
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {step}
              </div>
              {step < 3 && (
                <div className={`w-20 h-1 mx-3 ${
                  currentStep > step ? 'bg-blue-600' : 'bg-gray-200'
                }`}></div>
              )}
            </div>
          ))}
        </div>
        <div className="text-center mb-8">
          <p className="text-lg text-gray-600 font-medium">
            {currentStep === 1 && 'Step 1: Upload your gene list file'}
            {currentStep === 2 && 'Step 2: Click "Analyze Genes" to perform the initial analysis'}
            {currentStep === 3 && 'Step 3: Review results and generate visualizations'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {/* File Upload Section */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 mb-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Upload Gene List</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Upload a text file containing your gene symbols (one per line) to begin the comprehensive ontology analysis
            </p>
          </div>

          <div
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 ${
              selectedFile 
                ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50' 
                : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}
            onDrop={handleFileDrop}
            onDragOver={handleDragOver}
          >
            {selectedFile ? (
              <div>
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">File Selected Successfully</h3>
                <p className="text-gray-600 mb-6 text-lg">{selectedFile.name}</p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={analyzeGenes}
                    disabled={isLoading}
                    className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Analyze Genes
                      </>
                    )}
                  </button>
                  <button
                    onClick={resetAnalysis}
                    className="inline-flex items-center px-6 py-4 bg-gray-600 text-white font-semibold rounded-xl hover:bg-gray-700 transition-all duration-200 shadow-lg"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">Drop your file here</h3>
                <p className="text-gray-600 mb-6">or click to browse</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-lg"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Choose File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            )}
          </div>
        </div>

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

        {/* Results Section */}
        {results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Analysis Results</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedTheme 
                      ? `${filteredResults.length} themes found in "${selectedTheme}" (${results.length} total)`
                      : `${results.length} biological themes identified`
                    }
                  </p>
                </div>
                {selectedTheme && (
                  <button
                    onClick={clearThemeSelection}
                    className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Clear Theme Filter
                  </button>
                )}
              </div>
            </div>
            
            {/* Theme Chart Generation Buttons */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h4 className="text-md font-semibold text-gray-900 mb-3">Generate Theme Charts</h4>
              <p className="text-sm text-gray-600 mb-3">Click on a theme to generate detailed visualization and filter results</p>
              <div className="flex flex-col gap-2">
                {Array.from(new Set(results.map(r => r.theme))).map((theme) => (
                  <button
                    key={theme}
                    onClick={() => generateThemeChart(theme)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 shadow-sm ${
                      selectedTheme === theme
                        ? 'bg-blue-100 border-2 border-blue-300 text-blue-800'
                        : 'bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300 text-gray-900'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className={`w-3 h-3 rounded-full mr-3 ${
                          selectedTheme === theme ? 'bg-blue-600' : 'bg-blue-500'
                        }`}></div>
                        <span className="font-medium">{theme}</span>
                        {selectedTheme === theme && (
                          <span className="ml-2 px-2 py-1 bg-blue-200 text-blue-800 text-xs rounded-full">
                            Selected
                          </span>
                        )}
                      </div>
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Theme
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Terms
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredResults.map((result, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <span className={`inline-flex px-3 py-2 text-sm font-semibold rounded-full ${getThemeColor(result.theme)}`}>
                            {result.theme}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center">
                          <div className="w-16 bg-gray-200 rounded-full h-2 mr-3">
                            <div 
                              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${Math.min((result.score / 1) * 100, 100)}%` }}
                            ></div>
                          </div>
                          <span className="font-medium">{safeNumberFormat(result.score)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {result.terms} terms
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Charts Section */}
        {(summaryChart || themeChart) && (
          <div className="space-y-8 mb-8">
            {/* Summary Chart */}
            {summaryChart && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Summary Chart</h3>
                  <p className="text-gray-600">Overview of all identified themes and their significance</p>
                </div>
                <div className="flex justify-center">
                  <img 
                    src={summaryChart} 
                    alt="Summary Chart" 
                    className="max-w-full h-auto rounded-lg shadow-lg"
                    style={{ minHeight: '400px', maxHeight: '600px' }}
                  />
                </div>
              </div>
            )}

            {/* Theme Chart */}
            {themeChart && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Theme-Specific Analysis</h3>
                  <p className="text-gray-600">Detailed breakdown of terms within the selected theme</p>
                </div>
                <div className="flex justify-center">
                  <img 
                    src={themeChart} 
                    alt="Theme Chart" 
                    className="max-w-full h-auto rounded-lg shadow-lg"
                    style={{ minHeight: '400px', maxHeight: '600px' }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chart Generation Status */}
        {results.length > 0 && !summaryChart && (
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-xl p-6 mb-6">
            <div className="flex items-center">
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mr-4">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-yellow-800">Charts Ready to Generate</h3>
                <p className="text-yellow-700 mt-1">
                  Your analysis is complete! The summary chart will be generated automatically, and you can generate theme-specific charts using the buttons above.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        {results.length > 0 && (
          <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-2xl p-8 border border-blue-200 shadow-lg">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-3">What's Next?</h3>
              <p className="text-gray-600 text-lg">Explore additional analysis options and export capabilities</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center group">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-200 shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </div>
                <h4 className="font-bold text-gray-900 mb-3 text-lg">Export Results</h4>
                <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                  Download your analysis results in various formats for publication and further analysis
                </p>
                <button className="inline-flex items-center text-blue-600 hover:text-blue-700 font-semibold text-sm group-hover:scale-105 transition-all duration-200">
                  Export Data
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              
              <div className="text-center group">
                <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-200 shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                </div>
                <h4 className="font-bold text-gray-900 mb-3 text-lg">Custom Analysis</h4>
                <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                  Try our customizable theme analysis with selective theme filtering
                </p>
                <Link 
                  href="/gene-ontology/customize-theme"
                  className="inline-flex items-center text-green-600 hover:text-green-700 font-semibold text-sm group-hover:scale-105 transition-all duration-200"
                >
                  Start Custom Analysis
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
              
              <div className="text-center group">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-200 shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="font-bold text-gray-900 mb-3 text-lg">Get Help</h4>
                <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                  Need assistance? Our support team is here to help you succeed
                </p>
                <button className="inline-flex items-center text-purple-600 hover:text-purple-700 font-semibold text-sm group-hover:scale-105 transition-all duration-200">
                  Contact Support
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 
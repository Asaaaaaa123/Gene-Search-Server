'use client';

import { useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL, API_PUBLIC_BASE_URL } from '@/lib/api-base';
import {
  appendChartStyleToFormData,
  chartResponseToDataUrl,
  DEFAULT_SUMMARY_CHART_STYLE,
  DEFAULT_THEME_CHART_STYLE,
  downloadChartFromBase64,
  type ChartExportFormat,
  type ChartStyleOptions,
} from '@/lib/chart-style';
import { ThematicGoChartPanel } from '../components/ThematicGoChartPanel';
import ThemeOverlapNetwork, { type ThemeOverlapData } from '../components/ThemeOverlapNetworkLazy';
import { GeneListSelector, type GeneListSource } from '../components/GeneListSelector';

interface OntologyResult {
  theme: string;
  score: number;
  terms: number;
}

export default function DefaultTheme() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [geneListLabel, setGeneListLabel] = useState<string | null>(null);
  const [results, setResults] = useState<OntologyResult[]>([]);
  const [summaryChart, setSummaryChart] = useState<string>('');
  const [themeChart, setThemeChart] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [showTutorial, setShowTutorial] = useState(true);
  const [selectedTheme, setSelectedTheme] = useState<string>('');
  const [overlapNetworkData, setOverlapNetworkData] = useState<ThemeOverlapData | null>(null);
  const [overlapNetworkLoading, setOverlapNetworkLoading] = useState(false);
  const [summaryChartStyle, setSummaryChartStyle] = useState<ChartStyleOptions>(DEFAULT_SUMMARY_CHART_STYLE);
  const [themeChartStyle, setThemeChartStyle] = useState<ChartStyleOptions>(DEFAULT_THEME_CHART_STYLE);
  const [summaryChartLoading, setSummaryChartLoading] = useState(false);
  const [themeChartLoading, setThemeChartLoading] = useState(false);
  const [summaryExportLoading, setSummaryExportLoading] = useState(false);
  const [themeExportLoading, setThemeExportLoading] = useState(false);

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

  const prepareGeneList = (file: File, label: string) => {
    setSelectedFile(file);
    setGeneListLabel(label);
    setError('');
    setResults([]);
    setSummaryChart('');
    setThemeChart('');
    setOverlapNetworkData(null);
    setCurrentStep(2);
  };

  const handleGeneListReady = (
    file: File,
    _source: GeneListSource,
    geneCount: number,
    listName: string
  ) => {
    prepareGeneList(file, `${listName} (${geneCount} genes)`);
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
      console.log('API proxy base:', API_BASE_URL || '(same-origin)');
      console.log('Making request to:', `/api/ontology/analyze (→ ${API_PUBLIC_BASE_URL})`);
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
        setSummaryChartLoading(true);
        await generateSummaryChart(summaryChartStyle, 'png');
        setSummaryChartLoading(false);
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

  const generateSummaryChart = async (
    style: ChartStyleOptions = summaryChartStyle,
    format: ChartExportFormat = 'png',
  ) => {
    if (!selectedFile) return null;

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      appendChartStyleToFormData(formData, style, format, { isSummary: true });

      const response = await fetch(`${API_BASE_URL}/api/ontology/summary-chart`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        console.error('Failed to generate summary chart:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      if (data.chart) {
        if (format === 'png') {
          setSummaryChart(chartResponseToDataUrl(data.chart, 'png', data.media_type));
        }
        return data as { chart: string; format: ChartExportFormat; media_type?: string };
      }
      console.error('No chart data in response:', data);
      return null;
    } catch (error) {
      console.error('Error generating summary chart:', error);
      return null;
    }
  };

  const handleSummaryChartApply = async () => {
    setSummaryChartLoading(true);
    await generateSummaryChart(summaryChartStyle, 'png');
    setSummaryChartLoading(false);
  };

  const handleSummaryChartExport = async (format: ChartExportFormat) => {
    setSummaryExportLoading(true);
    const data = await generateSummaryChart(summaryChartStyle, format);
    if (data?.chart) {
      downloadChartFromBase64(data.chart, format, 'thematic-go-summary', data.media_type);
    }
    setSummaryExportLoading(false);
  };

  const generateThemeChart = async (
    theme: string,
    style: ChartStyleOptions = themeChartStyle,
    format: ChartExportFormat = 'png',
  ) => {
    if (!selectedFile) return null;

    try {
      setSelectedTheme(theme);

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('theme', theme);
      appendChartStyleToFormData(formData, style, format);

      const response = await fetch(`${API_BASE_URL}/api/ontology/theme-chart`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        console.error('Failed to generate theme chart:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      if (data.chart_base64) {
        if (format === 'png') {
          setThemeChart(chartResponseToDataUrl(data.chart_base64, 'png', data.media_type));
        }
        return data as { chart_base64: string; format: ChartExportFormat; media_type?: string };
      }
      console.error('No chart data in response:', data);
      return null;
    } catch (error) {
      console.error('Error generating theme chart:', error);
      return null;
    }
  };

  const handleThemeChartApply = async () => {
    if (!selectedTheme) return;
    setThemeChartLoading(true);
    await generateThemeChart(selectedTheme, themeChartStyle, 'png');
    setThemeChartLoading(false);
  };

  const handleThemeChartExport = async (format: ChartExportFormat) => {
    if (!selectedTheme) return;
    setThemeExportLoading(true);
    const data = await generateThemeChart(selectedTheme, themeChartStyle, format);
    if (data?.chart_base64) {
      downloadChartFromBase64(
        data.chart_base64,
        format,
        `thematic-go-${selectedTheme}`,
        data.media_type,
      );
    }
    setThemeExportLoading(false);
  };

  const requestThemeChart = async (theme: string) => {
    setThemeChartLoading(true);
    await generateThemeChart(theme, themeChartStyle, 'png');
    setThemeChartLoading(false);
  };

  const clearThemeSelection = () => {
    setSelectedTheme('');
    setThemeChart('');
  };

  const generateOverlapNetwork = async () => {
    if (!selectedFile) return;
    setOverlapNetworkLoading(true);
    setOverlapNetworkData(null);
    setError('');
    const url = `${API_BASE_URL}/api/ontology/theme-overlap-network`;
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const response = await fetch(url, { method: 'POST', body: formData });
      if (!response.ok) {
        const text = await response.text();
        let msg = text;
        try {
          const j = JSON.parse(text);
          if (j.detail) msg = j.detail;
        } catch {
          // use text as-is
        }
        if (response.status === 404) {
          setError(`Overlap network API not found (404). Ensure the backend is running and restarted so it has the theme-overlap-network endpoint. URL: ${url}`);
        } else {
          setError(`Failed to generate overlap network: ${msg}`);
        }
        return;
      }
      const data: ThemeOverlapData = await response.json();
      setOverlapNetworkData(data);
    } catch (e) {
      console.error('Overlap network error:', e);
      setError(`Failed to generate overlap network: ${e instanceof Error ? e.message : 'Unknown error'}. Check backend at ${API_PUBLIC_BASE_URL} and NEXT_PUBLIC_API_URL at frontend build.`);
    } finally {
      setOverlapNetworkLoading(false);
    }
  };

  const resetAnalysis = () => {
    setSelectedFile(null);
    setGeneListLabel(null);
    setResults([]);
    setSummaryChart('');
    setThemeChart('');
    setSelectedTheme('');
    setOverlapNetworkData(null);
    setError('');
    setCurrentStep(1);
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
            {currentStep === 1 && 'Step 1: Choose or upload your gene list'}
            {currentStep === 2 && 'Step 2: Confirm your list, then click "Analyze Genes"'}
            {currentStep === 3 && 'Step 3: Review results and generate visualizations'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {/* Gene list selection */}
        <div className="light-surface bg-white rounded-2xl shadow-xl border border-gray-100 p-8 mb-8 text-black">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-black mb-3">Gene List</h2>
            <p className="text-lg text-black max-w-2xl mx-auto">
              Pick genes from the database, use a sample or popular preset, or upload your own .txt file (one symbol per line)
            </p>
          </div>

          <GeneListSelector
            onFileReady={handleGeneListReady}
            onClear={() => {
              setSelectedFile(null);
              setGeneListLabel(null);
              setCurrentStep(1);
            }}
          />
        </div>

        {selectedFile && (
          <div className="light-surface bg-white rounded-2xl shadow-xl border border-gray-100 p-8 mb-8 text-center text-black">
            <h3 className="text-xl font-semibold text-black mb-2">Run analysis</h3>
            <p className="text-black mb-6">{geneListLabel}</p>
            <div className="flex flex-wrap gap-4 justify-center">
              <button
                type="button"
                onClick={analyzeGenes}
                disabled={isLoading}
                className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
              >
                {isLoading ? 'Analyzing…' : 'Analyze Genes'}
              </button>
              <button
                type="button"
                onClick={resetAnalysis}
                className="inline-flex items-center px-6 py-4 bg-gray-600 text-white font-semibold rounded-xl hover:bg-gray-700 transition-all duration-200"
              >
                Reset
              </button>
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
                    onClick={() => requestThemeChart(theme)}
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

        {/* Theme-Theme Gene Overlap Network */}
        {results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-8">
            <div className="mb-4">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Theme-Theme Gene Overlap Network</h3>
              <p className="text-gray-600 mb-4">Nodes are themes; edges show how many genes are shared between themes. Edge color and thickness indicate the number of shared genes.</p>
              <button
                onClick={generateOverlapNetwork}
                disabled={overlapNetworkLoading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {overlapNetworkLoading ? 'Generating...' : 'Generate Network'}
              </button>
            </div>
            <ThemeOverlapNetwork data={overlapNetworkData} loading={overlapNetworkLoading} className="mt-4" />
          </div>
        )}

        {/* Charts Section */}
        {(summaryChart || themeChart || summaryChartLoading || themeChartLoading) && (
          <div className="space-y-8 mb-8">
            {(summaryChart || summaryChartLoading) && (
              <ThematicGoChartPanel
                title="Summary Chart"
                subtitle="Overview of all identified themes and their significance"
                defaultChartTitle="Gene Ontology Analysis Summary by Theme"
                chartSrc={summaryChart || null}
                loading={summaryChartLoading}
                exportLoading={summaryExportLoading}
                variant="summary"
                style={summaryChartStyle}
                onStyleChange={setSummaryChartStyle}
                onApply={handleSummaryChartApply}
                onExport={handleSummaryChartExport}
              />
            )}

            {(themeChart || themeChartLoading) && (
              <ThematicGoChartPanel
                title="Theme-Specific Analysis"
                subtitle="Detailed breakdown of terms within the selected theme"
                defaultChartTitle={
                  selectedTheme
                    ? `Top GO Terms in Theme: ${selectedTheme}`
                    : 'Top GO Terms in Theme'
                }
                chartSrc={themeChart || null}
                loading={themeChartLoading}
                exportLoading={themeExportLoading}
                variant="theme"
                style={themeChartStyle}
                onStyleChange={setThemeChartStyle}
                onApply={handleThemeChartApply}
                onExport={handleThemeChartExport}
              />
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
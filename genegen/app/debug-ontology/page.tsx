'use client';

import { useState } from 'react';

export default function DebugOntology() {
  const [debugData, setDebugData] = useState<any>(null);
  const [testResults, setTestResults] = useState<any[]>([
    {
      term: "Test Term 1",
      p_value: "0.001",
      adjusted_p_value: "0.005", 
      odds_ratio: "1.5",
      theme: "Metabolism",
      description: "Test description 1"
    },
    {
      term: "Test Term 2",
      p_value: 0.01,
      adjusted_p_value: 0.02,
      odds_ratio: 0.8,
      theme: "Cell Cycle",
      description: "Test description 2"
    },
    {
      term: "Test Term 3",
      p_value: null,
      adjusted_p_value: undefined,
      odds_ratio: "",
      theme: "Apoptosis",
      description: "Test description 3"
    }
  ]);

  // Safe number formatting functions (same as in ontology page)
  const safeExponential = (value: any, decimals: number = 2): string => {
    console.log('safeExponential input:', value, 'type:', typeof value);
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    console.log('safeExponential converted:', num, 'isNaN:', isNaN(num));
    if (isNaN(num)) return 'N/A';
    return num.toExponential(decimals);
  };

  const safeNumberFormat = (value: any, decimals: number = 3): string => {
    console.log('safeNumberFormat input:', value, 'type:', typeof value);
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    console.log('safeNumberFormat converted:', num, 'isNaN:', isNaN(num));
    if (isNaN(num)) return 'N/A';
    return num.toFixed(decimals);
  };

  const testDataFormatting = () => {
    console.log('Testing data formatting...');
    testResults.forEach((result, index) => {
      console.log(`Result ${index + 1}:`, result);
      console.log(`P-value: ${safeExponential(result.p_value)}`);
      console.log(`Adjusted P-value: ${safeExponential(result.adjusted_p_value)}`);
      console.log(`Odds Ratio: ${safeNumberFormat(result.odds_ratio)}`);
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
          Ontology Data Debug Page
        </h1>
        
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Test Data Formatting</h2>
          <button
            onClick={testDataFormatting}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 mb-4"
          >
            Test Data Formatting (Check Console)
          </button>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Term
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Theme
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    P-value (Raw)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    P-value (Formatted)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Adjusted P-value (Raw)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Adjusted P-value (Formatted)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Odds Ratio (Raw)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Odds Ratio (Formatted)
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {testResults.map((result, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{result.term}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{result.theme}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                        {JSON.stringify(result.p_value)}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {safeExponential(result.p_value)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                        {JSON.stringify(result.adjusted_p_value)}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {safeExponential(result.adjusted_p_value)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                        {JSON.stringify(result.odds_ratio)}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {safeNumberFormat(result.odds_ratio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">Debug Instructions</h3>
          <ol className="text-yellow-700 text-sm space-y-2 list-decimal list-inside">
            <li>Click "Test Data Formatting" button above</li>
            <li>Open browser console (F12 → Console tab)</li>
            <li>Check the logged data to see what's happening with the formatting</li>
            <li>Look for any error messages or unexpected data types</li>
            <li>Compare the raw values with the formatted results</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

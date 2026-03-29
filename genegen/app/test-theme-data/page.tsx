'use client';

import { useState } from 'react';

export default function TestThemeData() {
  const [testResults, setTestResults] = useState<any[]>([
    {
      theme: "Metabolic re-wiring",
      score: 0.85,
      terms: 15
    },
    {
      theme: "Cell-cycle & Apoptosis",
      score: 0.72,
      terms: 12
    },
    {
      theme: "Inflammation & immune signaling",
      score: 0.68,
      terms: 8
    },
    {
      theme: "Neurotrophic Signaling & Growth Factors",
      score: 0.55,
      terms: 6
    }
  ]);

  const [selectedTheme, setSelectedTheme] = useState<string>('');

  // Safe number formatting function
  const safeNumberFormat = (value: any, decimals: number = 3): string => {
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return 'N/A';
    return num.toFixed(decimals);
  };

  // Filter results by selected theme
  const filteredResults = selectedTheme 
    ? testResults.filter(result => result.theme === selectedTheme)
    : testResults;

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
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
          Theme Data Display Test
        </h1>
        
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Test Theme Aggregation Data</h2>
          
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-3">Theme Selection</h3>
            <div className="flex flex-wrap gap-2">
              {testResults.map((result) => (
                <button
                  key={result.theme}
                  onClick={() => setSelectedTheme(selectedTheme === result.theme ? '' : result.theme)}
                  className={`px-3 py-2 rounded-lg transition-all duration-200 ${
                    selectedTheme === result.theme
                      ? 'bg-blue-100 border-2 border-blue-300 text-blue-800'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {result.theme}
                </button>
              ))}
            </div>
            {selectedTheme && (
              <button
                onClick={() => setSelectedTheme('')}
                className="mt-3 px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
              >
                Clear Selection
              </button>
            )}
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
                  <tr key={index} className="hover:bg-gray-50">
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

        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-green-800 mb-2">✅ Test Results</h3>
          <p className="text-green-700">
            If you can see the theme data displayed correctly above, the interface is working properly!
          </p>
          <ul className="mt-2 text-sm text-green-600 space-y-1">
            <li>• Theme names should be displayed in colored badges</li>
            <li>• Scores should show with progress bars and formatted numbers</li>
            <li>• Terms count should be displayed in green badges</li>
            <li>• Theme selection should filter the table</li>
            <li>• All values should be properly formatted (not N/A)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}


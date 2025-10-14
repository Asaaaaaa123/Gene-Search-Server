'use client';

import { useState } from 'react';

export default function TestOntologyFix() {
  const [testData, setTestData] = useState<any[]>([
    { p_value: 0.001, adjusted_p_value: 0.005, odds_ratio: 1.5, score: 0.8, terms: 5 },
    { p_value: null, adjusted_p_value: undefined, odds_ratio: '', score: 'invalid', terms: 0 },
    { p_value: 0.01, adjusted_p_value: 0.02, odds_ratio: 0.8, score: 0.6, terms: 3 }
  ]);

  // Safe number formatting functions (same as in ontology pages)
  const safeExponential = (value: any, decimals: number = 2): string => {
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return 'N/A';
    return num.toExponential(decimals);
  };

  const safeNumberFormat = (value: any, decimals: number = 3): string => {
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return 'N/A';
    return num.toFixed(decimals);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
          Ontology Fix Test Page
        </h1>
        
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Test Data with Safe Number Formatting</h2>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    P-value (Exponential)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Adjusted P-value (Exponential)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Odds Ratio (Fixed)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Score (Fixed)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Terms
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {testData.map((item, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {safeExponential(item.p_value)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {safeExponential(item.adjusted_p_value)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {safeNumberFormat(item.odds_ratio)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {safeNumberFormat(item.score)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.terms || 'N/A'}
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
            If you can see this page without errors, the toExponential and toFixed issues have been fixed!
          </p>
          <ul className="mt-2 text-sm text-green-600 space-y-1">
            <li>• P-value formatting: {safeExponential(0.001)}</li>
            <li>• Adjusted P-value formatting: {safeExponential(0.005)}</li>
            <li>• Odds Ratio formatting: {safeNumberFormat(1.5)}</li>
            <li>• Score formatting: {safeNumberFormat(0.8)}</li>
            <li>• Null value handling: {safeExponential(null)}</li>
            <li>• Undefined value handling: {safeExponential(undefined)}</li>
            <li>• Invalid string handling: {safeNumberFormat('invalid')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

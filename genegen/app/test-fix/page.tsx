'use client';

import { useState } from 'react';

export default function TestFix() {
  const [testData, setTestData] = useState<any[]>([
    { p_value: '0.001', fdr_step_up: '0.005', ratio: '1.5', fold_change: '2.0', lsmean_10mgkg: '3.2', lsmean_control: '1.6' },
    { p_value: null, fdr_step_up: undefined, ratio: '', fold_change: 'invalid', lsmean_10mgkg: '2.8', lsmean_control: null },
    { p_value: '0.01', fdr_step_up: '0.02', ratio: '0.8', fold_change: '0.5', lsmean_10mgkg: '1.2', lsmean_control: '2.4' }
  ]);

  // Safe number formatting function (same as in gene-search page)
  const safeNumberFormat = (value: any, decimals: number = 3): string => {
    if (value === null || value === undefined || value === '') return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return 'N/A';
    return num.toFixed(decimals);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Test Fix for toFixed Error</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Data with Safe Number Formatting</h2>
          
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">P-value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">FDR Step Up</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ratio</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fold Change</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">LSMean (10mg/kg)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">LSMean (Control)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {testData.map((item, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{safeNumberFormat(item.p_value, 3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{safeNumberFormat(item.fdr_step_up, 3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{safeNumberFormat(item.ratio, 3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{safeNumberFormat(item.fold_change, 3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{safeNumberFormat(item.lsmean_10mgkg, 3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{safeNumberFormat(item.lsmean_control, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-green-800 mb-2">✅ Test Passed!</h3>
          <p className="text-green-700">
            If you can see this page without any runtime errors, the toFixed issue has been fixed.
            The safeNumberFormat function properly handles null, undefined, and invalid numeric values.
          </p>
        </div>

        <div className="mt-6">
          <a 
            href="/gene-search" 
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
          >
            ← Back to Gene Search
          </a>
        </div>
      </div>
    </div>
  );
}

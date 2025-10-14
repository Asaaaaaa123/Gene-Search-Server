'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ApiTest() {
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000');
  const [testResults, setTestResults] = useState<any[]>([]);
  const [isTesting, setIsTesting] = useState(false);

  const runTest = async (endpoint: string, method: string = 'GET', body?: any) => {
    setIsTesting(true);
    try {
      const url = `${apiUrl}${endpoint}`;
      console.log(`Testing: ${method} ${url}`);
      
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const data = await response.text();
      
      const result = {
        endpoint,
        method,
        status: response.status,
        statusText: response.statusText,
        data: data.substring(0, 200) + (data.length > 200 ? '...' : ''),
        success: response.ok,
        timestamp: new Date().toISOString()
      };
      
      setTestResults(prev => [...prev, result]);
      console.log('Test result:', result);
    } catch (error) {
      const result = {
        endpoint,
        method,
        status: 'ERROR',
        statusText: error instanceof Error ? error.message : 'Unknown error',
        data: '',
        success: false,
        timestamp: new Date().toISOString()
      };
      
      setTestResults(prev => [...prev, result]);
      console.error('Test error:', error);
    } finally {
      setIsTesting(false);
    }
  };

  const runAllTests = async () => {
    setTestResults([]);
    
    // Test basic endpoints
    await runTest('/');
    await runTest('/api/health');
    await runTest('/api/test');
    await runTest('/api/gene/symbols');
    
    // Test ontology endpoints (these might fail without proper data)
    await runTest('/api/ontology/analyze', 'POST');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">API Connection Test</h1>
          <Link 
            href="/"
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Back to Home
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Configuration</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Base URL:
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="http://localhost:8000"
              />
            </div>
            <div className="text-sm text-gray-600">
              <p>Environment variable: {process.env.NEXT_PUBLIC_API_URL || 'Not set'}</p>
              <p>Current URL: {apiUrl}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Controls</h2>
          <div className="space-x-4">
            <button
              onClick={runAllTests}
              disabled={isTesting}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isTesting ? 'Running Tests...' : 'Run All Tests'}
            </button>
            <button
              onClick={() => setTestResults([])}
              className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Clear Results
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Test Results</h2>
          {testResults.length === 0 ? (
            <p className="text-gray-500">No test results yet. Click "Run All Tests" to start.</p>
          ) : (
            <div className="space-y-4">
              {testResults.map((result, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${
                    result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium">
                      {result.method} {result.endpoint}
                    </div>
                    <div className={`px-2 py-1 rounded text-sm font-medium ${
                      result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {result.status} {result.statusText}
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 mb-2">
                    Time: {result.timestamp}
                  </div>
                  {result.data && (
                    <div className="text-sm bg-gray-100 p-2 rounded">
                      <pre className="whitespace-pre-wrap">{result.data}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 
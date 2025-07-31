'use client';

import React from 'react';
import Link from 'next/link';

export default function GeneOntologyOptions() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Thematic Gene Ontology Analysis
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Choose your preferred analysis approach for functional enrichment analysis
          </p>
        </div>

        {/* Options Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Default Theme Card */}
          <div className="bg-white rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2">
            <div className="p-8">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6 mx-auto">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">
                Default Theme Analysis
              </h2>
              <p className="text-gray-600 mb-6 text-center">
                Use predefined biological themes for automatic functional enrichment analysis. 
                The system will automatically detect and analyze the most relevant themes from your gene list.
              </p>
              <div className="space-y-3 mb-6">
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Automatic theme detection
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Quick and easy analysis
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Comprehensive results
                </div>
              </div>
              <div className="text-center">
                <Link 
                  href="/gene-ontology/default-theme"
                  className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors duration-200"
                >
                  Start Default Analysis
                  <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>

          {/* Customize Theme Card */}
          <div className="bg-white rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2">
            <div className="p-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6 mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">
                Customize Theme Analysis
              </h2>
              <p className="text-gray-600 mb-6 text-center">
                Select specific biological themes for targeted analysis. 
                Choose from predefined themes across biological processes, molecular functions, and cellular components.
              </p>
              <div className="space-y-3 mb-6">
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Targeted theme selection
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Research-focused analysis
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Multiple theme categories
                </div>
              </div>
              <div className="text-center">
                <Link 
                  href="/gene-ontology/customize-theme"
                  className="inline-flex items-center px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors duration-200"
                >
                  Start Custom Analysis
                  <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="mt-12 bg-white rounded-2xl shadow-xl p-8 max-w-4xl mx-auto">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">Analysis Comparison</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">Feature</th>
                  <th className="text-center py-3 px-4 font-semibold text-blue-600">Default Theme</th>
                  <th className="text-center py-3 px-4 font-semibold text-green-600">Customize Theme</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="py-3 px-4 text-gray-700">Theme Selection</td>
                  <td className="py-3 px-4 text-center text-gray-600">Automatic</td>
                  <td className="py-3 px-4 text-center text-gray-600">Manual</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-700">Analysis Speed</td>
                  <td className="py-3 px-4 text-center text-gray-600">Fast</td>
                  <td className="py-3 px-4 text-center text-gray-600">Targeted</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-700">Research Focus</td>
                  <td className="py-3 px-4 text-center text-gray-600">General</td>
                  <td className="py-3 px-4 text-center text-gray-600">Specific</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-700">Best For</td>
                  <td className="py-3 px-4 text-center text-gray-600">Exploratory analysis</td>
                  <td className="py-3 px-4 text-center text-gray-600">Hypothesis testing</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Back to Home */}
        <div className="text-center mt-12">
          <Link 
            href="/"
            className="inline-flex items-center px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors duration-200"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </Link>
        </div>

        {/* Information Section */}
        <div className="mt-12 bg-blue-50 rounded-2xl p-8 max-w-4xl mx-auto">
          <h3 className="text-2xl font-bold text-blue-900 mb-4 text-center">About Thematic Gene Ontology Analysis</h3>
          <div className="text-blue-800 space-y-4">
            <p className="text-center">
              Our thematic gene ontology analysis provides two powerful approaches for functional enrichment analysis:
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-blue-900 mb-2">Default Theme Analysis</h4>
                <p className="text-sm">
                  Perfect for exploratory research where you want to discover all relevant biological themes 
                  in your gene list. The system automatically identifies and analyzes the most significant themes.
                </p>
              </div>
              <div>
                <h4 className="font-semibold text-blue-900 mb-2">Customize Theme Analysis</h4>
                <p className="text-sm">
                  Ideal for hypothesis-driven research where you want to focus on specific biological processes, 
                  molecular functions, or cellular components of interest.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
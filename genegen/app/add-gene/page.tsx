'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface GeneFormData {
  gene_symbol: string;
  gene_name: string;
  p_value_10_mgkg_vs_control: string;
  fdr_step_up_10_mgkg_vs_control: string;
  ratio_10_mgkg_vs_control: string;
  fold_change_10_mgkg_vs_control: string;
  lsmean_10mgkg_10_mgkg_vs_control: string;
  lsmean_control_10_mgkg_vs_control: string;
  organ: string;
}

export default function AddGenePage() {
  const [formData, setFormData] = useState<GeneFormData>({
    gene_symbol: '',
    gene_name: '',
    p_value_10_mgkg_vs_control: '',
    fdr_step_up_10_mgkg_vs_control: '',
    ratio_10_mgkg_vs_control: '',
    fold_change_10_mgkg_vs_control: '',
    lsmean_10mgkg_10_mgkg_vs_control: '',
    lsmean_control_10_mgkg_vs_control: '',
    organ: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // 可用的器官选项
  const organOptions = [
    'BoneMarrow',
    'Cortex',
    'DRG',
    'Fat',
    'Heart',
    'Hypothalamus',
    'Kidneys',
    'Liver',
    'Muscle'
  ];

  useEffect(() => {

    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (!isLoggedIn) {
      router.push('/login');
    }
  }, [router]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');


    const requiredFields = Object.keys(formData) as (keyof GeneFormData)[];
    const emptyFields = requiredFields.filter(field => !formData[field]);
    
    if (emptyFields.length > 0) {
      setError(`Please fill in all required fields: ${emptyFields.join(', ')}`);
      setLoading(false);
      return;
    }

    try {
      const authToken = localStorage.getItem('authToken');
      if (!authToken) {
        setError('Authentication token not found. Please login again.');
        router.push('/login');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/gene/add?token=${authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }


      setSuccess('Gene added successfully!');
      
    
      setFormData({
        gene_symbol: '',
        gene_name: '',
        p_value_10_mgkg_vs_control: '',
        fdr_step_up_10_mgkg_vs_control: '',
        ratio_10_mgkg_vs_control: '',
        fold_change_10_mgkg_vs_control: '',
        lsmean_10mgkg_10_mgkg_vs_control: '',
        lsmean_control_10_mgkg_vs_control: '',
        organ: ''
      });
    } catch (error) {
      console.error('Error adding gene:', error);
      setError(`Failed to add gene: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('authToken');
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Add New Gene</h1>
            <p className="text-gray-600">Enter gene information to add to the database</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Back to Home
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Gene Symbol */}
              <div>
                <label htmlFor="gene_symbol" className="block text-sm font-medium text-gray-700 mb-2">
                  Gene Symbol *
                </label>
                <input
                  type="text"
                  id="gene_symbol"
                  name="gene_symbol"
                  value={formData.gene_symbol}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter gene symbol"
                />
              </div>

              {/* Gene Name */}
              <div>
                <label htmlFor="gene_name" className="block text-sm font-medium text-gray-700 mb-2">
                  Gene Name *
                </label>
                <input
                  type="text"
                  id="gene_name"
                  name="gene_name"
                  value={formData.gene_name}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter gene name"
                />
              </div>

              {/* P-value */}
              <div>
                <label htmlFor="p_value_10_mgkg_vs_control" className="block text-sm font-medium text-gray-700 mb-2">
                  P-value (10mg/kg vs control) *
                </label>
                <input
                  type="number"
                  step="any"
                  id="p_value_10_mgkg_vs_control"
                  name="p_value_10_mgkg_vs_control"
                  value={formData.p_value_10_mgkg_vs_control}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter p-value"
                />
              </div>

              {/* FDR Step Up */}
              <div>
                <label htmlFor="fdr_step_up_10_mgkg_vs_control" className="block text-sm font-medium text-gray-700 mb-2">
                  FDR Step Up (10mg/kg vs control) *
                </label>
                <input
                  type="number"
                  step="any"
                  id="fdr_step_up_10_mgkg_vs_control"
                  name="fdr_step_up_10_mgkg_vs_control"
                  value={formData.fdr_step_up_10_mgkg_vs_control}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter FDR step up value"
                />
              </div>

              {/* Ratio */}
              <div>
                <label htmlFor="ratio_10_mgkg_vs_control" className="block text-sm font-medium text-gray-700 mb-2">
                  Ratio (10mg/kg vs control) *
                </label>
                <input
                  type="number"
                  step="any"
                  id="ratio_10_mgkg_vs_control"
                  name="ratio_10_mgkg_vs_control"
                  value={formData.ratio_10_mgkg_vs_control}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter ratio"
                />
              </div>

              {/* Fold Change */}
              <div>
                <label htmlFor="fold_change_10_mgkg_vs_control" className="block text-sm font-medium text-gray-700 mb-2">
                  Fold Change (10mg/kg vs control) *
                </label>
                <input
                  type="number"
                  step="any"
                  id="fold_change_10_mgkg_vs_control"
                  name="fold_change_10_mgkg_vs_control"
                  value={formData.fold_change_10_mgkg_vs_control}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter fold change"
                />
              </div>

              {/* LSMean 10mg/kg */}
              <div>
                <label htmlFor="lsmean_10mgkg_10_mgkg_vs_control" className="block text-sm font-medium text-gray-700 mb-2">
                  LSMean 10mg/kg (10mg/kg vs control) *
                </label>
                <input
                  type="number"
                  step="any"
                  id="lsmean_10mgkg_10_mgkg_vs_control"
                  name="lsmean_10mgkg_10_mgkg_vs_control"
                  value={formData.lsmean_10mgkg_10_mgkg_vs_control}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter LSMean 10mg/kg"
                />
              </div>

              {/* LSMean Control */}
              <div>
                <label htmlFor="lsmean_control_10_mgkg_vs_control" className="block text-sm font-medium text-gray-700 mb-2">
                  LSMean Control (10mg/kg vs control) *
                </label>
                <input
                  type="number"
                  step="any"
                  id="lsmean_control_10_mgkg_vs_control"
                  name="lsmean_control_10_mgkg_vs_control"
                  value={formData.lsmean_control_10_mgkg_vs_control}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter LSMean control"
                />
              </div>

              {/* Organ */}
              <div>
                <label htmlFor="organ" className="block text-sm font-medium text-gray-700 mb-2">
                  Organ *
                </label>
                <select
                  id="organ"
                  name="organ"
                  value={formData.organ}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select an organ</option>
                  {organOptions.map((organ) => (
                    <option key={organ} value={organ}>
                      {organ}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
                {success}
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Adding Gene...' : 'Add Gene'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
} 
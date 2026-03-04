import type { NextConfig } from "next";

const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const nextConfig: NextConfig = {
  // Only use standalone in production
  ...(process.env.NODE_ENV === 'production' ? { output: 'standalone' } : {}),

  // In dev: proxy API routes to backends so same-origin requests work (avoids 404 when backend has new routes)
  ...(process.env.NODE_ENV === 'development'
    ? {
        async rewrites() {
          return [
            { source: '/api/ontology/:path*', destination: `${BACKEND_API}/api/ontology/:path*` },
            { source: '/api/ivcca/:path*', destination: `${BACKEND_API}/api/ivcca/:path*` },
            { source: '/api/gene/:path*', destination: `${BACKEND_API}/api/gene/:path*` },
            { source: '/api/health', destination: `${BACKEND_API}/api/health` },
            { source: '/api/debug/:path*', destination: `${BACKEND_API}/api/debug/:path*` },
          ];
        },
      }
    : {}),

  webpack: (config, { isServer }) => {
    // Fix for plotly.js in Next.js
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    // Optimize plotly.js bundle - lazy load it
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          maxInitialRequests: 25,
          minSize: 20000,
          cacheGroups: {
            default: {
              minChunks: 2,
              priority: -20,
              reuseExistingChunk: true,
            },
            vendors: {
              test: /[\\/]node_modules[\\/]/,
              priority: -10,
              reuseExistingChunk: true,
            },
            plotly: {
              test: /[\\/]node_modules[\\/](plotly\.js|react-plotly\.js)[\\/]/,
              name: 'plotly',
              priority: 20,
              chunks: 'async', // Lazy load - only when needed
              reuseExistingChunk: true,
              enforce: true,
            },
          },
        },
      };
    }
    
    return config;
  },
  
  // Optimize package imports
  experimental: {
    optimizePackageImports: ['react-plotly.js'],
  },
  
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  
  // Improve dev server performance
  ...(process.env.NODE_ENV === 'development' ? {
    onDemandEntries: {
      maxInactiveAge: 60 * 1000, // 1 minute
      pagesBufferLength: 5,
    },
  } : {}),
};

export default nextConfig;

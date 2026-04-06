import type { NextConfig } from "next";

const rawBackend = process.env.NEXT_PUBLIC_API_URL?.trim();
const BACKEND_API = (rawBackend && rawBackend.length > 0
  ? rawBackend
  : "http://localhost:8000"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Only use standalone in production
  ...(process.env.NODE_ENV === 'production' ? { output: 'standalone' } : {}),

  // Proxy /api/* → FastAPI in dev and production (browser uses same-origin; no CORS).
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_API}/api/:path*`,
      },
    ];
  },

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

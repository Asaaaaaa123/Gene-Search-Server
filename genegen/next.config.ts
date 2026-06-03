import type { NextConfig } from "next";

const rawBackend = process.env.NEXT_PUBLIC_API_URL?.trim();
const BACKEND_API = (rawBackend && rawBackend.length > 0
  ? rawBackend
  : "http://localhost:8000"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Only use standalone in production
  ...(process.env.NODE_ENV === 'production' ? { output: 'standalone' } : {}),

  productionBrowserSourceMaps: false,

  // Proxy /api/* → FastAPI in dev and production (browser uses same-origin; no CORS).
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_API}/api/:path*`,
      },
    ];
  },

  // Minimal webpack tweak (plotly); avoid heavy splitChunks — it disables Next memory opts.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        buffer: require.resolve("buffer/"),
      };
    }
    return config;
  },

  experimental: {
    optimizePackageImports: ["react-plotly.js", "lucide-react", "framer-motion"],
    // Lowers peak RAM during `next build` in Docker/Coolify (requires simpler webpack above).
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
  },

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

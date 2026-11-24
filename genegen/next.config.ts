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

  // The Docker build (Dockerfile, SKIP_TYPECHECK=1) skips "Checking validity of types": on the 4GB Coolify VPS it
  // was killed for lack of memory (silent exit 255). Check the types before pushing: npx tsc --noEmit.
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" },

  // The default-theme version of Thematic GO was removed: old links and bookmarks open the custom-theme analysis.
  async redirects() {
    return [
      { source: "/gene-ontology/default-theme", destination: "/gene-ontology/customize-theme", permanent: false },
    ];
  },

  // Proxy /api/* → FastAPI in dev and production (browser uses same-origin; no CORS).
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_API}/api/:path*`,
      },
      // Popcorn (Bone Spatial Studio) is served by the backend at /popcorn (backend/popcorn_mount.py).
      // Next redirects /popcorn/ to /popcorn, so the page itself is rewritten to the backend's /popcorn/.
      {
        source: "/popcorn",
        destination: `${BACKEND_API}/popcorn/`,
      },
      {
        source: "/popcorn/:path*",
        destination: `${BACKEND_API}/popcorn/:path*`,
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
    // Coolify VPS builds: keep peak RSS low. webpackBuildWorker + high parallelism
    // often dies with silent exit 255 (OOM killer) during "Creating an optimized production build".
    webpackMemoryOptimizations: true,
    webpackBuildWorker: false,
    cpus: 1,
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

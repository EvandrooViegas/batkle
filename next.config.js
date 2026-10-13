const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

const nextConfig = {
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      'mongodb',
      '@resvg/resvg-js',
      'satori',
      'sharp',
      'uuid',
      'dotenv',
      'axios',
      'cheerio',
      'groq-sdk',
      '@huggingface/transformers',
    ],
    // On Linux x64, onnxruntime-node's install script downloads its CUDA and TensorRT provider libraries (several
    // hundred MB), which the trace would ship in the API function and push it past Vercel's 250 MB limit. Vercel
    // has no GPU and the image cut-out runs on the CPU, so those libraries are never loaded.
    outputFileTracingExcludes: {
      '*': ['node_modules/onnxruntime-node/bin/*/linux/x64/libonnxruntime_providers_{cuda,tensorrt}.so'],
    },
  },
  webpack(config, { dev, isServer }) {
    if (dev) {
      config.watchOptions = {
        poll: 2000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules'],
      };
    }

    // Keep @huggingface/transformers and its sub-paths entirely out of the
    // webpack bundle — it is a large native Node package that must be loaded
    // by Node's require() at runtime, not bundled by webpack.
    // We wrap any existing externals array/function so we don't break Next's
    // own server-side externals logic.
    if (isServer) {
      const prev = config.externals;
      config.externals = [
        // Our rule: anything under @huggingface/transformers is external.
        ({ request }, callback) => {
          if (request && (
            request === '@huggingface/transformers' ||
            request.startsWith('@huggingface/transformers/')
          )) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
        // Preserve whatever Next.js already put in externals.
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      ];
    }

    return config;
  },
  onDemandEntries: {
    // Keep the shared API route available while slower pages compile.
    maxInactiveAge: 5 * 60 * 1000,
    pagesBufferLength: 20,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGINS || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
    ];
  },
};

module.exports = (phase) => ({
  ...nextConfig,
  // Keep production builds from replacing chunks used by a running dev server.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});

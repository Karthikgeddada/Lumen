/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Uploads stream through the browser straight to the backend; the
  // default 4MB body limit only matters for API routes, which we don't use.
  experimental: {},
  // Same-origin deploy (Databricks App single container): proxy /api/* to the
  // backend co-hosted on BACKEND_INTERNAL_URL (default 127.0.0.1:4001).
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:4001';
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;

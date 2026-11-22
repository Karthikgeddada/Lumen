/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Uploads stream through the browser straight to the Render backend; the
  // default 4MB body limit only matters for API routes, which we don't use.
  experimental: {},
};

export default nextConfig;

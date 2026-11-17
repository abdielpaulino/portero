import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/inventory/stock-decreases",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/inventory/stock-decreases`,
      },
      {
        source: "/api/inventory",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/inventory`,
      },
      {
        source: "/api/auth/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import { apiOrigin } from "./api-origin.cjs";

const nextConfig: NextConfig = {
  reactCompiler: true,
  devIndicators: false,
  allowedDevOrigins: ["192.168.3.7"],
  async rewrites() {
    const api = apiOrigin();
    return [
      {
        source: "/api/inventory/stock-decreases",
        destination: `${api}/inventory/stock-decreases`,
      },
      {
        source: "/api/inventory/stock-decreases/:id/:action*",
        destination: `${api}/inventory/stock-decreases/:id/:action*`,
      },
      {
        source: "/api/inventory",
        destination: `${api}/inventory`,
      },
      {
        source: "/api/inventory/products/:id",
        destination: `${api}/inventory/products/:id`,
      },
      ...["login", "logout", "session"].map(action => ({ source: `/api/auth/${action}`, destination: `${api}/auth/${action}` })),
      { source: "/api/sales/external", destination: `${api}/sales/external` },
      { source: "/api/sales/external/:path*", destination: `${api}/sales/external/:path*` },
      { source: "/api/sales/online-orders", destination: `${api}/sales/online-orders` },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "better-sqlite3", "bindings"],
  experimental: {
    turbo: false,
  },
};

export default nextConfig;

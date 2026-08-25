import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "better-sqlite3", "bindings"],
};

export default nextConfig;

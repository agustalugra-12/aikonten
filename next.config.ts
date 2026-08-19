import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "better-sqlite3", "bindings"],
  turbopack: {
    resolveAlias: {
      fs: { browser: "" },
    },
  },
};

export default nextConfig;

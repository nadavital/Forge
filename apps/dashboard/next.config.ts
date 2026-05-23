import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo root for module resolution (pnpm workspace).
  turbopack: {
    root: path.resolve(__dirname, "../..")
  }
};

export default nextConfig;

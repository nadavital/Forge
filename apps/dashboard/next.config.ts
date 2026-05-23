import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Monorepo root for module resolution (pnpm workspace).
  turbopack: {
    root: path.resolve(__dirname, "../..")
  }
};

export default nextConfig;

// next.config.ts
import type { NextConfig } from "next";
import CopyWebpackPlugin from "copy-webpack-plugin";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.plugins.push(
      new CopyWebpackPlugin({
        patterns: [
          { from: "node_modules/cesium/Build/Cesium", to: "public/cesium" },
        ],
      })
    );
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      cesium: path.resolve(__dirname, "node_modules/cesium"),
    };
    return config;
  },

  // ✅ Don’t fail the build on lint or TS errors (good for hackathon deploys)
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  env: { CESIUM_BASE_URL: "/cesium" },
  reactStrictMode: true,
};

export default nextConfig;

import type { NextConfig } from "next";
import CopyWebpackPlugin from "copy-webpack-plugin";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Copy Cesium assets into .next/static/cesium
      config.plugins.push(
        new CopyWebpackPlugin({
          patterns: [
            {
              from: "node_modules/cesium/Build/Cesium",
              to: "static/cesium",
            },
          ],
        })
      );

      // Add alias so imports like "cesium" resolve properly
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        cesium: path.resolve(__dirname, "node_modules/cesium"),
      };
    }
    return config;
  },
  env: {
    CESIUM_BASE_URL: "/_next/static/cesium",
  },
  images: {
    unoptimized: true, // helpful on Netlify if you don’t want sharp in CI
  },
};

export default nextConfig;


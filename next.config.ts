import type { NextConfig } from "next";

import CopyWebpackPlugin from "copy-webpack-plugin";
import path from "path";
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Cesium asset path
    config.plugins.push(
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "node_modules/cesium/Build/Cesium",
            to: "public/cesium",
          },
        ],
      })
    );

    // Optional: alias for cesium
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      cesium: path.resolve(__dirname, "node_modules/cesium"),
    };
    return config;
  },
  env: {
    CESIUM_BASE_URL: "/cesium", // used by Cesium to find its assets
  },
  reactStrictMode: true,
};

export default nextConfig;

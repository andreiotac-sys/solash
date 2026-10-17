import type { NextConfig } from "next";
import { assertSafePreviewEnvironment } from "./scripts/check-build-environment.mjs";

assertSafePreviewEnvironment(process.env);

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "192.168.100.4", "localhost"],
};

export default nextConfig;

import type { NextConfig } from "next";

/**
 * Phone on Wi‑Fi: Next dev blocks some cross-origin dev requests unless the host is listed.
 * Override: NEXT_PUBLIC_DEV_LAN_HOSTS=192.168.0.39,10.0.0.5
 */
const extraLanHosts = (process.env.NEXT_PUBLIC_DEV_LAN_HOSTS ?? "192.168.0.39")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: extraLanHosts,
};

export default nextConfig;

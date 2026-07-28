import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Cloudflare Images / R2 delivery (media gallery, team logos)
      { protocol: "https", hostname: "imagedelivery.net" },
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
    ],
  },
};

export default nextConfig;

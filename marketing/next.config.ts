import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // 90 keeps the small type in the UI screenshots sharp.
    qualities: [75, 90],
  },
};

export default nextConfig;

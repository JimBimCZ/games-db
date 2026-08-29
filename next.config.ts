import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Vercel traces the output itself, and its onBuildComplete hook fails on the missing
  // next-server.js.nft.json that 'standalone' leaves behind. The container build needs
  // 'standalone' to exist, so the two targets get different values.
  output: process.env.VERCEL ? undefined : 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.akamai.steamstatic.com' },
    ],
  },
}

export default nextConfig

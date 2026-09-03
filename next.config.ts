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
    // Without a `sizes` prop, next/image emits a srcset of [width, width*2] snapped to the
    // nearest entries here, so the default ladder billed two Vercel transformations per
    // image. The optimizer never upscales past the source, so for Steam art — 460px
    // headers, 231px capsules, 293px movie thumbs — both variants came back byte-identical
    // (measured: 5738 B at w=640 and w=1080 for a 460px header). Two entries far enough
    // apart that width and width*2 land on the same one collapse that to a single
    // transformation at the source's native resolution, unchanged on screen.
    deviceSizes: [256, 1920],
    imageSizes: [],
  },
}

export default nextConfig

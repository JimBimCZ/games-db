import type { MetadataRoute } from 'next'

// Every /game and /genre page renders Steam art through Vercel's image optimizer, which
// bills per transformation on a cache miss. Left open, a crawler walks the whole hydrated
// catalogue and pays for a transformation of every screenshot in it. Nothing here is worth
// indexing — the catalogue data is Steam's, and the app is a personal library.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/game/', '/genre/', '/search'],
    },
  }
}

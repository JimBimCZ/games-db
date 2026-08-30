import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/client.ts'
import { reviewSummary } from '../../db/schema.ts'
import { readThrough } from '../steam/cache.ts'
import { fetchReviewSummary } from '../steam/reviews.ts'
import type { ReviewSummary } from '../steam/schemas.ts'
import { TTL_MS } from '../steam/ttl.ts'

export async function getReviewSummary(appid: number): Promise<ReviewSummary | undefined> {
  try {
    return await readThrough<ReviewSummary>({
      label: `appreviews ${appid}`,
      ttlMs: TTL_MS.reviewSummary,
      load: async () => {
        const rows = await getDb()
          .select()
          .from(reviewSummary)
          .where(eq(reviewSummary.appid, appid))
          .limit(1)
        const row = rows[0]
        if (!row) return undefined
        return {
          value: {
            reviewScore: row.reviewScore ?? undefined,
            reviewScoreDesc: row.reviewScoreDesc ?? undefined,
            totalPositive: row.totalPositive ?? 0,
            totalNegative: row.totalNegative ?? 0,
            totalReviews: row.totalReviews ?? 0,
          },
          fetchedAt: row.fetchedAt,
        }
      },
      refresh: async () => {
        const summary = await fetchReviewSummary(appid)
        const now = new Date()
        await getDb()
          .insert(reviewSummary)
          .values({
            appid,
            reviewScore: summary.reviewScore ?? null,
            reviewScoreDesc: summary.reviewScoreDesc ?? null,
            totalPositive: summary.totalPositive,
            totalNegative: summary.totalNegative,
            totalReviews: summary.totalReviews,
            fetchedAt: now,
          })
          .onConflictDoUpdate({
            target: reviewSummary.appid,
            set: {
              reviewScore: summary.reviewScore ?? null,
              reviewScoreDesc: summary.reviewScoreDesc ?? null,
              totalPositive: summary.totalPositive,
              totalNegative: summary.totalNegative,
              totalReviews: summary.totalReviews,
              fetchedAt: now,
            },
          })
        return summary
      },
    })
  } catch (err) {
    // A detail page without a review score is a worse page, not a broken one.
    console.error(`review summary unavailable for appid ${appid}:`, err)
    return undefined
  }
}

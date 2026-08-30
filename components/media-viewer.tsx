'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import type { DetailMedia } from '@/server/detail/queries'

const HLS_MIME = 'application/vnd.apple.mpegurl'

function Stage({ item, title }: { item: DetailMedia; title: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const src = item.kind === 'movie' ? item.hlsUrl : null

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    // Not just Safari: Chrome on macOS also answers "maybe" here and plays the master
    // playlist natively, verified against appid 570. The import below is therefore dead
    // code on this machine, and was exercised by forcing canPlayType to return ''.
    // hls.js is code-split, so it is fetched only when a trailer is the displayed item —
    // never on a browse page, and never for the games that ship screenshots alone.
    if (video.canPlayType(HLS_MIME)) {
      video.src = src
      return
    }

    let cancelled = false
    let instance: { destroy: () => void } | null = null

    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return
      const hls = new Hls()
      instance = hls
      hls.loadSource(src)
      hls.attachMedia(video)
    })

    return () => {
      cancelled = true
      instance?.destroy()
    }
  }, [src])

  if (item.kind === 'movie') {
    return (
      <video
        ref={videoRef}
        className="aspect-video w-full rounded-md border border-line bg-black"
        controls
        preload="none"
        poster={item.thumbnailUrl ?? undefined}
        aria-label={item.name ?? `${title} trailer`}
      />
    )
  }

  return item.fullUrl ? (
    <Image
      src={item.fullUrl}
      alt={`Screenshot from ${title}`}
      width={1920}
      height={1080}
      loading="eager"
      fetchPriority="high"
      className="aspect-video w-full rounded-md border border-line object-cover"
    />
  ) : (
    <div className="aspect-video w-full rounded-md border border-line bg-bg-panel" />
  )
}

// Screenshots carry no name of their own, so they are numbered in display order.
function withLabels(media: DetailMedia[]): { item: DetailMedia; label: string }[] {
  let screenshots = 0
  return media.map((item) => {
    if (item.kind === 'movie') return { item, label: item.name ?? 'Trailer' }
    screenshots += 1
    return { item, label: `Screenshot ${screenshots}` }
  })
}

export function MediaViewer({ media, title }: { media: DetailMedia[]; title: string }) {
  const [selected, setSelected] = useState(0)

  const items = withLabels(media)
  const current = items.at(Math.min(selected, items.length - 1))
  if (!current) return null

  return (
    <section aria-label={`Media for ${title}`}>
      {/* Remounting per item tears down the previous hls.js instance instead of leaving a
          detached one attached to a discarded <video>. */}
      <Stage
        key={`${current.item.kind}-${current.item.position}`}
        item={current.item}
        title={title}
      />

      {items.length > 1 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {items.map(({ item, label }, index) => {
            const isCurrent = index === selected
            return (
              <button
                key={`${item.kind}-${item.position}`}
                type="button"
                onClick={() => setSelected(index)}
                aria-current={isCurrent}
                className={`relative shrink-0 overflow-hidden rounded border focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  isCurrent ? 'border-accent' : 'border-line opacity-70 hover:opacity-100'
                }`}
              >
                {item.thumbnailUrl ? (
                  <Image
                    src={item.thumbnailUrl}
                    alt={label}
                    width={160}
                    height={90}
                    loading="lazy"
                    className="h-[54px] w-[96px] object-cover"
                  />
                ) : (
                  <div className="flex h-[54px] w-[96px] items-center justify-center bg-bg-panel px-1 text-[10px] text-text-dim">
                    {label}
                  </div>
                )}
                {item.kind === 'movie' ? (
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center text-white drop-shadow"
                  >
                    ▶
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

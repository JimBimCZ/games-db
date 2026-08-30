// Mirrors the measurements in page.tsx: the h-48 hero band, the
// [minmax(0,1fr)_300px] split, and the media viewer's aspect-video stage.
export default function Loading() {
  return (
    <article>
      <div className="h-48 w-full animate-pulse border-b border-line bg-bg-panel" />
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="aspect-video w-full animate-pulse rounded-md bg-bg-panel" />
          <div className="mt-2 flex gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[54px] w-[96px] animate-pulse rounded bg-bg-panel" />
            ))}
          </div>
          <div className="mt-6 flex max-w-2xl flex-col gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-bg-panel" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-[92px] animate-pulse rounded-lg bg-bg-panel" />
          <div className="h-14 animate-pulse rounded bg-bg-panel" />
          <div className="h-40 animate-pulse rounded bg-bg-panel" />
        </div>
      </div>
    </article>
  )
}

export default function Loading() {
  return (
    <article className="p-6">
      <div className="h-7 w-64 animate-pulse rounded bg-bg-panel" />
      <div className="mt-3 aspect-[460/215] w-[460px] max-w-full animate-pulse rounded-md bg-bg-panel" />
      <div className="mt-4 grid max-w-md grid-cols-[8rem_1fr] gap-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="contents">
            <div className="h-4 w-20 animate-pulse rounded bg-bg-panel" />
            <div className="h-4 w-40 animate-pulse rounded bg-bg-panel" />
          </div>
        ))}
      </div>
    </article>
  )
}

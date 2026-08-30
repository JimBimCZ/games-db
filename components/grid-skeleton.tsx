export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="p-6">
      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-bg-panel" />
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <div className="aspect-[460/215] w-full animate-pulse rounded-md bg-bg-panel" />
            <div className="mt-1.5 h-4 w-3/4 animate-pulse rounded bg-bg-panel" />
          </li>
        ))}
      </ul>
    </div>
  )
}

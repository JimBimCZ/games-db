export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="p-6">
      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-bg-panel" />
      {/* The row height matches the table's 32px capsule plus its py-2, so the layout does
          not jump when the real rows arrive. */}
      <div className="flex flex-col gap-px">
        {Array.from({ length: rows }, (_, i) => (
          <div className="h-[48px] w-full animate-pulse rounded bg-bg-panel" key={i} />
        ))}
      </div>
    </div>
  )
}

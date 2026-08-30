export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

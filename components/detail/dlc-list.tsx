import Link from 'next/link'
import { Section } from './section'

export type DlcEntry = { appid: number; name: string | null; hydrated: boolean }

export function DlcSection({ dlc }: { dlc: DlcEntry[] }) {
  if (dlc.length === 0) return null

  return (
    <Section title={`DLC and editions (${dlc.length})`}>
      <ul className="flex max-w-2xl flex-col gap-1">
        {dlc.map((entry) => (
          <li key={entry.appid}>
            {entry.name === null ? (
              <span className="text-text-dim">Not in the catalogue · {entry.appid}</span>
            ) : entry.hydrated ? (
              <Link
                className="text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                href={`/game/${entry.appid}`}
              >
                {entry.name}
              </Link>
            ) : (
              // The name is known from the catalogue sync but hydration has not reached this
              // appid, so there is no page to open yet.
              <span>{entry.name}</span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

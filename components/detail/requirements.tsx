import { parseRequirements, type RequirementLine } from '@/lib/format/requirements'
import { Section } from './section'

type Platform = { label: string; raw: unknown }

function Block({ heading, lines }: { heading: string; lines: RequirementLine[] }) {
  return (
    <div>
      <div className="font-medium">{heading}</div>
      <ul className="mt-1 list-disc pl-5 leading-relaxed text-text-dim">
        {lines.map((line, index) => (
          <li key={index}>
            {line.label ? <span className="text-text">{line.label}: </span> : null}
            {line.value}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RequirementsSection({ platforms }: { platforms: Platform[] }) {
  const parsed = platforms
    .map((platform) => ({ label: platform.label, requirements: parseRequirements(platform.raw) }))
    .filter((entry) => entry.requirements !== null)

  if (parsed.length === 0) return null

  return (
    <Section title="System requirements">
      <div className="grid gap-5 sm:grid-cols-2">
        {parsed.map(({ label, requirements }) => (
          <div key={label}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">
              {label}
            </div>
            <div className="mt-1 flex flex-col gap-3">
              {requirements?.minimum ? (
                <Block heading="Minimum" lines={requirements.minimum} />
              ) : null}
              {requirements?.recommended ? (
                <Block heading="Recommended" lines={requirements.recommended} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

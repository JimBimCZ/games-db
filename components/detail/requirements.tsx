import { parseRequirements } from '@/lib/format/requirements'
import { Section } from './section'

type Platform = { label: string; raw: unknown }

// Steam's own markup opens with "<strong>Minimum:</strong>" on 550 of 552 stored minimum
// blocks and on all 448 recommended ones, so the heading below is a fallback for the handful
// that arrive unlabelled rather than a second label stacked on the first.
function Block({ heading, html }: { heading: string; html: string }) {
  const selfLabelled = new RegExp(`^<strong>\\s*${heading}`, 'i').test(html)

  return (
    <div>
      {selfLabelled ? null : <div className="font-medium">{heading}</div>}
      {/* parseRequirements sanitised this; the stored value is raw Steam HTML. */}
      <div className="steam-html text-text-dim" dangerouslySetInnerHTML={{ __html: html }} />
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
              {requirements?.minimum ? <Block heading="Minimum" html={requirements.minimum} /> : null}
              {requirements?.recommended ? (
                <Block heading="Recommended" html={requirements.recommended} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

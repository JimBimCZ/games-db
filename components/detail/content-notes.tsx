import { Section } from './section'

// Only Steam's free text is shown. content_descriptor_ids is stored but deliberately not
// rendered: ids 1-5 all occur in our data, and id 5 sits both on a game with "mild partial
// nudity" and on one whose own note says it contains no adult content, so any id-to-label
// map would put false warnings on real games. See the M5 design doc, section 5.
export function ContentNotesSection({ notes }: { notes: string | null }) {
  if (!notes) return null

  return (
    <Section title="Mature content description">
      <p className="max-w-2xl text-text-dim">{notes}</p>
    </Section>
  )
}

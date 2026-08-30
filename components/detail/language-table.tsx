import { parseSupportedLanguages } from '@/lib/format/languages'
import { Section } from './section'

export function LanguageSection({ raw }: { raw: string | null }) {
  const languages = parseSupportedLanguages(raw)
  if (languages.length === 0) return null

  return (
    <Section title={`Languages (${languages.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full max-w-md text-left">
          <thead className="text-text-dim">
            <tr className="border-b border-line">
              <th scope="col" className="py-1 font-medium">
                Language
              </th>
              <th scope="col" className="py-1 font-medium">
                Full audio
              </th>
            </tr>
          </thead>
          <tbody>
            {languages.map((language) => (
              <tr key={language.name} className="border-b border-line last:border-0">
                <td className="py-1">{language.name}</td>
                <td className="py-1 text-text-dim">
                  {language.fullAudio ? <span aria-label="Yes">Yes</span> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

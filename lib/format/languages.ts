export type SupportedLanguage = {
  name: string
  fullAudio: boolean
}

// Steam stores one string: "Czech, English<strong>*</strong>, …<br><strong>*</strong>languages
// with full audio support". The asterisk marks full audio and the <br> begins a footnote that
// is prose, not a language.
export function parseSupportedLanguages(raw: string | null | undefined): SupportedLanguage[] {
  if (!raw) return []

  const [list] = raw.split('<br>')
  if (!list) return []

  return list
    .split(',')
    .map((entry) => ({
      name: entry.replace(/<[^>]*>/g, '').replace(/\*/g, '').trim(),
      fullAudio: /<strong>\s*\*\s*<\/strong>/.test(entry),
    }))
    .filter((language) => language.name.length > 0)
}

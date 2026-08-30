import { describe, expect, it } from 'vitest'
import { parseSupportedLanguages } from '@/lib/format/languages'

// The stored value for appid 570, abbreviated in the middle but keeping both the starred
// entries and the real footnote.
const dota = 'Bulgarian, Czech, English<strong>*</strong>, Korean<strong>*</strong>, Simplified Chinese<strong>*</strong>, Vietnamese<br><strong>*</strong>languages with full audio support'

describe('parseSupportedLanguages', () => {
  it('separates interface-only languages from full-audio ones', () => {
    const langs = parseSupportedLanguages(dota)
    expect(langs).toHaveLength(6)
    expect(langs.filter((l) => l.fullAudio).map((l) => l.name)).toEqual([
      'English',
      'Korean',
      'Simplified Chinese',
    ])
    expect(langs[0]).toEqual({ name: 'Bulgarian', fullAudio: false })
  })

  // The footnote is not a language. Splitting on commas alone would append it to the last
  // entry as "Vietnamese*languages with full audio support".
  it('drops the trailing footnote', () => {
    const names = parseSupportedLanguages(dota).map((l) => l.name)
    expect(names).toContain('Vietnamese')
    expect(names.join(' ')).not.toContain('full audio')
  })

  it('handles a list with no full-audio markers', () => {
    expect(parseSupportedLanguages('English, French, Italian')).toEqual([
      { name: 'English', fullAudio: false },
      { name: 'French', fullAudio: false },
      { name: 'Italian', fullAudio: false },
    ])
  })

  it('keeps a language whose name contains a hyphen and region', () => {
    expect(parseSupportedLanguages('Portuguese - Brazil')).toEqual([
      { name: 'Portuguese - Brazil', fullAudio: false },
    ])
  })

  it('returns nothing for null, empty, or footnote-only input', () => {
    expect(parseSupportedLanguages(null)).toEqual([])
    expect(parseSupportedLanguages('')).toEqual([])
    expect(parseSupportedLanguages('<br><strong>*</strong>languages with full audio support')).toEqual([])
  })
})

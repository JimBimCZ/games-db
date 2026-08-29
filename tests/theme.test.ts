import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@/lib/theme'

describe('resolveTheme', () => {
  it('honours an explicit stored light preference over a dark system', () => {
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('honours an explicit stored dark preference over a light system', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })

  it('treats an unrecognised stored value as no preference', () => {
    expect(resolveTheme('chartreuse', true)).toBe('dark')
  })

  it('treats the explicit "system" value as no preference', () => {
    expect(resolveTheme('system', false)).toBe('light')
  })
})

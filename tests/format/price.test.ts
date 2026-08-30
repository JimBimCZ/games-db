import { describe, expect, it } from 'vitest'
import { formatMinor } from '@/lib/format/price'

describe('formatMinor', () => {
  it('formats a two-decimal currency from its minor units', () => {
    expect(formatMinor(1999, 'EUR')).toBe('€19.99')
    expect(formatMinor(1499, 'USD')).toBe('$14.99')
  })

  it('formats zero without dropping the decimals', () => {
    expect(formatMinor(0, 'EUR')).toBe('€0.00')
  })

  // Steam sends whole yen, not hundredths. Dividing by 100 unconditionally would
  // render ¥1,999 as ¥19.99.
  it('respects a currency with no minor unit', () => {
    expect(formatMinor(1999, 'JPY')).toBe('¥1,999')
  })
})

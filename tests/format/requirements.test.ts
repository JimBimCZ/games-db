import { describe, expect, it } from 'vitest'
import { parseRequirements } from '@/lib/format/requirements'

describe('parseRequirements', () => {
  it('reads both blocks when Steam supplies them', () => {
    const req = parseRequirements({
      minimum: '<strong>Minimum:</strong><br><ul class="bb_ul"><li>OS: Windows 7</li></ul>',
      recommended: '<strong>Recommended:</strong><br>More of everything',
    })
    expect(req?.minimum).toContain('Windows 7')
    expect(req?.recommended).toContain('More of everything')
  })

  it('reads a minimum-only payload', () => {
    // 104 of 552 hydrated games store minimum without recommended.
    const req = parseRequirements({ minimum: '<strong>Minimum:</strong> anything' })
    expect(req?.minimum).toContain('anything')
    expect(req?.recommended).toBeNull()
  })

  // mac_requirements is [] on 222 of 552 games and linux_requirements on 227. An empty
  // array is Steam saying "no data", not a platform with blank requirements.
  it('returns null for the empty-array, null, and junk shapes', () => {
    expect(parseRequirements([])).toBeNull()
    expect(parseRequirements(null)).toBeNull()
    expect(parseRequirements(undefined)).toBeNull()
    expect(parseRequirements('Windows 7')).toBeNull()
    expect(parseRequirements({})).toBeNull()
  })

  // map-app-details.ts stores these fields unsanitised on purpose and hands the obligation
  // to the render path. This is that obligation, discharged here so no call site can skip it.
  it('strips script out of the stored HTML', () => {
    const req = parseRequirements({ minimum: 'OS<script>alert(1)</script><strong>ok</strong>' })
    expect(req?.minimum).not.toContain('<script')
    expect(req?.minimum).not.toContain('alert(1)')
    expect(req?.minimum).toContain('<strong>ok</strong>')
  })
})

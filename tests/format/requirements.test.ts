import { describe, expect, it } from 'vitest'
import { parseRequirements } from '@/lib/format/requirements'

describe('parseRequirements', () => {
  it('turns a bulleted block into labelled lines', () => {
    const req = parseRequirements({
      minimum:
        '<strong>Minimum:</strong><br><ul class="bb_ul">' +
        '<li><strong>OS *:</strong> Windows 7 or newer<br></li>' +
        '<li><strong>Memory:</strong> 4 GB RAM</li></ul>',
    })

    expect(req?.minimum).toEqual([
      { label: 'OS *', value: 'Windows 7 or newer' },
      { label: 'Memory', value: '4 GB RAM' },
    ])
  })

  it('keeps a bullet Steam sends without a label', () => {
    // appdetails-1174180 opens its list with this unlabelled line.
    const req = parseRequirements({
      minimum:
        '<ul class="bb_ul"><li>Requires a 64-bit processor and operating system<br></li></ul>',
    })

    expect(req?.minimum).toEqual([
      { label: null, value: 'Requires a 64-bit processor and operating system' },
    ])
  })

  it('splits on <br> when Steam sends prose instead of a list', () => {
    // 112 of 14,601 stored minimum blocks have no <ul>; appid 7110 packs both halves into
    // the minimum field, so the second line keeps its own label.
    const req = parseRequirements({
      minimum:
        '<strong>Minimum: </strong>Windows XP, 512MB RAM<br><strong>Recommended: </strong>3 GHz Intel',
    })

    expect(req?.minimum).toEqual([
      { label: null, value: 'Windows XP, 512MB RAM' },
      { label: 'Recommended', value: '3 GHz Intel' },
    ])
  })

  it('drops a heading that only repeats the block it labels', () => {
    // appid 7670 wraps its self-label in <h2 class="bb_tag"> rather than a bare <strong>.
    const req = parseRequirements({
      minimum:
        '<h2 class="bb_tag" ><strong>Minimum: </strong></h2><ul class="bb_ul">' +
        '<li><strong>CPU</strong>: Intel single-core</li></ul>',
    })

    expect(req?.minimum).toEqual([{ label: 'CPU', value: 'Intel single-core' }])
  })

  it('decodes the entities Steam escapes', () => {
    const req = parseRequirements({
      minimum: '<ul class="bb_ul"><li><strong>Graphics:</strong> AMD&reg; &amp; NVIDIA&#174;</li></ul>',
    })

    expect(req?.minimum).toEqual([{ label: 'Graphics', value: 'AMD® & NVIDIA®' }])
  })

  it('collapses the tabs Steam pads its list items with', () => {
    // appid 10680 and friends indent the closing </li> with a run of tabs.
    const req = parseRequirements({
      minimum: '<ul class="bb_ul"><li><strong>Memory:</strong> 1 GB\n\t\t\t\tSystem RAM<br>\t\t\t</li></ul>',
    })

    expect(req?.minimum).toEqual([{ label: 'Memory', value: '1 GB System RAM' }])
  })

  it('reads a minimum-only payload', () => {
    // 5,923 of 14,601 games store minimum without recommended.
    const req = parseRequirements({ minimum: '<strong>Minimum:</strong> anything' })

    expect(req?.minimum).toEqual([{ label: null, value: 'anything' }])
    expect(req?.recommended).toBeNull()
  })

  // mac_requirements is [] on half the catalogue and linux_requirements on rather more. An
  // empty array is Steam saying "no data", not a platform with blank requirements.
  it('returns null for the empty-array, null, and junk shapes', () => {
    expect(parseRequirements([])).toBeNull()
    expect(parseRequirements(null)).toBeNull()
    expect(parseRequirements(undefined)).toBeNull()
    expect(parseRequirements('Windows 7')).toBeNull()
    expect(parseRequirements({})).toBeNull()
  })

  // map-app-details.ts stores these fields exactly as Steam sent them. Nothing here is
  // rendered as HTML any more, so the obligation is to carry no markup out of this function
  // at all — script text included, which stripping tags alone would leave behind as prose.
  it('carries no markup or script text out of the stored HTML', () => {
    const req = parseRequirements({
      minimum: '<ul class="bb_ul"><li>OS<script>alert(1)</script><strong>ok</strong></li></ul>',
    })

    const rendered = JSON.stringify(req)
    expect(rendered).not.toContain('<')
    expect(rendered).not.toContain('alert(1)')
    expect(rendered).toContain('OS')
  })
})

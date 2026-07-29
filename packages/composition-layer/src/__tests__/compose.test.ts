import { describe, it, expect } from 'vitest'
import { composeArtifact, UnsupportedArtifactTypeError } from '../compose'
import { makeCarouselFixture, makeDeckFixture, makeReportFixture, makeNewsletterFixture } from './fixtures'

describe('composeArtifact — carousel', () => {
  it('produces one CompositionUnit per slide, with id/role/layout/pageBreak set', () => {
    const artifact = makeCarouselFixture({
      slides: [
        { slide: 1, role: 'hook', headline: 'Hook headline' },
        { slide: 2, role: 'cta', headline: 'CTA headline' },
      ],
    })
    const doc = composeArtifact(artifact)
    expect(doc.units).toHaveLength(2)
    expect(doc.units[0]).toMatchObject({ id: 'carousel-slide-1', role: 'hook', pageBreak: 'avoid' })
    expect(doc.units[1]).toMatchObject({ id: 'carousel-slide-2', role: 'cta', pageBreak: 'avoid' })
  })

  it('sets artifactId/artifactType/artifactVersion/theme on the document', () => {
    const artifact = makeCarouselFixture({ id: 'abc-123', created_at: '2026-01-01T00:00:00.000Z' })
    const doc = composeArtifact(artifact)
    expect(doc.artifactId).toBe('abc-123')
    expect(doc.artifactType).toBe('carousel')
    expect(doc.artifactVersion).toBe('2026-01-01T00:00:00.000Z')
    expect(doc.theme.palette.primary).toBeTruthy()
  })

  it('builds one heading block from headline, plus body/bullets/insight/evidence/takeaway/speaker_notes when present', () => {
    const artifact = makeCarouselFixture({
      slides: [
        {
          slide: 1,
          role: 'evidence',
          headline: 'The headline',
          subheadline: 'The subheadline',
          body: 'The body text.',
          bullets: ['Bullet one', 'Bullet two'],
          insight: 'The insight',
          supporting_evidence: ['Evidence one'],
          key_takeaway: 'The takeaway',
          speaker_notes: 'Notes for presenter',
        },
      ],
    })
    const blocks = composeArtifact(artifact).units[0]!.blocks
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'The headline', emphasis: undefined },
      { kind: 'heading', level: 2, text: 'The subheadline' },
      { kind: 'body', text: 'The body text.', emphasis: undefined },
      { kind: 'bullets', items: ['Bullet one', 'Bullet two'] },
      { kind: 'callout', variant: 'insight', text: 'The insight' },
      { kind: 'evidence-list', items: ['Evidence one'] },
      { kind: 'callout', variant: 'takeaway', text: 'The takeaway' },
      { kind: 'speaker-notes', text: 'Notes for presenter' },
    ])
  })

  it('omits optional blocks entirely when their source field is absent, rather than emitting empty blocks', () => {
    const artifact = makeCarouselFixture({
      slides: [{ slide: 1, role: 'hook', headline: 'Just a headline' }],
    })
    const blocks = composeArtifact(artifact).units[0]!.blocks
    expect(blocks).toEqual([{ kind: 'heading', level: 1, text: 'Just a headline', emphasis: undefined }])
  })

  it('folds emphasis_keywords into the heading block when they match the headline', () => {
    const artifact = makeCarouselFixture({
      slides: [
        {
          slide: 1,
          role: 'hook',
          headline: 'Revenue grew 40% this quarter',
          emphasis_keywords: ['40%'],
        },
      ],
    })
    const heading = composeArtifact(artifact).units[0]!.blocks[0]
    expect(heading).toMatchObject({ kind: 'heading', emphasis: ['40%'] })
  })

  it('folds emphasis_keywords into the body block when they match the body instead of the headline', () => {
    const artifact = makeCarouselFixture({
      slides: [
        {
          slide: 1,
          role: 'hook',
          headline: 'A generic headline',
          body: 'The real number is 40% growth.',
          emphasis_keywords: ['40%'],
        },
      ],
    })
    const doc = composeArtifact(artifact)
    const headingBlock = doc.units[0]!.blocks.find((b) => b.kind === 'heading')
    const bodyBlock = doc.units[0]!.blocks.find((b) => b.kind === 'body')
    expect(headingBlock).toMatchObject({ emphasis: undefined })
    expect(bodyBlock).toMatchObject({ emphasis: ['40%'] })
  })

  it('never silently drops an emphasis keyword that matches neither headline nor body — falls back to the heading', () => {
    const artifact = makeCarouselFixture({
      slides: [
        {
          slide: 1,
          role: 'hook',
          headline: 'A headline with no numbers',
          body: 'A body with no numbers either.',
          emphasis_keywords: ['unmatched-term'],
        },
      ],
    })
    const heading = composeArtifact(artifact).units[0]!.blocks[0]
    expect(heading).toMatchObject({ kind: 'heading', emphasis: ['unmatched-term'] })
  })

  it('matches emphasis keywords case-insensitively', () => {
    const artifact = makeCarouselFixture({
      slides: [{ slide: 1, role: 'hook', headline: 'REVENUE grew fast', emphasis_keywords: ['revenue'] }],
    })
    const heading = composeArtifact(artifact).units[0]!.blocks[0]
    expect(heading).toMatchObject({ emphasis: ['revenue'] })
  })
})

describe('composeArtifact — deck', () => {
  it('builds heading/subtitle/body/bullets/stat-row/speaker-notes blocks', () => {
    const artifact = makeDeckFixture({
      slides: [
        {
          slide: 1,
          type: 'stats',
          title: 'Q4 Results',
          subtitle: 'A strong quarter',
          body: 'Body copy',
          bullets: ['Point one'],
          stats: [{ value: '40%', label: 'Growth' }],
          speaker_notes: 'Say this out loud',
        },
      ],
    })
    const blocks = composeArtifact(artifact).units[0]!.blocks
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Q4 Results' },
      { kind: 'heading', level: 2, text: 'A strong quarter' },
      { kind: 'body', text: 'Body copy' },
      { kind: 'bullets', items: ['Point one'] },
      { kind: 'stat-row', stats: [{ value: '40%', label: 'Growth' }] },
      { kind: 'speaker-notes', text: 'Say this out loud' },
    ])
  })

  it('sets pageBreak: always for cover/divider/closing slides, avoid for everything else', () => {
    const artifact = makeDeckFixture({
      slides: [
        { slide: 1, type: 'cover', title: 'Cover' },
        { slide: 2, type: 'content', title: 'Content' },
        { slide: 3, type: 'divider', title: 'Divider' },
        { slide: 4, type: 'closing', title: 'Closing' },
      ],
    })
    const units = composeArtifact(artifact).units
    expect(units.map((u) => u.pageBreak)).toEqual(['always', 'avoid', 'always', 'always'])
  })
})

describe('composeArtifact — report', () => {
  it('builds heading/subheading/body/key_findings/data_points blocks', () => {
    const artifact = makeReportFixture({
      sections: [
        {
          id: 'findings',
          heading: 'Key Findings',
          subheading: 'What we learned',
          body: 'Narrative body text.',
          key_findings: ['Finding one'],
          data_points: [
            { label: 'Revenue', value: '$1M', source: 'Q4 report' },
            { label: 'Users', value: '10k' },
          ],
        },
      ],
    })
    const blocks = composeArtifact(artifact).units[0]!.blocks
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Key Findings' },
      { kind: 'heading', level: 2, text: 'What we learned' },
      { kind: 'body', text: 'Narrative body text.' },
      { kind: 'bullets', items: ['Finding one'] },
      { kind: 'evidence-list', items: ['Revenue: $1M (Q4 report)', 'Users: 10k'] },
    ])
  })

  it('uses pageBreak: auto for every section (flowing document, not a card stack)', () => {
    const artifact = makeReportFixture()
    expect(composeArtifact(artifact).units[0]!.pageBreak).toBe('auto')
  })
})

describe('composeArtifact — newsletter', () => {
  it('builds heading/body/bullets/callout blocks, omitting heading when absent', () => {
    const artifact = makeNewsletterFixture({
      sections: [
        { id: 'qt', type: 'quick-takes', body: 'Intro to quick takes', bullets: ['Take one'], callout: 'A quote' },
      ],
    })
    const blocks = composeArtifact(artifact).units[0]!.blocks
    expect(blocks).toEqual([
      { kind: 'body', text: 'Intro to quick takes' },
      { kind: 'bullets', items: ['Take one'] },
      { kind: 'callout', variant: 'quote', text: 'A quote' },
    ])
  })

  it('sets pageBreak: always only for divider sections', () => {
    const artifact = makeNewsletterFixture({
      sections: [
        { id: 'intro', type: 'intro', body: 'intro body' },
        { id: 'div', type: 'divider', body: 'divider body' },
      ],
    })
    const units = composeArtifact(artifact).units
    expect(units.map((u) => u.pageBreak)).toEqual(['auto', 'always'])
  })
})

describe('composeArtifact — unsupported artifact types', () => {
  it('throws UnsupportedArtifactTypeError for a runtime value outside the ArtifactV2 union', () => {
    // Simulates an untyped value arriving without governance validation
    // (e.g. straight off JSON.parse) — see compose.ts's documented rationale
    // for why this defensive branch exists despite ArtifactV2's type-level
    // union making it technically unreachable for well-typed input.
    const malformed = { artifact_type: 'landing_page' } as unknown as Parameters<typeof composeArtifact>[0]
    expect(() => composeArtifact(malformed)).toThrow(UnsupportedArtifactTypeError)
    expect(() => composeArtifact(malformed)).toThrow(/landing_page/)
  })
})

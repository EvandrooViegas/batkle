'use client'

import GlobalDesignPreview from '@/components/GlobalDesignPreview'
import { INITIAL_GLOBAL_FAMILIES } from '@/lib/designs/global/seeds'

const FAMILIES = Object.fromEntries(INITIAL_GLOBAL_FAMILIES.map(family => [family.id, family]))

/**
 * A real Batkle post for the upgrade pictures: one of Batkle's own designs composed with sample copy, exactly as the
 * Design Library previews it. `design` is a starter design's id, `sample` its sample slide (0–3), `brand` the colours
 * it is drawn in (the design's own when empty). Loaded on demand, so pages pay for the composer only with an upgrade.
 */
export default function RealPost({ design, sample = 0, brand = {} }) {
  const family = FAMILIES[design]
  return family ? <GlobalDesignPreview family={family} brand={brand} sample={sample} eager sampleLabel={false} /> : null
}

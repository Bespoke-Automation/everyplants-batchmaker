import { NextRequest, NextResponse } from 'next/server'
import { getFingerprintDetail, getFingerprintDetailV2 } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/fingerprints/[fingerprint]
 *   ?model=observation|legacy
 *   &country=NL   (only meaningful for model=legacy)
 *
 * Drill-down for a single fingerprint.
 *
 * - `model=legacy` (default): reads `packaging_advice` grouped by
 *   (shipping_unit_fingerprint, country_code). The `country` query param
 *   disambiguates legacy fingerprints that share a shipping-unit fingerprint
 *   across countries.
 * - `model=observation`: reads `packing_observations`. The observation model
 *   is land-onafhankelijk, so `country` is silently ignored. Recent activity
 *   is derived live from completed sessions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> },
) {
  try {
    const { fingerprint } = await params
    const decoded = decodeURIComponent(fingerprint)

    const modelParam = request.nextUrl.searchParams.get('model')
    const model = modelParam === 'observation' ? 'observation' : 'legacy'

    const country = request.nextUrl.searchParams.get('country')

    const detail =
      model === 'observation'
        ? await getFingerprintDetailV2(decoded)
        : await getFingerprintDetail(decoded, country)

    if (!detail) {
      return NextResponse.json(
        { error: 'Fingerprint niet gevonden', fingerprint: decoded, model },
        { status: 404 },
      )
    }

    return NextResponse.json({ ...detail, model })
  } catch (error) {
    console.error('[insights/fingerprints/[fingerprint]] error:', error)
    return NextResponse.json(
      {
        error: 'Fingerprint detail ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}

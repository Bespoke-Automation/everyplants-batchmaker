import { NextRequest, NextResponse } from 'next/server'
import { resolveFingerprintNames } from '@/lib/engine/fingerprintResolver'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/fingerprints/resolve?codes=a,b,c
 *   or  ?fingerprint=code:qty|code:qty
 *
 * Resolves productcodes to human-readable names via product_attributes.
 * Accepts either:
 *   - `codes`       — comma-separated productcodes (no qty)
 *   - `fingerprint` — a full V2 fingerprint string (productcode:qty|...)
 *
 * Returns `{ entries: [{ productcode, quantity, product_name }] }`.
 * When only `codes` is given, quantity defaults to 1 and callers should
 * ignore it.
 */
export async function GET(request: NextRequest) {
  try {
    const fingerprint = request.nextUrl.searchParams.get('fingerprint')
    const codes = request.nextUrl.searchParams.get('codes')

    const target = fingerprint
      ? fingerprint
      : codes
        ? codes
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => `${c}:1`)
            .join('|')
        : ''

    if (!target) {
      return NextResponse.json({ entries: [] })
    }

    const entries = await resolveFingerprintNames(target)
    return NextResponse.json({ entries })
  } catch (error) {
    console.error('[insights/fingerprints/resolve] error:', error)
    return NextResponse.json(
      {
        error: 'Fingerprint resolve mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}

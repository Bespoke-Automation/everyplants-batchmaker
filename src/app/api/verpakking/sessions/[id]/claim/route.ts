import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sessions/[id]/claim
 * Deprecated - use POST /api/verpakking/sessions instead
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Use POST /api/verpakking/sessions to claim a picklist' },
    { status: 410 }
  )
}

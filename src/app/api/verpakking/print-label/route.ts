import { NextResponse, type NextRequest } from 'next/server'
import { tryAutoPrint } from '@/lib/printnode/autoPrint'

export const dynamic = 'force-dynamic'

// Allowed URL patterns for label fetching (prevent SSRF)
const ALLOWED_LABEL_HOSTS = [
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  'https://files-cdn.picqer.net',
  'https://files.picqer.net',
].filter(Boolean) as string[]

function isAllowedLabelUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_LABEL_HOSTS.some((host) => parsed.origin === new URL(host).origin)
  } catch {
    return false
  }
}

/**
 * POST /api/verpakking/print-label
 * Reprint a label by fetching the PDF and sending it to PrintNode.
 */
export async function POST(request: NextRequest) {
  try {
    const { labelUrl, packingStationId, boxId } = await request.json()

    if (!labelUrl || !packingStationId || !boxId) {
      return NextResponse.json(
        { error: 'Missing required fields: labelUrl, packingStationId, boxId' },
        { status: 400 }
      )
    }

    if (!isAllowedLabelUrl(labelUrl)) {
      return NextResponse.json(
        { error: 'Invalid label URL: not an allowed host' },
        { status: 403 }
      )
    }

    // Fetch the label PDF
    const labelRes = await fetch(labelUrl)
    if (!labelRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch label: ${labelRes.status}` },
        { status: 502 }
      )
    }

    const labelBuffer = Buffer.from(await labelRes.arrayBuffer())

    // Send to PrintNode
    await tryAutoPrint(packingStationId, labelBuffer, 0, `reprint-${boxId}`)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[print-label] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

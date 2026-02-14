import { NextRequest, NextResponse } from 'next/server'
import { getPackingListPdf } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklists/packinglistpdf?idpicklist=1,2,3&show_aliases=1
 * Returns the packing list PDF for the given picklists
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const idpicklistParam = searchParams.get('idpicklist')
    const showAliases = searchParams.get('show_aliases') === '1'

    if (!idpicklistParam) {
      return NextResponse.json({ error: 'idpicklist parameter is required' }, { status: 400 })
    }

    const picklistIds = idpicklistParam.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id))

    if (picklistIds.length === 0) {
      return NextResponse.json({ error: 'No valid picklist IDs provided' }, { status: 400 })
    }

    const result = await getPackingListPdf(picklistIds, showAliases)

    if (!result.success || !result.data) {
      return NextResponse.json(
        { error: result.error || 'Failed to fetch packing list PDF' },
        { status: 500 }
      )
    }

    return new NextResponse(new Uint8Array(result.data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="pakbon-${picklistIds.join('-')}.pdf"`,
      },
    })
  } catch (error) {
    console.error('[picqer] Error fetching packing list PDF:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packing list PDF', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

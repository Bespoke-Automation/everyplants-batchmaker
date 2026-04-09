import { NextResponse } from 'next/server'
import { buildPickList, buildPickListByBatch, type TimeRangeFilter } from '@/lib/raapmodule/pickListBuilder'
import type { RaapCategory } from '@/lib/supabase/raapCategoryLocations'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES: RaapCategory[] = ['kamerplanten', 'buitenplanten', 'kunstplanten', 'potten']

export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params
  const { searchParams } = new URL(request.url)
  const vervoerder_id = searchParams.get('vervoerder_id') || undefined
  const vervoerder_ids = vervoerder_id?.includes(',') ? vervoerder_id.split(',') : undefined
  const groupBy = searchParams.get('group_by')
  const timeRange: TimeRangeFilter = {
    time_from: searchParams.get('time_from') || undefined,
    time_to: searchParams.get('time_to') || undefined,
  }

  if (!VALID_CATEGORIES.includes(category as RaapCategory)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  try {
    if (groupBy === 'batch') {
      const items = await buildPickListByBatch(category as RaapCategory, timeRange)
      return NextResponse.json({ items })
    }
    const items = await buildPickList(category as RaapCategory, vervoerder_ids || vervoerder_id, timeRange)
    return NextResponse.json({ items })
  } catch (error) {
    console.error(`Error building pick list for ${category}:`, error)
    return NextResponse.json({ error: 'Failed to build pick list' }, { status: 500 })
  }
}

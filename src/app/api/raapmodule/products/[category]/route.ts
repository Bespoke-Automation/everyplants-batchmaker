import { NextResponse } from 'next/server'
import { buildPickList } from '@/lib/raapmodule/pickListBuilder'
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

  if (!VALID_CATEGORIES.includes(category as RaapCategory)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  try {
    const items = await buildPickList(category as RaapCategory, vervoerder_id)
    return NextResponse.json({ items })
  } catch (error) {
    console.error(`Error building pick list for ${category}:`, error)
    return NextResponse.json({ error: 'Failed to build pick list' }, { status: 500 })
  }
}

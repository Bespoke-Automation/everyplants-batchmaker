import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { buildPickList } from '@/lib/raapmodule/pickListBuilder'
import { getPickedItems, cleanupClosedPicklistItems } from '@/lib/supabase/raapPickedItems'
import { fetchPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 1. Get current tracked picked items
    const pickedItems = await getPickedItems()

    // 2. Cleanup: remove entries where picklist is now closed
    const uniquePicklistIds = [...new Set(pickedItems.map(p => p.picklist_id))]
    const closedPicklistIds: number[] = []

    for (const picklistId of uniquePicklistIds) {
      try {
        const picklist = await fetchPicklist(picklistId)
        if (picklist.status === 'closed' || picklist.status === 'cancelled') {
          closedPicklistIds.push(picklistId)
        }
      } catch {
        closedPicklistIds.push(picklistId) // Picklist gone = done
      }
    }

    await cleanupClosedPicklistItems(closedPicklistIds)

    // 3. Re-fetch after cleanup
    const activePickedItems = await getPickedItems()
    const pickedKeys = new Set(
      activePickedItems.map(p => `${p.product_id}::${p.location}`)
    )

    // 4. Build full buitenplanten pick list
    const allItems = await buildPickList('buitenplanten')

    // 5. Exclude already-picked items
    const exportItems = allItems.filter(
      item => !pickedKeys.has(`${item.product_id}::${item.location}`)
    )

    // 6. Build XLSX
    const rows = exportItems.map(item => ({
      Productcode: item.productcode,
      Productnaam: item.product_name,
      Locatie: item.location,
      Aantal: item.qty_needed,
      'Batch refs': item.batch_ids.join(', '),
    }))

    const ws = XLSX.utils.json_to_sheet(rows)

    // Set column widths
    ws['!cols'] = [
      { wch: 15 }, // Productcode
      { wch: 40 }, // Productnaam
      { wch: 12 }, // Locatie
      { wch: 8 },  // Aantal
      { wch: 20 }, // Batch refs
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Buitenplanten')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const today = new Date().toISOString().slice(0, 10)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="buitenplanten-${today}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Error generating buitenplanten export:', error)
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 })
  }
}

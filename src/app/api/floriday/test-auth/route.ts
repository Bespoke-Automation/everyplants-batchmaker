import { NextResponse } from 'next/server'
import { getFloridayToken } from '@/lib/floriday/auth'
import { getFloridayEnv } from '@/lib/floriday/config'
import { getMaxSequence, syncTradeItems } from '@/lib/floriday/client'

export async function GET() {
  const env = getFloridayEnv()

  try {
    const results: Record<string, unknown> = { env }

    // 1. Token ophalen
    const token = await getFloridayToken()
    results.token = `OK (${token.length} chars)`

    // 2. Max sequences ophalen
    const tradeItemsMax = await getMaxSequence('trade-items')
    results.tradeItemsMaxSequence = tradeItemsMax

    const salesOrdersMax = await getMaxSequence('sales-orders')
    results.salesOrdersMaxSequence = salesOrdersMax

    const supplyLinesMax = await getMaxSequence('supply-lines')
    results.supplyLinesMaxSequence = supplyLinesMax

    // 3. Trade items sync test
    const tradeItems = await syncTradeItems(0)
    results.tradeItemsSync = {
      count: tradeItems.results.length,
      maxSequence: tradeItems.maximumSequenceNumber,
      firstItem: tradeItems.results[0]?.tradeItemName?.nl ?? null,
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    return NextResponse.json(
      { success: false, env, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const weeks = parseInt(request.nextUrl.searchParams.get('weeks') || '12')
    const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString()

    // 1. Fetch all advices in period
    const { data: advices, error: advError } = await supabase
      .schema('batchmaker')
      .from('packaging_advice')
      .select('calculated_at, outcome, confidence, advice_boxes, actual_boxes, shipping_provider_profile_id')
      .neq('status', 'invalidated')
      .gte('calculated_at', since)

    if (advError) throw advError

    // 2. Weekly breakdown
    const weeklyMap = new Map<string, { total: number; followed: number; modified: number; ignored: number }>()
    for (const a of advices || []) {
      // Get Monday of the week
      const d = new Date(a.calculated_at)
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
      const monday = new Date(d)
      monday.setDate(diff)
      const weekKey = monday.toISOString().split('T')[0]

      const entry = weeklyMap.get(weekKey) || { total: 0, followed: 0, modified: 0, ignored: 0 }
      entry.total++
      if (a.outcome === 'followed') entry.followed++
      if (a.outcome === 'modified') entry.modified++
      if (a.outcome === 'ignored') entry.ignored++
      weeklyMap.set(weekKey, entry)
    }

    const weeklyData = Array.from(weeklyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, data]) => ({
        week_start: weekStart,
        ...data,
        follow_rate: data.total > 0 ? Math.round(((data.followed) / (data.followed + data.modified + data.ignored || 1)) * 100) : 0,
      }))

    // 3. Problem products (most frequently unclassified)
    const { data: unclassified, error: unclError } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('productcode, product_name')
      .eq('classification_status', 'unclassified')
      .order('productcode')

    if (unclError) throw unclError

    // Count by productcode
    const prodCounts = new Map<string, { product_name: string; count: number }>()
    for (const p of unclassified || []) {
      const entry = prodCounts.get(p.productcode) || { product_name: p.product_name, count: 0 }
      entry.count++
      prodCounts.set(p.productcode, entry)
    }
    const problemProducts = Array.from(prodCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([productcode, data]) => ({
        productcode,
        product_name: data.product_name,
        times_unclassified: data.count,
      }))

    // 4. Cost impact
    // Fetch packagings with costs
    const { data: packagings } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('idpackaging, name, handling_cost, material_cost')

    let costImpact = null
    if (packagings && packagings.length > 0) {
      const costMap = new Map<number, number>()
      for (const pkg of packagings) {
        const total = (Number(pkg.handling_cost) || 0) + (Number(pkg.material_cost) || 0)
        if (total > 0) costMap.set(pkg.idpackaging, total)
      }

      if (costMap.size > 0) {
        let totalAdvisedCost = 0
        let totalActualCost = 0
        let comparableCount = 0

        for (const a of advices || []) {
          if (!a.outcome || !a.advice_boxes || !a.actual_boxes) continue

          const advisedBoxes = a.advice_boxes as { idpackaging: number }[]
          const actualBoxes = a.actual_boxes as { picqer_packaging_id: number | null }[]

          const advisedCost = advisedBoxes.reduce((sum, b) => sum + (costMap.get(b.idpackaging) || 0), 0)
          const actualCost = actualBoxes.reduce((sum, b) => sum + (b.picqer_packaging_id ? (costMap.get(b.picqer_packaging_id) || 0) : 0), 0)

          if (advisedCost > 0 || actualCost > 0) {
            totalAdvisedCost += advisedCost
            totalActualCost += actualCost
            comparableCount++
          }
        }

        if (comparableCount > 0) {
          costImpact = {
            total_advised_cost: Math.round(totalAdvisedCost * 100) / 100,
            total_actual_cost: Math.round(totalActualCost * 100) / 100,
            potential_savings: Math.round((totalActualCost - totalAdvisedCost) * 100) / 100,
            comparable_orders: comparableCount,
          }
        }
      }
    }

    // 5. Carrier breakdown
    const carrierMap = new Map<number, { count: number; followed: number }>()
    for (const a of advices || []) {
      if (a.shipping_provider_profile_id == null || !a.outcome) continue
      const entry = carrierMap.get(a.shipping_provider_profile_id) || { count: 0, followed: 0 }
      entry.count++
      if (a.outcome === 'followed') entry.followed++
      carrierMap.set(a.shipping_provider_profile_id, entry)
    }
    const carrierBreakdown = Array.from(carrierMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, data]) => ({
        shipping_provider_profile_id: id,
        count: data.count,
        followed: data.followed,
        follow_rate: data.count > 0 ? Math.round((data.followed / data.count) * 100) : 0,
      }))

    return NextResponse.json({
      weekly_data: weeklyData,
      problem_products: problemProducts,
      cost_impact: costImpact,
      carrier_breakdown: carrierBreakdown,
    })
  } catch (error) {
    console.error('[dashboard/trends] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch trends' },
      { status: 500 }
    )
  }
}

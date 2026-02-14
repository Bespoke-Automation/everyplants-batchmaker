import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const days = parseInt(request.nextUrl.searchParams.get('days') || '30')
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // 1. All advices in period (exclude invalidated)
    const { data: advices, error: advError } = await supabase
      .schema('batchmaker')
      .from('packaging_advice')
      .select('confidence, outcome, deviation_type, shipping_unit_fingerprint, weight_exceeded')
      .neq('status', 'invalidated')
      .gte('calculated_at', since)

    if (advError) throw advError

    // 2. Total sessions in period
    const { count: sessionCount, error: sessError } = await supabase
      .schema('batchmaker')
      .from('packing_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since)

    if (sessError) throw sessError

    // 3. Product coverage (all time)
    const { data: products, error: prodError } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('classification_status')

    if (prodError) throw prodError

    // Compute stats
    const all = advices || []
    const withOutcome = all.filter(a => a.outcome != null)

    // Outcomes
    const outcomes = {
      followed: all.filter(a => a.outcome === 'followed').length,
      modified: all.filter(a => a.outcome === 'modified').length,
      ignored: all.filter(a => a.outcome === 'ignored').length,
      no_advice: all.filter(a => a.outcome === 'no_advice').length,
      pending: all.filter(a => a.outcome == null).length,
    }

    // Deviations (only modified)
    const modified = all.filter(a => a.outcome === 'modified')
    const deviations = {
      extra_boxes: modified.filter(a => a.deviation_type === 'extra_boxes').length,
      fewer_boxes: modified.filter(a => a.deviation_type === 'fewer_boxes').length,
      different_packaging: modified.filter(a => a.deviation_type === 'different_packaging').length,
      mixed: modified.filter(a => a.deviation_type === 'mixed').length,
    }

    // Confidence vs outcome cross-tab
    const crossTab = (conf: string) => {
      const subset = withOutcome.filter(a => a.confidence === conf)
      return {
        followed: subset.filter(a => a.outcome === 'followed').length,
        modified: subset.filter(a => a.outcome === 'modified').length,
        ignored: subset.filter(a => a.outcome === 'ignored').length,
        total: subset.length,
      }
    }

    // Top fingerprints
    const fingerprintMap = new Map<string, { count: number; followed: number; modified: number; ignored: number }>()
    for (const a of withOutcome) {
      if (!a.shipping_unit_fingerprint) continue
      const fp = a.shipping_unit_fingerprint
      const entry = fingerprintMap.get(fp) || { count: 0, followed: 0, modified: 0, ignored: 0 }
      entry.count++
      if (a.outcome === 'followed') entry.followed++
      if (a.outcome === 'modified') entry.modified++
      if (a.outcome === 'ignored') entry.ignored++
      fingerprintMap.set(fp, entry)
    }
    const topFingerprints = Array.from(fingerprintMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([fingerprint, stats]) => ({ fingerprint, ...stats }))

    // Weight issues
    const weightExceeded = all.filter(a => a.weight_exceeded).length

    // Product coverage
    const prods = products || []
    const classified = prods.filter(p => p.classification_status === 'classified').length
    const unclassified = prods.filter(p => p.classification_status === 'unclassified').length

    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    return NextResponse.json({
      period: {
        from: fromDate.toISOString(),
        to: new Date().toISOString(),
        days,
      },
      totals: {
        total_advices: all.length,
        with_outcome: withOutcome.length,
        total_sessions: sessionCount || 0,
      },
      outcomes,
      deviations,
      confidence_vs_outcome: {
        full_match: crossTab('full_match'),
        partial_match: crossTab('partial_match'),
        no_match: { total: all.filter(a => a.confidence === 'no_match').length },
      },
      top_fingerprints: topFingerprints,
      weight_issues: {
        total_exceeded: weightExceeded,
        percentage: all.length > 0 ? Math.round((weightExceeded / all.length) * 100) : 0,
      },
      product_coverage: {
        total_products: prods.length,
        classified,
        unclassified,
        coverage_percentage: prods.length > 0 ? Math.round((classified / prods.length) * 100) : 0,
      },
    })
  } catch (error) {
    console.error('[dashboard/stats] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch dashboard stats' },
      { status: 500 }
    )
  }
}

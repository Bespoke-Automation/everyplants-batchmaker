import { NextRequest, NextResponse } from 'next/server'
import { getBatchSession, getPackingSessionsForBatch } from '@/lib/supabase/batchSessions'
import {
  fetchPicklist,
  fetchOrder,
  getPicklistShippingMethods,
  getPicklistBatch,
} from '@/lib/picqer/client'
import { fetchProductAttributes } from '@/lib/supabase/fetchProductAttributes'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/batch-workspace/[id]
 *
 * Bulk endpoint that fetches ALL picklist data for a batch in a single request.
 * This enables state-driven navigation between picklists without per-navigation API calls.
 *
 * The response includes:
 * - Batch session metadata (Supabase)
 * - Picqer batch data (picklists, products)
 * - Per-picklist: full picklist detail, order, shipping profile, product attributes
 *
 * All Picqer calls are parallelized server-side. The existing rate limiter (max 20 concurrent)
 * handles concurrency automatically.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: batchSessionId } = await params
    const t0 = Date.now()

    // Step 1: Fetch batch session + packing sessions from Supabase
    const [batchSession, packingSessions] = await Promise.all([
      getBatchSession(batchSessionId),
      getPackingSessionsForBatch(batchSessionId),
    ])

    if (!batchSession.batch_id) {
      return NextResponse.json(
        { error: 'Batch session has no batch_id' },
        { status: 400 }
      )
    }

    const tSession = Date.now() - t0

    // Step 2: Fetch Picqer batch (includes all picklists + products in 1 call)
    const t1 = Date.now()
    const picqerBatch = await getPicklistBatch(batchSession.batch_id)
    const tBatch = Date.now() - t1

    const picklists = picqerBatch.picklists ?? []
    if (picklists.length === 0) {
      return NextResponse.json({
        batchSession: { ...batchSession, packing_sessions: packingSessions },
        picqerBatch,
        picklistDataMap: {},
      })
    }

    // Step 3: Per-picklist parallel fetch + product attributes
    const t2 = Date.now()

    // Build image map from batch products (for enrichment)
    const imageMap = new Map<number, string>()
    for (const bp of picqerBatch.products ?? []) {
      if (bp.image) imageMap.set(bp.idproduct, bp.image)
    }

    // Fetch picklist details in controlled batches to avoid Picqer rate limits
    // (50 picklists + 50 orders + shipping would be ~100+ concurrent calls)
    const BATCH_SIZE = 10
    const picklistDetails = new Map<number, Awaited<ReturnType<typeof fetchPicklist>>>()
    const orderIds = new Set<number>()
    const allProductIds = new Set<number>()

    for (let i = 0; i < picklists.length; i += BATCH_SIZE) {
      const batch = picklists.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(pl => fetchPicklist(pl.idpicklist))
      )
      for (let j = 0; j < batch.length; j++) {
        const result = results[j]
        if (result.status === 'fulfilled') {
          const detail = result.value
          picklistDetails.set(batch[j].idpicklist, detail)
          if (detail.idorder) orderIds.add(detail.idorder)
          for (const p of detail.products ?? []) {
            allProductIds.add(p.idproduct)
          }
        }
      }
    }

    // Collect unique shipping profile IDs — shipping methods are the same for all
    // picklists, so we only need to fetch once per unique profile ID
    const uniqueShippingProfileIds = new Set<number>()
    const picklistToProfileMap = new Map<number, number>()
    for (const [idpicklist, detail] of picklistDetails.entries()) {
      if (detail.idshippingprovider_profile) {
        uniqueShippingProfileIds.add(detail.idshippingprovider_profile)
        picklistToProfileMap.set(idpicklist, detail.idshippingprovider_profile)
      }
    }

    // Find one representative picklist per unique profile (to call getPicklistShippingMethods)
    const profileToPicklistMap = new Map<number, number>()
    for (const [idpicklist, profileId] of picklistToProfileMap) {
      if (!profileToPicklistMap.has(profileId)) {
        profileToPicklistMap.set(profileId, idpicklist)
      }
    }

    // Fetch orders in controlled batches + shipping (1 call) + product attributes (1 query)
    const orderArray = Array.from(orderIds)
    const orderResults: PromiseSettledResult<{ id: number; order: Awaited<ReturnType<typeof fetchOrder>> }>[] = []
    for (let i = 0; i < orderArray.length; i += BATCH_SIZE) {
      const batch = orderArray.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(id => fetchOrder(id).then(order => ({ id, order })))
      )
      orderResults.push(...results)
    }

    // Shipping methods + product attributes (few calls, safe to parallel)
    const [shippingResults, productAttrs] = await Promise.all([
      Promise.allSettled(
        Array.from(profileToPicklistMap.entries()).map(([profileId, picklistId]) =>
          getPicklistShippingMethods(picklistId).then(methods => ({
            profileId,
            methods,
          }))
        )
      ),
      fetchProductAttributes(Array.from(allProductIds)),
    ])

    const tParallel = Date.now() - t2

    // Build lookup maps
    const orderMap = new Map<number, Awaited<ReturnType<typeof fetchOrder>>>()
    for (const result of orderResults) {
      if (result.status === 'fulfilled') {
        orderMap.set(result.value.id, result.value.order)
      }
    }

    // Build shipping profile name map: profileId → name
    const shippingProfileNameMap = new Map<number, string>()
    for (const result of shippingResults) {
      if (result.status === 'fulfilled') {
        const { profileId, methods } = result.value
        const match = methods.find((m: { idshippingprovider_profile: number; name: string }) =>
          m.idshippingprovider_profile === profileId
        )
        if (match) shippingProfileNameMap.set(profileId, match.name)
      }
    }

    // Map picklist → shipping profile name (reusing the shared lookup)
    const shippingMap = new Map<number, string>()
    for (const [idpicklist, profileId] of picklistToProfileMap) {
      const name = shippingProfileNameMap.get(profileId)
      if (name) shippingMap.set(idpicklist, name)
    }

    // Build per-picklist data map
    const picklistDataMap: Record<number, {
      picklist: Awaited<ReturnType<typeof fetchPicklist>>
      order: Awaited<ReturnType<typeof fetchOrder>> | null
      shippingProfileName: string | null
      productCustomFields: Record<number, {
        productType: string | null
        potSize: number | null
        height: number | null
        isFragile: boolean
        isMixable: boolean
      }>
    }> = {}

    const errors: Record<string, string> = {}

    for (const pl of picklists) {
      const detail = picklistDetails.get(pl.idpicklist)
      if (!detail) {
        errors[`picklist_${pl.idpicklist}`] = 'Failed to fetch picklist detail'
        continue
      }

      // Enrich products with images from batch
      for (const product of detail.products ?? []) {
        const image = imageMap.get(product.idproduct)
        if (image) product.image = image
      }

      // Get product attributes for this picklist's products only
      const picklistProductIds = (detail.products ?? []).map(p => p.idproduct)
      const picklistAttrs: typeof productAttrs = {}
      for (const pid of picklistProductIds) {
        if (productAttrs[pid]) picklistAttrs[pid] = productAttrs[pid]
      }

      picklistDataMap[pl.idpicklist] = {
        picklist: detail,
        order: detail.idorder ? (orderMap.get(detail.idorder) ?? null) : null,
        shippingProfileName: shippingMap.get(pl.idpicklist) ?? null,
        productCustomFields: picklistAttrs,
      }
    }

    const tTotal = Date.now() - t0

    console.log(
      `[batch-workspace] Timing: session=${tSession}ms batch=${tBatch}ms parallel=${tParallel}ms total=${tTotal}ms | ${picklists.length} picklists, ${orderIds.size} orders, ${uniqueShippingProfileIds.size} shipping profiles, ${allProductIds.size} products`
    )

    return NextResponse.json({
      batchSession: { ...batchSession, packing_sessions: packingSessions },
      picqerBatch,
      picklistDataMap,
      ...(Object.keys(errors).length > 0 && { _errors: errors }),
    })
  } catch (error) {
    console.error('[batch-workspace] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch workspace data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

import { inngest } from '@/inngest/client'
import { fetchOrder, getTags, addOrderTag } from '@/lib/picqer/client'
import { previewAdvice } from '@/lib/engine/packagingEngine'
import { supabase } from '@/lib/supabase/client'
import { isBoxTagDisabled, EXCLUDED_TAG_IDS } from '@/lib/verpakking/box-tag-config'
import type { OrderProduct } from '@/lib/engine/packagingEngine'

// ── In-memory caches (best-effort in serverless, helps with warm instances) ──

let knownBoxTagNamesCache: Set<string> | null = null
let knownBoxTagNamesCacheTime = 0

interface PackagingTagInfo {
  picqer_tag_name: string | null
  picqer_tag_id: number | null
}

let packagingTagMapCache: Map<string, PackagingTagInfo> | null = null
let packagingTagMapCacheTime = 0

let picqerTagLookupCache: Map<string, number> | null = null
let picqerTagLookupCacheTime = 0

const CACHE_TTL_MS = 5 * 60_000 // 5 minutes

async function getKnownBoxTagNames(): Promise<Set<string>> {
  const now = Date.now()
  if (knownBoxTagNamesCache && now - knownBoxTagNamesCacheTime < CACHE_TTL_MS) {
    return knownBoxTagNamesCache
  }

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('picqer_tag_name')
    .eq('active', true)
    .not('picqer_tag_name', 'is', null)

  if (error) {
    console.error('[autoAssignBoxTags] Failed to fetch known box tag names:', error)
    return knownBoxTagNamesCache ?? new Set()
  }

  knownBoxTagNamesCache = new Set(
    data.map(p => p.picqer_tag_name!.trim())
  )
  knownBoxTagNamesCacheTime = now
  return knownBoxTagNamesCache
}

// Maps packaging name (engine output) → { picqer_tag_name, picqer_tag_id }
async function getPackagingTagMap(): Promise<Map<string, PackagingTagInfo>> {
  const now = Date.now()
  if (packagingTagMapCache && now - packagingTagMapCacheTime < CACHE_TTL_MS) {
    return packagingTagMapCache
  }

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('name, picqer_tag_name, picqer_tag_id')
    .eq('active', true)

  if (error) {
    console.error('[autoAssignBoxTags] Failed to fetch packaging tag map:', error)
    return packagingTagMapCache ?? new Map()
  }

  packagingTagMapCache = new Map()
  for (const p of data) {
    packagingTagMapCache.set(p.name.trim(), {
      picqer_tag_name: p.picqer_tag_name?.trim() ?? null,
      picqer_tag_id: p.picqer_tag_id ?? null,
    })
  }
  packagingTagMapCacheTime = now
  return packagingTagMapCache
}

async function getPicqerTagLookup(): Promise<Map<string, number>> {
  const now = Date.now()
  if (picqerTagLookupCache && now - picqerTagLookupCacheTime < CACHE_TTL_MS) {
    return picqerTagLookupCache
  }

  const allPicqerTags = await getTags()
  picqerTagLookupCache = new Map<string, number>()
  for (const t of allPicqerTags) {
    picqerTagLookupCache.set(t.title.trim(), t.idtag)
  }
  picqerTagLookupCacheTime = now
  return picqerTagLookupCache
}

// ── Log helper ──

async function logResult(
  orderId: number,
  status: string,
  tagsWritten?: string[],
  confidence?: string,
  errorMessage?: string
) {
  const { error } = await supabase
    .schema('batchmaker')
    .from('box_tag_log')
    .insert({
      order_id: orderId,
      status,
      tags_written: tagsWritten ?? null,
      confidence: confidence ?? null,
      error_message: errorMessage ?? null,
    })

  if (error) {
    console.error('[autoAssignBoxTags] Failed to write log:', error)
  }
}

// ── Inngest function ──

export const autoAssignBoxTags = inngest.createFunction(
  {
    id: 'auto-assign-box-tags',
    retries: 3,
    idempotency: 'event.data.orderId',
  },
  { event: 'orders/box-tag.requested' },
  async ({ event, step }) => {
    const orderId = event.data.orderId as number

    if (isBoxTagDisabled()) {
      console.log(`[autoAssignBoxTags] Kill switch active — skipping order ${orderId}`)
      return { status: 'disabled' }
    }

    // Step 1: Fetch the order from Picqer
    const order = await step.run('fetch-order', async () => {
      return await fetchOrder(orderId)
    })

    // Step 2: Check eligibility
    const eligibility = await step.run('check-eligibility', async () => {
      if (isBoxTagDisabled()) {
        return { eligible: false, reason: 'disabled' }
      }

      // Check 1: Order must be in "processing" status
      if (order.status !== 'processing') {
        console.log(`[autoAssignBoxTags] Order ${orderId} status is "${order.status}" — skipping`)
        await logResult(orderId, 'skipped_not_processing')
        return { eligible: false, reason: 'skipped_not_processing' }
      }

      // Check 2: Skip orders with excluded tags (Plantura, Floriday — handled separately)
      const orderTagIds = Object.values(order.tags).map(t => t.idtag)
      const matchedExcludedTag = EXCLUDED_TAG_IDS.find(id => orderTagIds.includes(id))
      if (matchedExcludedTag) {
        console.log(`[autoAssignBoxTags] Order ${orderId} has excluded tag ${matchedExcludedTag} — skipping`)
        await logResult(orderId, 'skipped_excluded_tag')
        return { eligible: false, reason: 'skipped_excluded_tag' }
      }

      // Check 3: Skip if order already has a known box tag
      const knownBoxTagNames = await getKnownBoxTagNames()
      const existingBoxTags = Object.values(order.tags).filter(t =>
        knownBoxTagNames.has(t.title.trim())
      )

      if (existingBoxTags.length > 0) {
        console.log(`[autoAssignBoxTags] Order ${orderId} already has box tag(s): ${existingBoxTags.map(t => t.title).join(', ')} — skipping`)
        await logResult(orderId, 'skipped_has_tags')
        return { eligible: false, reason: 'skipped_has_tags' }
      }

      // Check 4: Order must have products
      if (!order.products || order.products.length === 0) {
        console.log(`[autoAssignBoxTags] Order ${orderId} has no products — skipping`)
        await logResult(orderId, 'skipped_no_products')
        return { eligible: false, reason: 'skipped_no_products' }
      }

      return { eligible: true, reason: 'ok' }
    })

    if (!eligibility.eligible) {
      return { status: eligibility.reason }
    }

    // Step 3: Run engine preview (dry-run, no side-effects)
    const engineResult = await step.run('run-engine', async () => {
      const products: OrderProduct[] = order.products.map(p => ({
        picqer_product_id: p.idproduct,
        productcode: p.productcode,
        quantity: p.amount,
      }))

      const countryCode = order.deliverycountry || 'NL'

      console.log(`[autoAssignBoxTags] Running engine preview for order ${orderId} (${products.length} products, country: ${countryCode})`)
      const advice = await previewAdvice(products, countryCode)

      if (advice.confidence === 'no_match' || advice.advice_boxes.length === 0) {
        console.log(`[autoAssignBoxTags] Engine returned ${advice.confidence} for order ${orderId} — no tags to write`)
        await logResult(orderId, 'skipped_no_match', undefined, advice.confidence)
        return { match: false as const, confidence: advice.confidence, tagNames: [] as string[] }
      }

      // Deduplicate — same packaging = same tag
      const tagNames = [...new Set(advice.advice_boxes.map(box => box.packaging_name))]

      return {
        match: true as const,
        confidence: advice.confidence,
        tagNames,
      }
    })

    if (!engineResult.match) {
      return { status: 'skipped_no_match', confidence: engineResult.confidence }
    }

    // Step 4: Resolve packaging names → Picqer tag IDs
    const writeResult = await step.run('write-tags', async () => {
      const packagingTagMap = await getPackagingTagMap()
      const picqerTagLookup = await getPicqerTagLookup()

      const tagsWritten: string[] = []
      const tagsFailed: string[] = []

      for (const packagingName of engineResult.tagNames!) {
        const tagInfo = packagingTagMap.get(packagingName.trim())

        if (!tagInfo) {
          console.warn(`[autoAssignBoxTags] Packaging "${packagingName}" not found in packagings table — skipping`)
          tagsFailed.push(packagingName)
          continue
        }

        // Resolve tag ID: prefer direct picqer_tag_id, fallback to lookup by picqer_tag_name
        let tagId = tagInfo.picqer_tag_id
        const tagDisplayName = tagInfo.picqer_tag_name ?? packagingName

        if (!tagId && tagInfo.picqer_tag_name) {
          tagId = picqerTagLookup.get(tagInfo.picqer_tag_name) ?? null
        }

        if (!tagId) {
          console.warn(`[autoAssignBoxTags] No Picqer tag ID for packaging "${packagingName}" (picqer_tag_name: ${tagInfo.picqer_tag_name}) — skipping`)
          tagsFailed.push(packagingName)
          continue
        }

        try {
          await addOrderTag(orderId, tagId)
          tagsWritten.push(tagDisplayName)
          console.log(`[autoAssignBoxTags] Added tag "${tagDisplayName}" (${tagId}) to order ${orderId}`)
        } catch (err) {
          console.error(`[autoAssignBoxTags] Failed to add tag "${tagDisplayName}" to order ${orderId}:`, err)
          tagsFailed.push(packagingName)
        }
      }

      // If some tags failed and none succeeded, throw to trigger Inngest retry
      if (tagsWritten.length === 0 && tagsFailed.length > 0) {
        throw new Error(`All tag writes failed for order ${orderId}: ${tagsFailed.join(', ')}`)
      }

      await logResult(orderId, 'tagged', tagsWritten, engineResult.confidence)
      console.log(`[autoAssignBoxTags] Assigned ${tagsWritten.length} box tag(s) to order ${orderId}: ${tagsWritten.join(', ')}`)

      return {
        status: 'tagged',
        confidence: engineResult.confidence,
        tagsWritten,
        tagsFailed: tagsFailed.length > 0 ? tagsFailed : undefined,
      }
    })

    return writeResult
  }
)

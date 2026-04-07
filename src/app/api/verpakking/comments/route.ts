import { NextRequest, NextResponse } from 'next/server'
import { getGlobalComments, addComment, type PicqerGlobalComment } from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const PICQER_SUBDOMAIN = process.env.PICQER_SUBDOMAIN!

interface CommentMetadata {
  idcomment: number
  posted_by_worker_id: number
  posted_by_worker_name: string
  source_type: string | null
  source_id: number | null
  source_reference: string | null
  mentioned_worker_ids: number[]
}

interface CommentResolution {
  idcomment: number
  worker_id: number
  resolved_at: string
}

function buildPicqerUrl(sourceType: string, sourceId: number): string {
  const base = `https://${PICQER_SUBDOMAIN}.picqer.com`
  switch (sourceType) {
    case 'picklist': return `${base}/picklists/${sourceId}`
    case 'order': return `${base}/orders/${sourceId}`
    case 'picklist_batch': return `${base}/picklistbatches/${sourceId}`
    case 'product': return `${base}/products/${sourceId}`
    case 'customer': return `${base}/customers/${sourceId}`
    case 'supplier': return `${base}/suppliers/${sourceId}`
    case 'purchaseorder': return `${base}/purchaseorders/${sourceId}`
    case 'return': return `${base}/returns/${sourceId}`
    case 'receipt': return `${base}/receipts/${sourceId}`
    default: return base
  }
}

function buildInternalUrl(sourceType: string, sourceId: number): string | null {
  switch (sourceType) {
    case 'picklist': return `/verpakkingsmodule/picklist/${sourceId}`
    case 'picklist_batch': return `/verpakkingsmodule/batch/${sourceId}`
    default: return null
  }
}

function getSourceReference(comment: PicqerGlobalComment): string | null {
  const src = comment.source
  if (!src) return null
  const s = src as Record<string, unknown>
  if (comment.source_type === 'picklist') return (s.picklistid as string) ?? null
  if (comment.source_type === 'order') return (s.orderid as string) ?? null
  if (comment.source_type === 'picklist_batch') return `Batch ${s.picklist_batchid ?? s.idpicklist_batch ?? ''}`
  if (comment.source_type === 'product') return (s.name as string) ?? (s.productcode as string) ?? null
  return null
}

function getSourceId(comment: PicqerGlobalComment): number | null {
  const src = comment.source
  if (!src) return null
  if (comment.source_type === 'picklist') return (src as Record<string, number>).idpicklist ?? null
  if (comment.source_type === 'order') return (src as Record<string, number>).idorder ?? null
  if (comment.source_type === 'picklist_batch') return (src as Record<string, number>).idpicklist_batch ?? null
  if (comment.source_type === 'product') return (src as Record<string, number>).idproduct ?? null
  if (comment.source_type === 'customer') return (src as Record<string, number>).idcustomer ?? null
  if (comment.source_type === 'supplier') return (src as Record<string, number>).idsupplier ?? null
  if (comment.source_type === 'purchaseorder') return (src as Record<string, number>).idpurchaseorder ?? null
  if (comment.source_type === 'return') return (src as Record<string, number>).idreturn ?? null
  if (comment.source_type === 'receipt') return (src as Record<string, number>).idreceipt ?? null
  return null
}

/**
 * Enrich Picqer comments with our local metadata (real author, resolution status)
 */
async function enrichComments(
  comments: PicqerGlobalComment[],
  workerId: number | null,
) {
  if (comments.length === 0) return []

  const commentIds = comments.map(c => c.idcomment)

  // Fetch local metadata
  const { data: metadataRows } = await supabase
    .schema('batchmaker')
    .from('comment_metadata')
    .select('*')
    .in('idcomment', commentIds)

  const metadataMap = new Map<number, CommentMetadata>()
  for (const m of (metadataRows ?? []) as CommentMetadata[]) {
    metadataMap.set(m.idcomment, m)
  }

  // Fetch resolutions for this worker
  let resolutionSet = new Set<number>()
  if (workerId) {
    const { data: resolutions } = await supabase
      .schema('batchmaker')
      .from('comment_resolutions')
      .select('idcomment')
      .eq('worker_id', workerId)
      .in('idcomment', commentIds)

    resolutionSet = new Set((resolutions ?? []).map((r: { idcomment: number }) => r.idcomment))
  }

  return comments.map(comment => {
    const meta = metadataMap.get(comment.idcomment)
    const sourceId = getSourceId(comment)
    const sourceRef = meta?.source_reference ?? getSourceReference(comment)

    // Strip "[WorkerName] " prefix from body for display
    let displayBody = comment.body
    const prefixMatch = displayBody.match(/^\[([^\]]+)\]\s*/)
    const prefixName = prefixMatch ? prefixMatch[1] : null
    if (prefixMatch) {
      displayBody = displayBody.slice(prefixMatch[0].length)
    }

    return {
      idcomment: comment.idcomment,
      body: comment.body,
      displayBody,
      // Real author: from our metadata, or from prefix, or from Picqer
      displayAuthor: meta?.posted_by_worker_name ?? prefixName ?? comment.author.full_name,
      displayAuthorId: meta?.posted_by_worker_id ?? null,
      picqerAuthor: comment.author.full_name,
      picqerAuthorImage: comment.author.image_url,
      sourceType: comment.source_type,
      sourceId,
      sourceReference: sourceRef,
      sourceUrl: sourceId ? buildPicqerUrl(comment.source_type, sourceId) : null,
      internalUrl: sourceId ? buildInternalUrl(comment.source_type, sourceId) : null,
      mentions: comment.mentions?.map(m => ({
        text: m.text,
        name: m.mentioned.full_name,
        iduser: m.mentioned.iduser,
      })) ?? [],
      isResolved: resolutionSet.has(comment.idcomment),
      createdAt: comment.created_at,
      // Whether this comment was posted via our app
      isOurComment: !!meta,
    }
  })
}

/**
 * GET /api/verpakking/comments
 * ?tab=all|mine|mentions|resolved
 * &workerId=12345
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tab = searchParams.get('tab') || 'all'
    const workerId = searchParams.get('workerId') ? parseInt(searchParams.get('workerId')!, 10) : null

    if ((tab === 'mine' || tab === 'mentions' || tab === 'resolved') && !workerId) {
      return NextResponse.json({ error: 'workerId required for this tab' }, { status: 400 })
    }

    let comments: PicqerGlobalComment[] = []

    switch (tab) {
      case 'all': {
        comments = await getGlobalComments()
        break
      }

      case 'mine': {
        // Get comments posted by this worker from our metadata (with full data)
        const { data: metaRows } = await supabase
          .schema('batchmaker')
          .from('comment_metadata')
          .select('*')
          .eq('posted_by_worker_id', workerId!)
          .order('created_at', { ascending: false })
          .limit(100)

        if (metaRows && metaRows.length > 0) {
          // We have metadata locally — try to match with Picqer comments for full data
          // Fetch from Picqer using idauthor of the API key user (all our comments go through API key)
          const picqerComments = await getGlobalComments()
          const ourIds = new Set((metaRows as Array<{ idcomment: number }>).map(r => r.idcomment))
          comments = picqerComments.filter(c => ourIds.has(c.idcomment))
        }
        break
      }

      case 'mentions': {
        // Fetch from Picqer where this worker is mentioned (catches ALL mentions, including external)
        comments = await getGlobalComments({ idmentioned: workerId! })

        // Filter out resolved ones
        const commentIds = comments.map(c => c.idcomment)
        if (commentIds.length > 0) {
          const { data: resolutions } = await supabase
            .schema('batchmaker')
            .from('comment_resolutions')
            .select('idcomment')
            .eq('worker_id', workerId!)
            .in('idcomment', commentIds)

          const resolvedIds = new Set((resolutions ?? []).map((r: { idcomment: number }) => r.idcomment))
          comments = comments.filter(c => !resolvedIds.has(c.idcomment))
        }
        break
      }

      case 'resolved': {
        // Get resolved comment IDs for this worker
        const { data: resolutions } = await supabase
          .schema('batchmaker')
          .from('comment_resolutions')
          .select('idcomment')
          .eq('worker_id', workerId!)
          .order('resolved_at', { ascending: false })
          .limit(100)

        if (resolutions && resolutions.length > 0) {
          // Fetch comments where this worker is mentioned (same source as @mentions tab)
          // since resolved comments are typically ones where you were mentioned
          const mentionedComments = await getGlobalComments({ idmentioned: workerId! })
          // Also fetch global in case some resolved comments are from other sources
          const globalComments = await getGlobalComments()

          // Merge and deduplicate
          const allMap = new Map<number, typeof mentionedComments[0]>()
          for (const c of mentionedComments) allMap.set(c.idcomment, c)
          for (const c of globalComments) if (!allMap.has(c.idcomment)) allMap.set(c.idcomment, c)

          const resolvedIds = new Set((resolutions as Array<{ idcomment: number }>).map(r => r.idcomment))
          comments = Array.from(allMap.values()).filter(c => resolvedIds.has(c.idcomment))
        }
        break
      }
    }

    const enriched = await enrichComments(comments, workerId)

    return NextResponse.json({ comments: enriched })
  } catch (error) {
    console.error('[verpakking/comments] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch comments', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/comments
 * Create a comment on an entity with worker metadata
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, workerId, workerName, entityType, entityId, entityReference } = body

    if (!text || !workerId || !workerName || !entityType || !entityId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Prefix body with worker name
    const prefixedBody = `[${workerName}] ${text}`

    // Map entity type to Picqer resource type
    const resourceTypeMap: Record<string, 'picklists' | 'picklists/batches' | 'orders' | 'products' | 'customers' | 'suppliers' | 'purchaseorders' | 'returns' | 'receipts'> = {
      picklist: 'picklists',
      picklist_batch: 'picklists/batches',
      order: 'orders',
      product: 'products',
      customer: 'customers',
      supplier: 'suppliers',
      purchaseorder: 'purchaseorders',
      return: 'returns',
      receipt: 'receipts',
    }
    const resourceType = resourceTypeMap[entityType]
    if (!resourceType) {
      return NextResponse.json({ error: `Unsupported entity type: ${entityType}` }, { status: 400 })
    }

    // Post to Picqer
    const picqerComment = await addComment(resourceType, entityId, prefixedBody)

    // Parse mentioned worker IDs from the Picqer response mentions
    const globalComment = picqerComment as unknown as PicqerGlobalComment
    const mentionedIds = globalComment.mentions?.map(m => m.mentioned.iduser) ?? []

    // Save metadata locally
    await supabase
      .schema('batchmaker')
      .from('comment_metadata')
      .insert({
        idcomment: picqerComment.idcomment,
        posted_by_worker_id: workerId,
        posted_by_worker_name: workerName,
        source_type: entityType,
        source_id: entityId,
        source_reference: entityReference || null,
        mentioned_worker_ids: mentionedIds,
      })

    return NextResponse.json({ success: true, idcomment: picqerComment.idcomment })
  } catch (error) {
    console.error('[verpakking/comments] Error posting:', error)
    return NextResponse.json(
      { error: 'Failed to post comment', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

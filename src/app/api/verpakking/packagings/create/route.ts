import { NextRequest, NextResponse } from 'next/server'
import { createPackaging as picqerCreatePackaging, createTag } from '@/lib/picqer/client'
import { insertLocalPackaging, updateLocalPackaging } from '@/lib/supabase/localPackagings'
import { getLocalTags, upsertTagsFromPicqer, updateTagType } from '@/lib/supabase/localTags'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packagings/create
 * Create packaging in Picqer + local DB + auto-tag
 * If skipPicqer=true, only create in local DB (requires idpackaging)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, barcode, length, width, height, skipPicqer, idpackaging: manualIdpackaging } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      )
    }

    // ── Skip Picqer mode: only insert locally ──────────────────────────
    if (skipPicqer) {
      // Use provided ID or generate a temporary placeholder (negative timestamp)
      const resolvedId = (manualIdpackaging && typeof manualIdpackaging === 'number')
        ? manualIdpackaging
        : -Math.floor(Date.now() / 1000)

      const localPackaging = await insertLocalPackaging({
        idpackaging: resolvedId,
        name: name.trim(),
        barcode: barcode || null,
        length: length || null,
        width: width || null,
        height: height || null,
        use_in_auto_advice: false,
        active: true,
      })

      return NextResponse.json({
        packaging: localPackaging,
        tag: null,
        skippedPicqer: true,
      })
    }

    // ── Normal mode: create in Picqer + local DB ───────────────────────

    // 1. Determine next tag number
    const allTags = await getLocalTags()
    let maxNum = 0
    for (const tag of allTags) {
      const match = tag.title.match(/^(\d+)\./)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    const nextNum = maxNum + 1

    // 2. Create packaging in Picqer
    const picqerPackaging = await picqerCreatePackaging({
      name: name.trim(),
      barcode: barcode || undefined,
      length: length || undefined,
      width: width || undefined,
      height: height || undefined,
    })

    // 3. Create tag in Picqer (blue color, pattern: "{nummer}. {naam}")
    const tagTitle = `${nextNum}. ${name.trim()}`
    const picqerTag = await createTag(tagTitle, '#0000f0', false)

    // 4. Save packaging to local DB with tag info
    const localPackaging = await insertLocalPackaging({
      idpackaging: picqerPackaging.idpackaging,
      name: picqerPackaging.name,
      barcode: picqerPackaging.barcode,
      length: picqerPackaging.length,
      width: picqerPackaging.width,
      height: picqerPackaging.height,
      use_in_auto_advice: picqerPackaging.use_in_auto_advice,
      active: picqerPackaging.active,
    })

    // 5. Store tag name + id directly on the packaging
    await updateLocalPackaging(picqerPackaging.idpackaging, {
      picqer_tag_name: picqerTag.title,
      picqer_tag_id: picqerTag.idtag,
    } as Parameters<typeof updateLocalPackaging>[1])

    // 6. Save tag to local tags DB
    await upsertTagsFromPicqer([{
      idtag: picqerTag.idtag,
      title: picqerTag.title,
      color: picqerTag.color,
      textColor: picqerTag.textColor,
      inherit: picqerTag.inherit,
    }])

    // Set the new tag as packaging type
    await updateTagType(picqerTag.idtag, 'packaging')

    return NextResponse.json({
      packaging: localPackaging,
      tag: {
        idtag: picqerTag.idtag,
        title: picqerTag.title,
        color: picqerTag.color,
      },
    })
  } catch (error) {
    console.error('[verpakking] Error creating packaging:', error)
    return NextResponse.json(
      { error: 'Failed to create packaging', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

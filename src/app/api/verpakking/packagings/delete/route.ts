import { NextRequest, NextResponse } from 'next/server'
import { deleteTag, deactivatePackaging } from '@/lib/picqer/client'
import { deleteLocalPackaging } from '@/lib/supabase/localPackagings'
import { deleteLocalTag } from '@/lib/supabase/localTags'
import { getLocalTags } from '@/lib/supabase/localTags'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packagings/delete
 * Delete packaging: deactivate in Picqer, delete tag from Picqer, remove local data
 *
 * Body: { idpackaging: number, transferToIdpackaging?: number }
 * If compartment_rules exist for this packaging and transferToIdpackaging is provided,
 * rules are transferred before deletion. If not provided, returns has_rules: true.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { idpackaging, transferToIdpackaging } = body

    if (!idpackaging || typeof idpackaging !== 'number') {
      return NextResponse.json(
        { error: 'Missing required field: idpackaging (number)' },
        { status: 400 }
      )
    }

    const errors: string[] = []

    // 0. Get the packaging's UUID (id) for FK lookups
    const { data: packaging } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('id, picqer_tag_name, picqer_tag_id')
      .eq('idpackaging', idpackaging)
      .single()

    if (!packaging) {
      return NextResponse.json({ error: 'Packaging not found' }, { status: 404 })
    }

    // 1. Check for compartment rules referencing this packaging
    const { data: rules } = await supabase
      .schema('batchmaker')
      .from('compartment_rules')
      .select('id')
      .eq('packaging_id', packaging.id)

    const ruleCount = rules?.length ?? 0

    if (ruleCount > 0) {
      if (!transferToIdpackaging) {
        // Return early — UI should show transfer dialog
        return NextResponse.json({
          error: 'has_rules',
          ruleCount,
          message: `Deze verpakking heeft ${ruleCount} doosregel(s). Kies een verpakking om ze naar over te zetten.`,
        }, { status: 409 })
      }

      // Get target packaging UUID
      const { data: targetPkg } = await supabase
        .schema('batchmaker')
        .from('packagings')
        .select('id')
        .eq('idpackaging', transferToIdpackaging)
        .single()

      if (!targetPkg) {
        return NextResponse.json({ error: 'Target packaging not found' }, { status: 404 })
      }

      // Transfer all compartment_rules + box_capacities to target packaging
      const { error: transferError } = await supabase
        .schema('batchmaker')
        .from('compartment_rules')
        .update({ packaging_id: targetPkg.id })
        .eq('packaging_id', packaging.id)

      if (transferError) {
        console.error('[verpakking] Error transferring compartment rules:', transferError)
        return NextResponse.json({
          error: 'Failed to transfer compartment rules',
          details: transferError.message,
        }, { status: 500 })
      }

      // Also transfer box_capacities if they exist
      await supabase
        .schema('batchmaker')
        .from('box_capacities')
        .update({ packaging_id: targetPkg.id })
        .eq('packaging_id', packaging.id)
    }

    // 2. If tag exists, delete it from Picqer + local
    let deletedTagTitle: string | null = null
    if (packaging?.picqer_tag_name) {
      const allTags = await getLocalTags()
      const localTag = allTags.find((t) => t.title === packaging.picqer_tag_name)

      if (localTag) {
        try {
          await deleteTag(localTag.idtag)
          deletedTagTitle = localTag.title
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          console.warn(`[verpakking] Failed to delete tag from Picqer: ${msg}`)
          errors.push(`Tag kon niet uit Picqer verwijderd worden: ${msg}`)
        }

        // Delete local tag
        try {
          await deleteLocalTag(localTag.idtag)
        } catch (err) {
          console.warn('[verpakking] Failed to delete local tag:', err)
        }
      }
    }

    // 3. Deactivate packaging in Picqer (skip for local-only packagings with negative IDs)
    if (idpackaging > 0) {
      try {
        await deactivatePackaging(idpackaging)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.warn(`[verpakking] Failed to deactivate packaging in Picqer: ${msg}`)
        errors.push(`Verpakking kon niet gedeactiveerd worden in Picqer: ${msg}`)
      }
    }

    // 4. Delete local packaging
    await deleteLocalPackaging(idpackaging)

    return NextResponse.json({
      success: true,
      deletedTagTitle,
      deactivatedPackaging: idpackaging,
      rulesTransferred: ruleCount > 0 ? ruleCount : undefined,
      warnings: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[verpakking] Error deleting packaging:', error)
    return NextResponse.json(
      { error: 'Failed to delete packaging', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

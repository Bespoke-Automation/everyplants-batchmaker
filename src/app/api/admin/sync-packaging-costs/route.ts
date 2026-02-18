import { NextResponse } from 'next/server'
import { syncPackagingCosts } from '@/lib/supabase/syncPackagingCosts'

export async function POST() {
  try {
    // Sync material_cost vanuit facturatie.boxes → batchmaker.packagings
    // Na de sync gebruikt rankPackagings() in de engine automatisch de juiste kosten
    // bij gelijke specificity en volume (specifiekst → kleinst → goedkoopst)
    const costSync = await syncPackagingCosts()

    return NextResponse.json({
      success: true,
      summary: {
        updated: costSync.updated.length,
        skipped: costSync.skipped.length,
        errors: costSync.errors.length,
      },
      details: costSync,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

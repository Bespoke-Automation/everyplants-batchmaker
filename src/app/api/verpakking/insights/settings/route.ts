import { NextRequest, NextResponse } from 'next/server'
import {
  listEngineSettingRows,
  updateEngineSetting,
  type EngineSettings,
} from '@/lib/engine/engineSettings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/settings
 * Returns all runtime-configurable engine settings with metadata for the UI.
 */
export async function GET() {
  try {
    const rows = await listEngineSettingRows()
    return NextResponse.json({ rows })
  } catch (error) {
    console.error('[insights/settings] GET error:', error)
    return NextResponse.json(
      {
        error: 'Instellingen ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}

/**
 * PUT /api/verpakking/insights/settings
 * Body: { key: <setting key>, value: number }
 * Updates one setting. Validation errors return 400.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const key = body.key as keyof EngineSettings | undefined
    const value = body.value as number | undefined

    if (!key || typeof value !== 'number') {
      return NextResponse.json(
        { error: 'key en numerieke value zijn verplicht' },
        { status: 400 },
      )
    }

    try {
      await updateEngineSetting(key, value)
    } catch (validationError) {
      // updateEngineSetting throws Error on validation issues
      return NextResponse.json(
        {
          error:
            validationError instanceof Error
              ? validationError.message
              : 'Validatie mislukt',
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true, key, value })
  } catch (error) {
    console.error('[insights/settings] PUT error:', error)
    return NextResponse.json(
      {
        error: 'Instelling bijwerken mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}

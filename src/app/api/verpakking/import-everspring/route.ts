import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { classifyAllProducts } from '@/lib/supabase/productAttributes'

export const dynamic = 'force-dynamic'

// Everspring Packaging_id → Batchmaker packaging name
const ES_TO_BM_NAME: Record<string, string> = {
  '889': 'C - Kokerdoos 2x P12',
  '890': 'C - Orchidee doos',
  '891': 'C - Kokerdoos P15',
  '892': 'C - Vouwdoos 180cm',
  '893': 'C - Vouwdoos 160cm',
  '894': 'C - Vouwdoos 130cm',
  '895': 'C - Vouwdoos 100cm',
  '896': 'C - Kokerdoos 130cm breed',
  '897': 'C - Kokerdoos 130cm smal',
  '898': 'C - HEU',
  '899': 'C - Open Doos',
  '900': 'C - EUP',
  '911': 'C - Eurodoos 60',
  '912': 'C - Eurodoos 40',
  '920': 'C - Vouwdoos 100cm', // Kokerdoos 100cm = Vouwdoos 100cm
  '921': 'C - Surprise box',
  '922': 'C - 2x Surprise box',
  '926': 'C - 2x Kokerdoos 100cm (1 verzendlabel)',
  '933': 'C - Oppotten P81 - P100',
  '1053': 'C - Kokerdoos 60',
  '1110': 'Sale box 170cm',
  '1113': 'C - Oppotten P66 - P80',
  '1162': 'C - Open Doos', // Open doos medium → Open Doos
  '1178': 'C - Envelop',
  '1180': 'C - Eurodoos 40 met 3 trays',
}

// Z-OUD + Express IDs to skip
const SKIP_IDS = new Set([
  '95', // Standaard verpakking (generic, skip)
  '194', '703', '704', '923', '924', '925',
  '972', '973', '974', '1049', '1050', '1051', '1052',
  '679', '680', '681', '682', '683', '684', '685', '686',
  '1122', // No box
])

/**
 * POST /api/verpakking/import-everspring
 * Import default packaging from Everspring CSV export.
 * Body: raw CSV text (Content-Type: text/csv)
 */
export async function POST(request: Request) {
  try {
    const csvText = await request.text()
    if (!csvText.trim()) {
      return NextResponse.json({ error: 'Lege CSV' }, { status: 400 })
    }

    // Parse CSV (semicolon-delimited, quoted fields)
    const lines = csvText.split('\n')
    const header = parseCSVLine(lines[0])

    const skuIdx = header.indexOf('SKU')
    const pkgIdx = header.indexOf('Packaging_id')
    const statusIdx = header.indexOf('Variant_status')
    const potSizeIdx = header.indexOf('Pot_size')
    const heightIdx = header.indexOf('Size_y')
    const weightIdx = header.indexOf('Weight')
    const titleIdx = header.indexOf('Title_NL')
    const typeIdx = header.indexOf('Type')

    if (skuIdx === -1 || pkgIdx === -1) {
      return NextResponse.json(
        { error: 'CSV mist verplichte kolommen: SKU, Packaging_id' },
        { status: 400 }
      )
    }

    // Fetch batchmaker packagings name → id
    const { data: bmPackagings, error: bmError } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('id, name')
      .eq('active', true)

    if (bmError || !bmPackagings) {
      return NextResponse.json({ error: 'Kan batchmaker verpakkingen niet ophalen' }, { status: 500 })
    }

    const bmNameToId = new Map<string, string>()
    for (const p of bmPackagings) {
      bmNameToId.set(p.name, p.id)
    }

    // Build ES packaging_id → BM packaging UUID mapping
    const esToBmId = new Map<string, string>()
    for (const [esId, bmName] of Object.entries(ES_TO_BM_NAME)) {
      const bmId = bmNameToId.get(bmName)
      if (bmId) {
        esToBmId.set(esId, bmId)
      } else {
        console.warn(`[import-everspring] BM packaging "${bmName}" not found for ES ${esId}`)
      }
    }

    // Process rows
    let skippedZoud = 0
    let skippedNoPackaging = 0
    let skippedInactive = 0
    const unmappedPkgIds = new Set<string>()
    const updates: { sku: string; title: string; productType: string; bmPackagingId: string | null; potSize: number | null; height: number | null; weight: number | null }[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const fields = parseCSVLine(line)
      const sku = fields[skuIdx]?.trim()
      const pkgId = fields[pkgIdx]?.trim()
      const status = statusIdx >= 0 ? fields[statusIdx]?.trim() : ''
      const title = titleIdx >= 0 ? fields[titleIdx]?.trim() : ''
      const esType = typeIdx >= 0 ? fields[typeIdx]?.trim() : ''

      if (!sku) continue

      // Skip inactive products
      if (status === 'INACTIVE') {
        skippedInactive++
        continue
      }

      // Skip Z-OUD and Express
      if (pkgId && SKIP_IDS.has(pkgId)) {
        skippedZoud++
        continue
      }


      // Parse dimensions from Everspring
      const rawPot = potSizeIdx >= 0 ? fields[potSizeIdx]?.trim().replace(',', '.') : ''
      const rawHeight = heightIdx >= 0 ? fields[heightIdx]?.trim().replace(',', '.') : ''
      const rawWeight = weightIdx >= 0 ? fields[weightIdx]?.trim().replace(',', '.') : ''

      const potSize = rawPot && parseFloat(rawPot) > 0 ? parseFloat(rawPot) : null
      const height = rawHeight && parseFloat(rawHeight) > 0 ? parseFloat(rawHeight) : null
      const weight = rawWeight && parseFloat(rawWeight) > 0 ? parseFloat(rawWeight) : null

      // Resolve packaging (may be null if no pkgId or unmapped)
      let bmId: string | null = null
      if (pkgId) {
        bmId = esToBmId.get(pkgId) ?? null
        if (!bmId && !SKIP_IDS.has(pkgId)) {
          unmappedPkgIds.add(pkgId)
        }
      } else {
        skippedNoPackaging++
      }

      // Include product if it has packaging OR dimension data to enrich
      if (bmId || potSize || height || weight) {
        updates.push({ sku, title, productType: esType || 'Onbekend', bmPackagingId: bmId, potSize, height, weight })
      }
    }

    // Bulk upsert — update existing products, create missing ones
    let matched = 0
    let created = 0
    let updatedPackaging = 0
    let enrichedDimensions = 0
    const enrichedIds: string[] = []

    for (let i = 0; i < updates.length; i += 50) {
      const batch = updates.slice(i, i + 50)

      for (const { sku, title, productType, bmPackagingId, potSize, height, weight } of batch) {
        // Build update payload — only include non-null fields
        const updateFields: Record<string, unknown> = {}
        if (bmPackagingId) updateFields.default_packaging_id = bmPackagingId
        if (potSize !== null) updateFields.pot_size = potSize
        if (height !== null) updateFields.height = height
        if (weight !== null) updateFields.weight = weight

        if (Object.keys(updateFields).length === 0) continue

        // Try update first
        const { data, error: updateError } = await supabase
          .schema('batchmaker')
          .from('product_attributes')
          .update(updateFields)
          .eq('productcode', sku)
          .select('id')

        if (updateError) {
          console.error(`[import-everspring] Update error for ${sku}:`, updateError.message)
          continue
        }

        if (data && data.length > 0) {
          // Existing product updated
          matched++
          if (bmPackagingId) updatedPackaging++
          if (potSize !== null || height !== null) {
            enrichedDimensions++
            enrichedIds.push(data[0].id)
          }
        } else {
          // Product not in product_attributes — create it
          const { data: inserted, error: insertError } = await supabase
            .schema('batchmaker')
            .from('product_attributes')
            .insert({
              productcode: sku,
              product_name: title || sku,
              product_type: productType,
              picqer_product_id: 0, // Will be resolved on next Picqer sync or engine on-demand
              is_composition: false,
              classification_status: 'unclassified',
              ...updateFields,
            })
            .select('id')

          if (insertError) {
            console.error(`[import-everspring] Insert error for ${sku}:`, insertError.message)
            continue
          }

          created++
          if (bmPackagingId) updatedPackaging++
          if (inserted && inserted.length > 0 && (potSize !== null || height !== null)) {
            enrichedDimensions++
            enrichedIds.push(inserted[0].id)
          }
        }
      }
    }

    // Reset classification for products with updated dimensions so they get reclassified
    let reclassified = 0
    if (enrichedIds.length > 0) {
      // Reset status to 'unclassified' in batches of 100
      for (let i = 0; i < enrichedIds.length; i += 100) {
        const batch = enrichedIds.slice(i, i + 100)
        await supabase
          .schema('batchmaker')
          .from('product_attributes')
          .update({ classification_status: 'unclassified', shipping_unit_id: null })
          .in('id', batch)
      }

      // Run classification for all unclassified products
      const classifyStats = await classifyAllProducts()
      reclassified = classifyStats.classified
      console.log(`[import-everspring] Reclassified ${reclassified} products after dimension enrichment`)
    }

    const result = {
      total_rows: lines.length - 1,
      matched,
      created,
      updated_packaging: updatedPackaging,
      enriched_dimensions: enrichedDimensions,
      reclassified,
      skipped_zoud: skippedZoud,
      skipped_no_packaging: skippedNoPackaging,
      skipped_inactive: skippedInactive,
      unmapped_packaging_ids: Array.from(unmappedPkgIds),
    }

    console.log('[import-everspring] Import complete:', JSON.stringify(result, null, 2))

    return NextResponse.json(result)
  } catch (error) {
    console.error('[import-everspring] Error:', error)
    return NextResponse.json(
      { error: 'Import mislukt', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/** Parse a semicolon-delimited CSV line with quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ';' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)

  return fields
}

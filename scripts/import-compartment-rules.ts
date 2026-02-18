/**
 * Import compartment rules from Everspring Excel into Supabase
 *
 * Usage: npx tsx scripts/import-compartment-rules.ts
 *
 * Reads: ~/Downloads/Verpakkingsmodule basis.xlsx
 * Writes: batchmaker.compartment_rules
 */

import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as os from 'os'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// ── Box name mapping: Excel name → Picqer packaging name ────────────────────
// These need to be verified with Kenny — mapping Everspring box types to Picqer packagings
const BOX_NAME_MAP: Record<string, string> = {
  'C - Vouwdoos 160cm': 'Fold box 155 - 55_919',
  'C - Vouwdoos 100cm': 'Fold box 98 - 55_921',
  'C - Open Doos': 'PL-Single-Big - 333017007',
  'C - Vouwdoos 130cm': 'PL-Single-Small - 333017006',
  'C - Vouwdoos 180cm': 'Sale box 170cm - 55_1099',
  'C - Eurodoos 60': 'PL-Multi-Big - 333017009',
  'C - Eurodoos 40': 'PL-Multi-Small - 333017008',
  'C - Surprise box': 'PL-Save me 4pcs - 333017010',
  'C - Kokerdoos 2x P12': 'PL-Save me 12pcs - 333017011',
  'C - 2x Kokerdoos 100cm (1 verzendlabel)': 'Box Single Small – doublepack strapped - 333017047',
  // Oppotten boxes — these are "pot up" services, might not have packagings.
  // We skip these for now unless they have a packaging in Picqer.
  'C - Oppotten P22 - P40': '__SKIP__',
  'C - Oppotten P41 - P65': '__SKIP__',
  'C - Oppotten P66 - P80': '__SKIP__',
  'C - Oppotten P81 - P100': '__SKIP__',
}

// ── Shipping unit name normalization ────────────────────────────────────────
// The Excel uses slightly different names in some cases
function normalizeShippingUnitName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\| ?H/, '| H')
    .replace(/\| ?P/, '| P')
    .replace(/P10,5/g, 'P10,5')
    .replace(/P10\.5/g, 'P10.5')
    .trim()
}

// ── Parse compartment rules from the horizontal column layout ───────────────

interface ParsedRule {
  boxName: string
  ruleGroup: number
  operator: string // 'EN', 'OF', 'ALTERNATIEF'
  shippingUnitName: string
  quantity: number
  sortOrder: number
}

function parseCompartmentSheet(ws: XLSX.WorkSheet): ParsedRule[] {
  const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
  })

  if (data.length === 0) return []

  const rules: ParsedRule[] = []

  // Find box headers in row 0
  // Each box occupies columns: [header, empty, empty, empty] or similar
  // The actual pattern: each box has columns like:
  //   col+0: operator/empty  col+1: shipping unit name  col+2: quantity  col+3: separator(empty)
  const headerRow = data[0]
  const boxColumns: { name: string; startCol: number }[] = []

  for (let c = 0; c < headerRow.length; c++) {
    const cell = headerRow[c]
    if (cell && typeof cell === 'string' && cell.startsWith('C - ')) {
      boxColumns.push({ name: cell.trim(), startCol: c })
    }
  }

  console.log(`\nGevonden doostypen: ${boxColumns.length}`)
  for (const box of boxColumns) {
    console.log(`  - ${box.name} (kolom ${box.startCol})`)
  }

  // Parse each box's rules
  for (const box of boxColumns) {
    const col = box.startCol
    let currentGroup = 1
    let sortOrder = 0
    let hasFirstRule = false

    for (let r = 1; r < data.length; r++) {
      const row = data[r]
      if (!row || row.length <= col) continue

      // Read cells for this box
      // Pattern: col+0 = operator or empty, col+1 = shipping unit name, col+2 = quantity
      // But for the FIRST rule in a group, the shipping unit is in col+0 and quantity in col+1
      const cell0 = row[col] != null ? String(row[col]).trim() : ''
      const cell1 = row[col + 1] != null ? String(row[col + 1]).trim() : ''
      const cell2 = row[col + 2] != null ? String(row[col + 2]).trim() : ''

      if (!cell0 && !cell1) continue // Empty row for this box

      let operator: string
      let shippingUnitName: string
      let quantityStr: string

      if (cell0 === 'EN' || cell0 === 'OF' || cell0 === 'ALTERNATIEF') {
        operator = cell0
        shippingUnitName = cell1
        quantityStr = cell2
      } else if (cell0 && !['EN', 'OF', 'ALTERNATIEF'].includes(cell0)) {
        // First rule of a new group (no operator prefix)
        operator = 'EN' // Implicit first EN
        shippingUnitName = cell0
        quantityStr = cell1

        if (hasFirstRule) {
          // This shouldn't happen often — a non-operator non-empty cell after rules have started
          // Treat as start of new group
          currentGroup++
        }
        hasFirstRule = true
      } else {
        continue
      }

      // Parse quantity (e.g., "1x", "3x", or just a number)
      let quantity = 1
      if (quantityStr) {
        const match = quantityStr.match(/(\d+)/)
        if (match) quantity = parseInt(match[1], 10)
      }

      if (!shippingUnitName) continue

      // OF starts a new rule group
      if (operator === 'OF' && hasFirstRule) {
        currentGroup++
      }

      rules.push({
        boxName: box.name,
        ruleGroup: currentGroup,
        operator,
        shippingUnitName: normalizeShippingUnitName(shippingUnitName),
        quantity,
        sortOrder: sortOrder++,
      })
    }
  }

  return rules
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = path.join(os.homedir(), 'Downloads', 'Verpakkingsmodule basis.xlsx')
  console.log(`\n📁 Lezen: ${filePath}`)

  const wb = XLSX.readFile(filePath)
  console.log(`📋 Sheets: ${wb.SheetNames.join(', ')}`)

  // Parse compartment rules
  const compartimentenSheet = wb.Sheets['Compartimenten']
  if (!compartimentenSheet) {
    console.error('❌ Sheet "Compartimenten" niet gevonden')
    process.exit(1)
  }

  const parsedRules = parseCompartmentSheet(compartimentenSheet)
  console.log(`\n📊 ${parsedRules.length} regels geparsed uit Excel`)

  // Fetch shipping units from Supabase
  const { data: shippingUnits, error: suError } = await supabase
    .schema('batchmaker')
    .from('shipping_units')
    .select('id, name')

  if (suError || !shippingUnits) {
    console.error('❌ Kan shipping units niet ophalen:', suError)
    process.exit(1)
  }

  // Build name → id map (try exact match + normalized match)
  const suNameMap = new Map<string, string>()
  for (const su of shippingUnits) {
    suNameMap.set(su.name, su.id)
    suNameMap.set(normalizeShippingUnitName(su.name), su.id)
    // Also add without "PLANT | P71 - P80 | H0 - H250" for "P71 - P80| H0 - H300" differences
    suNameMap.set(su.name.toLowerCase(), su.id)
  }

  // Fetch packagings from Supabase
  const { data: packagings, error: pkgError } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, name')

  if (pkgError || !packagings) {
    console.error('❌ Kan packagings niet ophalen:', pkgError)
    process.exit(1)
  }

  const pkgNameMap = new Map<string, string>()
  for (const pkg of packagings) {
    pkgNameMap.set(pkg.name, pkg.id)
  }

  // Resolve shipping unit names → UUIDs
  const unmatchedUnits = new Set<string>()
  const unmatchedBoxes = new Set<string>()
  let skippedOppotten = 0
  let matched = 0

  const resolvedRules: {
    packaging_id: string
    rule_group: number
    shipping_unit_id: string
    quantity: number
    operator: string
    sort_order: number
  }[] = []

  for (const rule of parsedRules) {
    // Resolve box → packaging
    const picqerBoxName = BOX_NAME_MAP[rule.boxName]
    if (!picqerBoxName) {
      unmatchedBoxes.add(rule.boxName)
      continue
    }
    if (picqerBoxName === '__SKIP__') {
      skippedOppotten++
      continue
    }

    const packagingId = pkgNameMap.get(picqerBoxName)
    if (!packagingId) {
      unmatchedBoxes.add(`${rule.boxName} → ${picqerBoxName} (niet in Supabase)`)
      continue
    }

    // Resolve shipping unit name → UUID
    let shippingUnitId = suNameMap.get(rule.shippingUnitName)

    // Try fuzzy matching if exact doesn't work
    if (!shippingUnitId) {
      shippingUnitId = suNameMap.get(normalizeShippingUnitName(rule.shippingUnitName))
    }
    if (!shippingUnitId) {
      shippingUnitId = suNameMap.get(rule.shippingUnitName.toLowerCase())
    }

    // Try partial match (e.g., "PLANT | P71 - P80| H0 - H300" vs "PLANT | P71 - P80 | H0 - H250")
    if (!shippingUnitId) {
      // Find closest match by checking if the start matches
      for (const su of shippingUnits) {
        const normalName = normalizeShippingUnitName(rule.shippingUnitName)
        const normalSu = normalizeShippingUnitName(su.name)
        // Check if product type and pot size match (ignore height range differences)
        const nameBase = normalName.split('|').slice(0, 2).join('|').trim()
        const suBase = normalSu.split('|').slice(0, 2).join('|').trim()
        if (nameBase === suBase) {
          shippingUnitId = su.id
          break
        }
      }
    }

    // Handle bare names like "P22 - P24" (missing "POT | " prefix)
    if (!shippingUnitId && !rule.shippingUnitName.includes('|')) {
      // Try with "POT | " prefix
      const withPrefix = `POT | ${rule.shippingUnitName}`
      shippingUnitId = suNameMap.get(withPrefix)
    }

    if (!shippingUnitId) {
      unmatchedUnits.add(rule.shippingUnitName)
      continue
    }

    matched++
    resolvedRules.push({
      packaging_id: packagingId,
      rule_group: rule.ruleGroup,
      shipping_unit_id: shippingUnitId,
      quantity: rule.quantity,
      operator: rule.operator,
      sort_order: rule.sortOrder,
    })
  }

  console.log(`\n═══════════════════════════════════════`)
  console.log(`        IMPORT RESULTAAT`)
  console.log(`═══════════════════════════════════════`)
  console.log(`  Totaal geparsed:    ${parsedRules.length}`)
  console.log(`  ✅ Matched:          ${matched}`)
  console.log(`  ⏭️  Oppotten (skip): ${skippedOppotten}`)

  if (unmatchedUnits.size > 0) {
    console.log(`\n  ❌ Niet-gematchte shipping units (${unmatchedUnits.size}):`)
    for (const name of unmatchedUnits) {
      console.log(`     - "${name}"`)
    }
  }

  if (unmatchedBoxes.size > 0) {
    console.log(`\n  ❌ Niet-gematchte dozen (${unmatchedBoxes.size}):`)
    for (const name of unmatchedBoxes) {
      console.log(`     - "${name}"`)
    }
  }

  if (resolvedRules.length === 0) {
    console.log('\n⚠️  Geen regels om te importeren. Controleer de mappings.')
    process.exit(0)
  }

  // Print summary per box
  const boxSummary = new Map<string, number>()
  for (const rule of resolvedRules) {
    const pkg = packagings.find((p) => p.id === rule.packaging_id)
    const key = pkg?.name ?? rule.packaging_id
    boxSummary.set(key, (boxSummary.get(key) ?? 0) + 1)
  }

  console.log(`\n  Regels per doos:`)
  for (const [name, count] of boxSummary) {
    console.log(`     ${name}: ${count} regels`)
  }

  // Ask for confirmation
  console.log(`\n🚀 Klaar om ${resolvedRules.length} regels in te voegen in batchmaker.compartment_rules`)
  console.log('   Druk Ctrl+C om te annuleren, of wacht 3 seconden...')

  await new Promise((r) => setTimeout(r, 3000))

  // Clear existing rules first
  console.log('\n🗑️  Bestaande compartment rules verwijderen...')
  const { error: deleteError } = await supabase
    .schema('batchmaker')
    .from('compartment_rules')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // delete all

  if (deleteError) {
    console.error('❌ Fout bij verwijderen:', deleteError)
    process.exit(1)
  }

  // Insert in batches of 50
  console.log(`\n📥 Invoegen van ${resolvedRules.length} regels...`)
  const batchSize = 50
  let inserted = 0

  for (let i = 0; i < resolvedRules.length; i += batchSize) {
    const batch = resolvedRules.slice(i, i + batchSize)
    const { error: insertError } = await supabase
      .schema('batchmaker')
      .from('compartment_rules')
      .insert(batch)

    if (insertError) {
      console.error(`❌ Fout bij batch ${Math.floor(i / batchSize) + 1}:`, insertError)
      // Continue with next batch
    } else {
      inserted += batch.length
    }
  }

  console.log(`\n✅ ${inserted}/${resolvedRules.length} compartment rules ingevoegd!`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

/**
 * Everspring → Picqer Import Script
 *
 * Leest de Everspring product export (.xlsx) en vult de Picqer custom product fields:
 * - Potmaat (cm)
 * - Planthoogte (cm)
 * - Producttype
 * - Breekbaar
 * - Mixable
 *
 * Usage:
 *   npx tsx scripts/import-everspring.ts <path-to-xlsx>              # Dry run (geen wijzigingen)
 *   npx tsx scripts/import-everspring.ts <path-to-xlsx> --execute    # Echt uitvoeren
 *   npx tsx scripts/import-everspring.ts <path-to-xlsx> --execute --skip=500  # Start vanaf rij 500
 */

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

// --- Configuration ---

const PICQER_SUBDOMAIN = process.env.PICQER_SUBDOMAIN!
const PICQER_API_KEY = process.env.PICQER_API_KEY!
const PICQER_BASE_URL = `https://${PICQER_SUBDOMAIN}.picqer.com/api/v1`

const FIELD_IDS = {
  potmaat: parseInt(process.env.PICQER_FIELD_POTMAAT || '5768'),
  planthoogte: parseInt(process.env.PICQER_FIELD_PLANTHOOGTE || '5769'),
  producttype: parseInt(process.env.PICQER_FIELD_PRODUCTTYPE || '5770'),
  breekbaar: parseInt(process.env.PICQER_FIELD_BREEKBAAR || '5771'),
  mixable: parseInt(process.env.PICQER_FIELD_MIXABLE || '5772'),
}

const AUTH_HEADER = `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`

// Rate limiting: max 2 requests per second
const MIN_REQUEST_INTERVAL_MS = 500
let lastRequestTime = 0

// --- Types ---

interface EverspringProduct {
  SKU: string
  Title_NL?: string
  Type?: string
  Category?: string
  Pot_size?: number
  Size_z?: number
  Smart_shipping?: string
  Variant_status?: string
  Is_deleted?: boolean | string
  Weight?: number
}

interface ImportResult {
  sku: string
  title: string
  status: 'success' | 'not_found' | 'skipped' | 'error' | 'dry_run'
  picqerProductId?: number
  productType?: string
  potmaat?: number
  hoogte?: number
  mixable?: string
  error?: string
}

// --- Everspring Type → Our Product Type Mapping ---

function mapProductType(type?: string, category?: string): string {
  if (!type) return 'Onbekend'

  switch (type) {
    case 'Plant':
      // Check if it's an artificial plant
      if (category === 'artificial_plants' || category === 'artificial_flowers') {
        return 'Kunstplant'
      }
      return 'Plant'

    case 'Pot':
      return 'Pot'

    case 'PlantPotProductCombinationProduct':
      return 'Pot+Plant'

    case 'MixAndMatchProductCombinationProduct':
      return 'Bundel'

    case 'AddOn':
    case 'Standard':
      // Accessories, care products, gift cards, etc.
      if (category === 'plants_care' || category === 'plants_care_nutrition' || category === 'plants_care_substrates') {
        return 'Accessoire'
      }
      return 'Accessoire'

    default:
      return 'Onbekend'
  }
}

// --- Picqer API Functions ---

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest))
  }
  lastRequestTime = Date.now()

  const response = await fetch(url, options)

  // Handle rate limiting (429)
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '5')
    console.log(`  ⏳ Rate limited, waiting ${retryAfter}s...`)
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
    lastRequestTime = Date.now()
    return fetch(url, options)
  }

  return response
}

async function findPicqerProduct(productcode: string): Promise<{ idproduct: number } | null> {
  const url = `${PICQER_BASE_URL}/products?productcode=${encodeURIComponent(productcode)}`
  const response = await rateLimitedFetch(url, {
    headers: {
      'Authorization': AUTH_HEADER,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Picqer GET failed: ${response.status} ${response.statusText}`)
  }

  const products = await response.json() as Array<{ idproduct: number; productcode: string }>

  // productcode filter returns exact match
  if (products.length === 0) return null
  return products[0]
}

async function updatePicqerProduct(
  idproduct: number,
  productfields: Array<{ idproductfield: number; value: string }>
): Promise<void> {
  const url = `${PICQER_BASE_URL}/products/${idproduct}`
  const response = await rateLimitedFetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': AUTH_HEADER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productfields }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Picqer PUT failed: ${response.status} ${body}`)
  }
}

// --- Main Import Logic ---

function readEverspringExport(filePath: string): EverspringProduct[] {
  console.log(`\n📂 Lezen van: ${filePath}`)

  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json<EverspringProduct>(sheet)

  console.log(`   ${data.length} producten gevonden`)
  return data
}

function filterActiveProducts(products: EverspringProduct[]): EverspringProduct[] {
  const active = products.filter(p => {
    const status = p.Variant_status?.toUpperCase()
    const isDeleted = p.Is_deleted === true || p.Is_deleted === 'True' || p.Is_deleted === 'TRUE'
    return status === 'ACTIVE' && !isDeleted
  })

  console.log(`   ${active.length} actieve producten (niet verwijderd)`)
  return active
}

function buildProductFields(product: EverspringProduct): Array<{ idproductfield: number; value: string }> {
  const productType = mapProductType(product.Type, product.Category)

  const fields: Array<{ idproductfield: number; value: string }> = []

  // Potmaat - alleen als beschikbaar
  if (product.Pot_size != null && !isNaN(product.Pot_size)) {
    fields.push({ idproductfield: FIELD_IDS.potmaat, value: String(Math.round(product.Pot_size)) })
  }

  // Planthoogte - alleen als beschikbaar
  if (product.Size_z != null && !isNaN(product.Size_z)) {
    fields.push({ idproductfield: FIELD_IDS.planthoogte, value: String(Math.round(product.Size_z)) })
  }

  // Producttype - altijd
  fields.push({ idproductfield: FIELD_IDS.producttype, value: productType })

  // Breekbaar - default Nee (niet in Everspring export)
  fields.push({ idproductfield: FIELD_IDS.breekbaar, value: 'Nee' })

  // Mixable - uit Smart_shipping
  const mixable = product.Smart_shipping === 'NOT_MIXABLE' ? 'Nee' : 'Ja'
  fields.push({ idproductfield: FIELD_IDS.mixable, value: mixable })

  return fields
}

async function importProducts(
  products: EverspringProduct[],
  execute: boolean,
  skip: number
): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  const total = products.length
  const startIndex = skip

  console.log(`\n${execute ? '🚀 EXECUTE MODE' : '🔍 DRY RUN MODE'} — ${total - startIndex} producten te verwerken\n`)

  for (let i = startIndex; i < total; i++) {
    const product = products[i]
    const sku = product.SKU != null ? String(product.SKU).trim() : ''

    if (!sku) {
      results.push({ sku: '(leeg)', title: '', status: 'skipped', error: 'Geen SKU' })
      continue
    }

    const productType = mapProductType(product.Type, product.Category)
    const progress = `[${i + 1}/${total}]`

    try {
      if (!execute) {
        // Dry run: log wat we zouden doen
        results.push({
          sku,
          title: product.Title_NL || '',
          status: 'dry_run',
          productType,
          potmaat: product.Pot_size ? Math.round(product.Pot_size) : undefined,
          hoogte: product.Size_z ? Math.round(product.Size_z) : undefined,
          mixable: product.Smart_shipping === 'NOT_MIXABLE' ? 'Nee' : 'Ja',
        })

        // Log elke 100e
        if ((i - startIndex) % 100 === 0) {
          console.log(`${progress} ${sku} → ${productType} | P${product.Pot_size || '?'} H${product.Size_z || '?'} | ${product.Smart_shipping || '?'}`)
        }
        continue
      }

      // Execute mode: zoek product in Picqer
      const picqerProduct = await findPicqerProduct(sku)

      if (!picqerProduct) {
        console.log(`${progress} ❌ ${sku} — niet gevonden in Picqer`)
        results.push({ sku, title: product.Title_NL || '', status: 'not_found' })
        continue
      }

      // Bouw custom fields
      const productfields = buildProductFields(product)

      // Update in Picqer
      await updatePicqerProduct(picqerProduct.idproduct, productfields)

      console.log(`${progress} ✅ ${sku} → ${productType} | P${product.Pot_size || '?'} H${product.Size_z || '?'}`)
      results.push({
        sku,
        title: product.Title_NL || '',
        status: 'success',
        picqerProductId: picqerProduct.idproduct,
        productType,
        potmaat: product.Pot_size ? Math.round(product.Pot_size) : undefined,
        hoogte: product.Size_z ? Math.round(product.Size_z) : undefined,
        mixable: product.Smart_shipping === 'NOT_MIXABLE' ? 'Nee' : 'Ja',
      })

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.log(`${progress} ❗ ${sku} — fout: ${errorMsg}`)
      results.push({ sku, title: product.Title_NL || '', status: 'error', error: errorMsg })
    }
  }

  return results
}

function writeReport(results: ImportResult[], outputPath: string) {
  const header = 'SKU,Title,Status,PicqerID,Producttype,Potmaat,Hoogte,Mixable,Error\n'
  const rows = results.map(r =>
    [
      r.sku,
      `"${(r.title || '').replace(/"/g, '""')}"`,
      r.status,
      r.picqerProductId || '',
      r.productType || '',
      r.potmaat ?? '',
      r.hoogte ?? '',
      r.mixable || '',
      r.error || '',
    ].join(',')
  ).join('\n')

  fs.writeFileSync(outputPath, header + rows)
  console.log(`\n📄 Rapport opgeslagen: ${outputPath}`)
}

function printSummary(results: ImportResult[]) {
  const summary = {
    total: results.length,
    success: results.filter(r => r.status === 'success').length,
    not_found: results.filter(r => r.status === 'not_found').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    error: results.filter(r => r.status === 'error').length,
    dry_run: results.filter(r => r.status === 'dry_run').length,
  }

  // Type distribution
  const typeDistribution: Record<string, number> = {}
  results.forEach(r => {
    if (r.productType) {
      typeDistribution[r.productType] = (typeDistribution[r.productType] || 0) + 1
    }
  })

  // Data coverage
  const withPotmaat = results.filter(r => r.potmaat != null).length
  const withHoogte = results.filter(r => r.hoogte != null).length
  const notMixable = results.filter(r => r.mixable === 'Nee').length

  console.log('\n══════════════════════════════════════')
  console.log('           IMPORT SAMENVATTING')
  console.log('══════════════════════════════════════')
  console.log(`  Totaal verwerkt:     ${summary.total}`)
  console.log(`  ✅ Succes:           ${summary.success}`)
  console.log(`  ❌ Niet gevonden:    ${summary.not_found}`)
  console.log(`  ⏭️  Overgeslagen:    ${summary.skipped}`)
  console.log(`  ❗ Fouten:           ${summary.error}`)
  if (summary.dry_run > 0) {
    console.log(`  🔍 Dry run:          ${summary.dry_run}`)
  }
  console.log('')
  console.log('  Producttype verdeling:')
  Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`    ${type.padEnd(15)} ${count}`)
  })
  console.log('')
  console.log(`  Data dekking:`)
  console.log(`    Met potmaat:       ${withPotmaat}/${summary.total} (${Math.round(withPotmaat / summary.total * 100)}%)`)
  console.log(`    Met hoogte:        ${withHoogte}/${summary.total} (${Math.round(withHoogte / summary.total * 100)}%)`)
  console.log(`    NOT_MIXABLE:       ${notMixable}`)
  console.log('══════════════════════════════════════\n')
}

// --- CLI Entry Point ---

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Everspring → Picqer Import Script

Usage:
  npx tsx scripts/import-everspring.ts <xlsx-bestand>              Dry run
  npx tsx scripts/import-everspring.ts <xlsx-bestand> --execute    Echt uitvoeren
  npx tsx scripts/import-everspring.ts <xlsx-bestand> --execute --skip=500  Start vanaf rij 500

Opties:
  --execute     Daadwerkelijk schrijven naar Picqer (zonder = dry run)
  --skip=N      Sla eerste N producten over (voor hervatten)
  --help        Dit helpscherm
`)
    process.exit(0)
  }

  const filePath = args.find(a => !a.startsWith('--'))
  const execute = args.includes('--execute')
  const skipArg = args.find(a => a.startsWith('--skip='))
  const skip = skipArg ? parseInt(skipArg.split('=')[1]) : 0

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`❌ Bestand niet gevonden: ${filePath}`)
    process.exit(1)
  }

  if (!PICQER_SUBDOMAIN || !PICQER_API_KEY) {
    console.error('❌ PICQER_SUBDOMAIN en PICQER_API_KEY moeten in .env.local staan')
    process.exit(1)
  }

  console.log('═══════════════════════════════════════════')
  console.log('  Everspring → Picqer Import')
  console.log('═══════════════════════════════════════════')
  console.log(`  Picqer: ${PICQER_SUBDOMAIN}.picqer.com`)
  console.log(`  Modus: ${execute ? '🚀 EXECUTE (schrijft naar Picqer!)' : '🔍 DRY RUN (geen wijzigingen)'}`)
  if (skip > 0) console.log(`  Skip: eerste ${skip} producten`)
  console.log('')

  // Read and filter
  const allProducts = readEverspringExport(filePath)
  const activeProducts = filterActiveProducts(allProducts)

  // Import
  const results = await importProducts(activeProducts, execute, skip)

  // Summary
  printSummary(results)

  // Write report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportPath = path.resolve(__dirname, `../import-report-${timestamp}.csv`)
  writeReport(results, reportPath)

  if (!execute) {
    console.log('💡 Dit was een DRY RUN. Voeg --execute toe om daadwerkelijk naar Picqer te schrijven.\n')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

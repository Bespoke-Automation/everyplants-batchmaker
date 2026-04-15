import { supabase } from '@/lib/supabase/client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedFingerprintEntry {
  productcode: string
  quantity: number
  product_name: string | null
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a V2 fingerprint like "productcode:qty|productcode:qty" and resolve
 * each productcode to a human-readable product name via the
 * batchmaker.product_attributes cache.
 *
 * Returns an array in the order of the fingerprint (which is already
 * deterministically sorted by `buildProductFingerprint`). Entries with an
 * unknown productcode get `product_name: null` — callers should fall back to
 * displaying the raw productcode.
 *
 * Robust to malformed input: skips segments that don't match `code:qty`.
 */
export async function resolveFingerprintNames(
  fingerprint: string,
): Promise<ResolvedFingerprintEntry[]> {
  const parsed = parseFingerprint(fingerprint)
  if (parsed.length === 0) return []

  const nameMap = await fetchProductNames(parsed.map((p) => p.productcode))

  return parsed.map((p) => ({
    productcode: p.productcode,
    quantity: p.quantity,
    product_name: nameMap.get(p.productcode) ?? null,
  }))
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function parseFingerprint(
  fingerprint: string,
): Array<{ productcode: string; quantity: number }> {
  if (!fingerprint) return []
  return fingerprint
    .split('|')
    .map((part) => {
      const [code, qtyStr] = part.split(':')
      const quantity = Number(qtyStr)
      if (!code || Number.isNaN(quantity)) return null
      return { productcode: code.trim(), quantity }
    })
    .filter((x): x is { productcode: string; quantity: number } => x !== null)
}

/**
 * Batch query product_attributes for productcode → product_name.
 * Chunks to stay within PostgREST URL limits.
 */
async function fetchProductNames(productcodes: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(productcodes))
  if (unique.length === 0) return new Map()

  const CHUNK_SIZE = 150
  const map = new Map<string, string>()

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('productcode, product_name')
      .in('productcode', chunk)

    if (error) {
      console.warn('[fingerprintResolver] chunk error:', error)
      continue
    }

    for (const row of data ?? []) {
      if (row.productcode && row.product_name) {
        map.set(row.productcode as string, row.product_name as string)
      }
    }
  }

  return map
}

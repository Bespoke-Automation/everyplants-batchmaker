/**
 * Quick verification that resolveStoreForRetailer works via supabase-js with the
 * publishable key. This proves the production code path is unblocked.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import { resolveStoreForRetailer, ShopifyConfigError } from '../src/lib/shopify/admin-client'

async function main() {
  console.log('Testing resolveStoreForRetailer via supabase-js (production path)...\n')
  for (const tag of ['Florafy', 'Trendyplants', 'Green Bubble']) {
    try {
      const store = await resolveStoreForRetailer(tag)
      if (store) {
        console.log(`✓ ${tag} → enabled, store=${store.storeDomain} prefix=${store.config.env_var_prefix}`)
      } else {
        console.log(`· ${tag} → disabled or not found in DB (correctly returns null)`)
      }
    } catch (e) {
      if (e instanceof ShopifyConfigError) {
        console.log(`⚠ ${tag} → ConfigError: ${e.message}`)
      } else {
        console.log(`❌ ${tag} → ${e instanceof Error ? e.message : e}`)
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })

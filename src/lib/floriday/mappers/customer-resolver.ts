// ══════════════════════════════════════════════════════════════
// Customer Resolver: Floriday Organization → Picqer Customer
// ══════════════════════════════════════════════════════════════
//
// Matching strategie:
//   1. Check floriday.customer_mapping cache
//   2. Search Picqer by org name
//   3. Als niet gevonden → maak nieuwe klant aan in Picqer
//
// Hergebruikt bestaande klanten (ook die Duxly heeft aangemaakt).

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { getOrganization } from '@/lib/floriday/client'
import { searchCustomers, createCustomer } from '@/lib/picqer/client'

interface ResolvedCustomer {
  idcustomer: number
  name: string
  isNew: boolean
}

/**
 * Resolve a Floriday organization to a Picqer customer.
 * Searches by name, creates if not found.
 */
export async function resolveCustomer(
  customerOrganizationId: string
): Promise<ResolvedCustomer> {
  // 1. Check cache
  const cached = await getCachedMapping(customerOrganizationId)
  if (cached) {
    return { idcustomer: cached.picqer_customer_id, name: cached.org_name, isNew: false }
  }

  // 2. Fetch org from Floriday
  const org = await getOrganization(customerOrganizationId)
  const orgName = org.name

  // 3. Search Picqer by name
  const customers = await searchCustomers(orgName)
  const exactMatch = customers.find(
    c => c.name.toLowerCase() === orgName.toLowerCase()
  )

  if (exactMatch) {
    // Cache and return
    await cacheMapping(customerOrganizationId, exactMatch.idcustomer, orgName, org.companyGln)
    return { idcustomer: exactMatch.idcustomer, name: exactMatch.name, isNew: false }
  }

  // 4. Niet gevonden → maak aan in Picqer
  console.log(`Klant "${orgName}" niet gevonden in Picqer, wordt aangemaakt...`)

  const newCustomer = await createCustomer({
    name: orgName,
    language: 'nl',
  })

  await cacheMapping(customerOrganizationId, newCustomer.idcustomer, orgName, org.companyGln)

  return { idcustomer: newCustomer.idcustomer, name: newCustomer.name, isNew: true }
}

async function getCachedMapping(orgId: string): Promise<{
  picqer_customer_id: number
  org_name: string
} | null> {
  const env = getFloridayEnv()
  const { data } = await supabase
    .schema('floriday')
    .from('customer_mapping')
    .select('picqer_customer_id, floriday_organization_name')
    .eq('floriday_organization_id', orgId)
    .eq('environment', env)
    .single()

  if (!data) return null

  return {
    picqer_customer_id: data.picqer_customer_id,
    org_name: data.floriday_organization_name || '',
  }
}

async function cacheMapping(
  orgId: string,
  picqerCustomerId: number,
  orgName: string,
  gln?: string
): Promise<void> {
  const env = getFloridayEnv()
  const { error } = await supabase
    .schema('floriday')
    .from('customer_mapping')
    .upsert(
      {
        floriday_organization_id: orgId,
        environment: env,
        floriday_organization_name: orgName,
        floriday_gln: gln || null,
        picqer_customer_id: picqerCustomerId,
        picqer_customer_name: orgName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'floriday_organization_id,environment' }
    )

  if (error) {
    console.error('Error caching customer mapping:', error)
  }
}

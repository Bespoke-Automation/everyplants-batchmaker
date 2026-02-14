import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompartmentRuleRow {
  id: string
  packaging_id: string
  rule_group: number
  shipping_unit_id: string
  quantity: number
  operator: string // 'EN', 'OF', 'ALTERNATIEF'
  alternative_for_id: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined fields
  shipping_unit_name?: string
  packaging_name?: string
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Get all compartment rules, optionally filtered by packaging_id
 * Joins with shipping_units and packagings to get names
 */
export async function getCompartmentRules(packagingId?: string): Promise<CompartmentRuleRow[]> {
  let query = supabase
    .schema('batchmaker')
    .from('compartment_rules')
    .select(`
      *,
      shipping_units!compartment_rules_shipping_unit_id_fkey ( name ),
      packagings!compartment_rules_packaging_id_fkey ( name )
    `)
    .order('rule_group', { ascending: true })
    .order('sort_order', { ascending: true })

  if (packagingId) {
    query = query.eq('packaging_id', packagingId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching compartment rules:', error)
    throw error
  }

  // Flatten the joined data
  return (data || []).map((row: Record<string, unknown>) => {
    const shippingUnit = row.shipping_units as { name: string } | null
    const packaging = row.packagings as { name: string } | null
    return {
      id: row.id as string,
      packaging_id: row.packaging_id as string,
      rule_group: row.rule_group as number,
      shipping_unit_id: row.shipping_unit_id as string,
      quantity: row.quantity as number,
      operator: row.operator as string,
      alternative_for_id: row.alternative_for_id as string | null,
      sort_order: row.sort_order as number,
      is_active: row.is_active as boolean,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      shipping_unit_name: shippingUnit?.name ?? undefined,
      packaging_name: packaging?.name ?? undefined,
    }
  })
}

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new compartment rule
 */
export async function createCompartmentRule(input: {
  packaging_id: string
  rule_group: number
  shipping_unit_id: string
  quantity?: number
  operator?: string
  alternative_for_id?: string | null
  sort_order?: number
}): Promise<CompartmentRuleRow> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('compartment_rules')
    .insert({
      packaging_id: input.packaging_id,
      rule_group: input.rule_group,
      shipping_unit_id: input.shipping_unit_id,
      quantity: input.quantity ?? 1,
      operator: input.operator ?? 'EN',
      alternative_for_id: input.alternative_for_id ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select(`
      *,
      shipping_units!compartment_rules_shipping_unit_id_fkey ( name ),
      packagings!compartment_rules_packaging_id_fkey ( name )
    `)
    .single()

  if (error) {
    console.error('Error creating compartment rule:', error)
    throw error
  }

  const shippingUnit = (data as Record<string, unknown>).shipping_units as { name: string } | null
  const packaging = (data as Record<string, unknown>).packagings as { name: string } | null

  return {
    ...data,
    shipping_unit_name: shippingUnit?.name ?? undefined,
    packaging_name: packaging?.name ?? undefined,
  } as CompartmentRuleRow
}

// ── Update ───────────────────────────────────────────────────────────────────

/**
 * Update an existing compartment rule
 */
export async function updateCompartmentRule(
  id: string,
  updates: Partial<Pick<CompartmentRuleRow, 'quantity' | 'operator' | 'is_active' | 'sort_order' | 'shipping_unit_id' | 'alternative_for_id'>>
): Promise<CompartmentRuleRow> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('compartment_rules')
    .update(updates)
    .eq('id', id)
    .select(`
      *,
      shipping_units!compartment_rules_shipping_unit_id_fkey ( name ),
      packagings!compartment_rules_packaging_id_fkey ( name )
    `)
    .single()

  if (error) {
    console.error('Error updating compartment rule:', error)
    throw error
  }

  const shippingUnit = (data as Record<string, unknown>).shipping_units as { name: string } | null
  const packaging = (data as Record<string, unknown>).packagings as { name: string } | null

  return {
    ...data,
    shipping_unit_name: shippingUnit?.name ?? undefined,
    packaging_name: packaging?.name ?? undefined,
  } as CompartmentRuleRow
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a compartment rule
 */
export async function deleteCompartmentRule(id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('compartment_rules')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting compartment rule:', error)
    throw error
  }
}

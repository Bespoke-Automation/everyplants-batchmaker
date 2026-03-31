import { supabase } from './client'

export interface BuitenplantenAdjustment {
  id: string
  product_id: number
  location: string
  voorraad_bb: number
  single_orders: number
  work_date: string
  created_at: string
  updated_at: string
}

export async function getAdjustments(date?: string): Promise<BuitenplantenAdjustment[]> {
  const workDate = date || new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('buitenplanten_adjustments')
    .select('*')
    .eq('work_date', workDate)

  if (error) throw error
  return data || []
}

export async function upsertAdjustment(
  product_id: number,
  location: string,
  voorraad_bb: number,
  single_orders: number
): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('buitenplanten_adjustments')
    .upsert(
      { product_id, location, voorraad_bb, single_orders, work_date: new Date().toISOString().slice(0, 10) },
      { onConflict: 'product_id,location,work_date' }
    )

  if (error) throw error
}

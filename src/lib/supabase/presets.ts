import { supabase } from './client'
import type { Preset } from '@/types/preset'

export type PresetType = 'batch' | 'single_order'

const getTableName = (type: PresetType) =>
  type === 'batch' ? 'batch_presets' : 'single_order_presets'

export async function getPresets(type: PresetType): Promise<Preset[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from(getTableName(type))
    .select('id, naam, retailer, tags, bezorgland, leverdag, pps, postal_regions')
    .order('created_at', { ascending: true })

  if (error) {
    console.error(`Error fetching ${type} presets:`, error)
    throw error
  }

  return data || []
}

export async function createPreset(
  type: PresetType,
  preset: Omit<Preset, 'id'>
): Promise<Preset> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from(getTableName(type))
    .insert({
      naam: preset.naam,
      retailer: preset.retailer,
      tags: preset.tags,
      bezorgland: preset.bezorgland,
      leverdag: preset.leverdag,
      pps: preset.pps,
      postal_regions: preset.postal_regions || [],
    })
    .select('id, naam, retailer, tags, bezorgland, leverdag, pps, postal_regions')
    .single()

  if (error) {
    console.error(`Error creating ${type} preset:`, error)
    throw error
  }

  return data
}

export async function updatePreset(
  type: PresetType,
  id: string,
  preset: Partial<Omit<Preset, 'id'>>
): Promise<Preset> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from(getTableName(type))
    .update({
      ...(preset.naam !== undefined && { naam: preset.naam }),
      ...(preset.retailer !== undefined && { retailer: preset.retailer }),
      ...(preset.tags !== undefined && { tags: preset.tags }),
      ...(preset.bezorgland !== undefined && { bezorgland: preset.bezorgland }),
      ...(preset.leverdag !== undefined && { leverdag: preset.leverdag }),
      ...(preset.pps !== undefined && { pps: preset.pps }),
      ...(preset.postal_regions !== undefined && { postal_regions: preset.postal_regions }),
    })
    .eq('id', id)
    .select('id, naam, retailer, tags, bezorgland, leverdag, pps, postal_regions')
    .single()

  if (error) {
    console.error(`Error updating ${type} preset:`, error)
    throw error
  }

  return data
}

export async function deletePreset(type: PresetType, id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from(getTableName(type))
    .delete()
    .eq('id', id)

  if (error) {
    console.error(`Error deleting ${type} preset:`, error)
    throw error
  }
}

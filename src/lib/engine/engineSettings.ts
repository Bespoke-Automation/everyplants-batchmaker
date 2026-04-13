/**
 * Engine settings store — runtime-configurable thresholds for the packaging
 * engine, backed by batchmaker.engine_settings. Reads are cached in-memory
 * for CACHE_TTL_MS to avoid hammering Supabase on every pattern write.
 *
 * All writes invalidate the cache immediately so a setting change in the UI
 * is reflected within one event loop tick.
 */

import { supabase } from '@/lib/supabase/client'

export interface EngineSettings {
  invalidation_override_ratio: number
  invalidation_min_observations: number
  promotion_threshold: number
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  invalidation_override_ratio: 0.5,
  invalidation_min_observations: 6,
  promotion_threshold: 3,
}

export interface EngineSettingRow {
  key: keyof EngineSettings
  value: number
  description: string | null
  updated_at: string
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  settings: EngineSettings
  fetchedAt: number
}

let cache: CacheEntry | null = null

/**
 * Read the current engine settings. Returns cached values when fresh,
 * falls back to hardcoded defaults if the DB is unreachable.
 */
export async function getEngineSettings(): Promise<EngineSettings> {
  const now = Date.now()
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.settings
  }

  try {
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('engine_settings')
      .select('key, value')

    if (error) throw error

    const settings: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS }
    for (const row of data ?? []) {
      const key = row.key as keyof EngineSettings
      if (key in DEFAULT_ENGINE_SETTINGS && typeof row.value === 'number') {
        settings[key] = row.value
      }
    }

    cache = { settings, fetchedAt: now }
    return settings
  } catch (err) {
    console.error('[engineSettings] Failed to load, using defaults:', err)
    return DEFAULT_ENGINE_SETTINGS
  }
}

/**
 * Read all setting rows including metadata, for the settings UI.
 */
export async function listEngineSettingRows(): Promise<EngineSettingRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('engine_settings')
    .select('key, value, description, updated_at')
    .order('key', { ascending: true })

  if (error) throw error
  return (data ?? []).map((r) => ({
    key: r.key as keyof EngineSettings,
    value: typeof r.value === 'number' ? r.value : Number(r.value),
    description: r.description as string | null,
    updated_at: r.updated_at as string,
  }))
}

/**
 * Update a single engine setting. Validates that the key is a known setting
 * and the value is within sensible bounds. Invalidates the cache on success.
 */
export async function updateEngineSetting(
  key: keyof EngineSettings,
  value: number,
): Promise<void> {
  if (!(key in DEFAULT_ENGINE_SETTINGS)) {
    throw new Error(`Unknown engine setting: ${key}`)
  }

  // Basic validation — these ranges prevent nonsensical configs that would
  // break the pattern learning math (e.g. a ratio > 1 or a threshold < 1).
  if (key === 'invalidation_override_ratio') {
    if (value < 0 || value > 1) {
      throw new Error('invalidation_override_ratio must be between 0 and 1')
    }
  } else if (key === 'invalidation_min_observations' || key === 'promotion_threshold') {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${key} must be a positive integer`)
    }
  }

  const { error } = await supabase
    .schema('batchmaker')
    .from('engine_settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)

  if (error) throw error

  // Invalidate cache — next read will fetch fresh from DB
  cache = null
}

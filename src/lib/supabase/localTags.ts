import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LocalTagRow {
  id: string
  idtag: number
  title: string
  color: string | null
  text_color: string | null
  inherit: boolean
  tag_type: 'packaging' | 'plantura' | 'other'
  is_active: boolean
  last_synced_at: string
  created_at: string
  updated_at: string
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Get all local tags, sorted by title
 */
export async function getLocalTags(): Promise<LocalTagRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('tags')
    .select()
    .order('title', { ascending: true })

  if (error) {
    console.error('Error fetching local tags:', error)
    throw error
  }

  return data || []
}

/**
 * Get tags filtered by type
 */
export async function getTagsByType(tagType: string): Promise<LocalTagRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('tags')
    .select()
    .eq('tag_type', tagType)
    .order('title', { ascending: true })

  if (error) {
    console.error('Error fetching tags by type:', error)
    throw error
  }

  return data || []
}

// ── Sync operations ──────────────────────────────────────────────────────────

/**
 * Upsert tags from Picqer into local DB.
 * Preserves existing tag_type and is_active values.
 */
export async function upsertTagsFromPicqer(
  tags: Array<{ idtag: number; title: string; color: string; textColor: string; inherit: boolean }>
): Promise<{ added: number; updated: number }> {
  if (tags.length === 0) return { added: 0, updated: 0 }

  // Fetch existing tags to preserve tag_type and is_active
  const { data: existing } = await supabase
    .schema('batchmaker')
    .from('tags')
    .select('idtag, tag_type, is_active')

  const existingMap = new Map(
    (existing || []).map((t: { idtag: number; tag_type: string; is_active: boolean }) => [t.idtag, t])
  )

  const rows = tags.map((tag) => {
    const prev = existingMap.get(tag.idtag)
    return {
      idtag: tag.idtag,
      title: tag.title,
      color: tag.color,
      text_color: tag.textColor,
      inherit: tag.inherit,
      // Preserve existing classifications
      tag_type: prev?.tag_type ?? 'other',
      is_active: prev?.is_active ?? true,
      last_synced_at: new Date().toISOString(),
    }
  })

  const existingCount = existingMap.size
  const { error } = await supabase
    .schema('batchmaker')
    .from('tags')
    .upsert(rows, { onConflict: 'idtag' })

  if (error) {
    console.error('Error upserting tags:', error)
    throw error
  }

  // Count new tags
  const newIds = tags.filter((t) => !existingMap.has(t.idtag))
  return {
    added: newIds.length,
    updated: existingCount > 0 ? tags.length - newIds.length : 0,
  }
}

// ── Update operations ────────────────────────────────────────────────────────

/**
 * Update tag type classification
 */
export async function updateTagType(
  idtag: number,
  tagType: 'packaging' | 'plantura' | 'other'
): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('tags')
    .update({ tag_type: tagType })
    .eq('idtag', idtag)

  if (error) {
    console.error('Error updating tag type:', error)
    throw error
  }
}

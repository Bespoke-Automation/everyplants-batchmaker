import { supabase } from './client'

interface LogEntry {
  user_id?: string
  user_email?: string
  user_name?: string
  action: string
  module: 'batchmaker' | 'verpakkingsmodule' | 'floriday' | 'admin'
  description?: string
  metadata?: Record<string, unknown>
}

export async function logActivity(entry: LogEntry): Promise<void> {
  try {
    await supabase
      .schema('batchmaker')
      .from('activity_log')
      .insert({
        user_id: entry.user_id || null,
        user_email: entry.user_email || null,
        user_name: entry.user_name || null,
        action: entry.action,
        module: entry.module,
        description: entry.description || null,
        metadata: entry.metadata || {},
      })
  } catch (error) {
    console.error('[activity_log] Failed to log activity:', error)
  }
}

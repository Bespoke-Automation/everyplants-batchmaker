'use client'

import { useState, useRef, useCallback } from 'react'
import { Settings, CheckCircle2, Trash2, Loader2 } from 'lucide-react'
import { Preset } from '@/types/preset'
import { PostalRegion } from '@/lib/supabase/postalRegions'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface PresetsPanelProps {
  presets: Preset[]
  onApplyPreset: (preset: Preset) => void
  onDeletePreset?: (id: string) => Promise<void>
  isLoading?: boolean
  postalRegions?: PostalRegion[]
}

interface Column {
  key: string
  label: string
  minWidth: number
  initialWidth: number
}

const COLUMNS: Column[] = [
  { key: 'naam', label: 'Naam', minWidth: 100, initialWidth: 150 },
  { key: 'retailer', label: 'Retailer', minWidth: 100, initialWidth: 150 },
  { key: 'tags', label: 'Tags', minWidth: 120, initialWidth: 180 },
  { key: 'bezorgland', label: 'Bezorgland', minWidth: 70, initialWidth: 80 },
  { key: 'regio', label: 'Regio', minWidth: 80, initialWidth: 100 },
  { key: 'leverdag', label: 'Leverdag', minWidth: 70, initialWidth: 80 },
  { key: 'pps', label: 'Pps', minWidth: 40, initialWidth: 50 },
]

export default function PresetsPanel({ presets, onApplyPreset, onDeletePreset, isLoading, postalRegions = [] }: PresetsPanelProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: col.initialWidth }), {})
  )
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const selectedPreset = presets.find(p => p.id === selectedPresetId)

  const handleApply = () => {
    if (selectedPreset) {
      onApplyPreset(selectedPreset)
    }
  }

  const handleDeleteClick = () => {
    if (selectedPreset && onDeletePreset) {
      setIsConfirmDialogOpen(true)
    }
  }

  const handleConfirmDelete = async () => {
    if (selectedPreset && onDeletePreset) {
      setIsDeleting(true)
      try {
        await onDeletePreset(selectedPreset.id)
        setSelectedPresetId(null)
        setIsConfirmDialogOpen(false)
      } catch (error) {
        console.error('Failed to delete preset:', error)
      } finally {
        setIsDeleting(false)
      }
    }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent, columnKey: string) => {
    e.preventDefault()
    resizingRef.current = {
      key: columnKey,
      startX: e.clientX,
      startWidth: columnWidths[columnKey],
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const diff = e.clientX - resizingRef.current.startX
      const column = COLUMNS.find(c => c.key === resizingRef.current!.key)
      const newWidth = Math.max(column?.minWidth || 50, resizingRef.current.startWidth + diff)
      setColumnWidths(prev => ({ ...prev, [resizingRef.current!.key]: newWidth }))
    }

    const handleMouseUp = () => {
      resizingRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [columnWidths])

  const renderCell = (preset: Preset, columnKey: string) => {
    switch (columnKey) {
      case 'naam':
        return <span className="font-medium text-foreground">{preset.naam}</span>
      case 'retailer':
        return (
          <span className="text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis block">
            {`{${preset.retailer.join(', ')}}`}
          </span>
        )
      case 'tags':
        return (
          <div className="flex gap-1 overflow-x-auto">
            {preset.tags.map((tag, idx) => (
              <span
                key={idx}
                className="bg-destructive/10 text-destructive text-[10px] px-2 py-0.5 rounded border border-destructive/20 font-semibold italic whitespace-nowrap flex-shrink-0"
              >
                {tag}
              </span>
            ))}
          </div>
        )
      case 'bezorgland':
        return (
          <span className="text-muted-foreground">
            {`{${preset.bezorgland.join(', ')}}`}
          </span>
        )
      case 'leverdag':
        return (
          <span className="text-muted-foreground">
            {`{${preset.leverdag.join(', ')}}`}
          </span>
        )
      case 'regio':
        if (!preset.postal_regions?.length) return null
        const regionNames = preset.postal_regions
          .map(regionId => {
            const region = postalRegions.find(r => r.region_id === regionId)
            return region?.name || regionId
          })
        return (
          <span className="text-muted-foreground">{`{${regionNames.join(', ')}}`}</span>
        )
      case 'pps':
        return preset.pps ? <CheckCircle2 className="w-4 h-4 text-primary" /> : null
      default:
        return null
    }
  }

  return (
    <section className="xl:col-span-8">
      <div className="bg-card border border-border rounded-lg shadow-sm h-full flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4" /> Presets
          </h2>
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="text-xs text-left w-full" style={{ tableLayout: 'fixed', minWidth: Object.values(columnWidths).reduce((a, b) => a + b, 0) }}>
            <thead className="bg-muted text-muted-foreground uppercase font-bold sticky top-0">
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className="px-4 py-3 relative select-none"
                    style={{ width: columnWidths[column.key], minWidth: column.minWidth }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{column.label}</span>
                    </div>
                    <div
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/40"
                      onMouseDown={(e) => handleMouseDown(e, column.key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-8 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    <span className="text-sm text-muted-foreground mt-2 block">Presets laden...</span>
                  </td>
                </tr>
              ) : presets.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Geen presets gevonden
                  </td>
                </tr>
              ) : (
                presets.map((preset) => (
                  <tr
                    key={preset.id}
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={`hover:bg-muted/30 transition-colors cursor-pointer group ${
                      selectedPresetId === preset.id ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''
                    }`}
                  >
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className="px-4 py-3 overflow-hidden"
                        style={{
                          width: columnWidths[column.key],
                          minWidth: column.minWidth,
                          maxWidth: columnWidths[column.key],
                        }}
                      >
                        {renderCell(preset, column.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-border flex items-center justify-between bg-muted/20">
          <div className="text-xs text-muted-foreground italic">{presets.length} results</div>
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              disabled={!selectedPreset}
              className="bg-primary text-white text-xs font-semibold px-6 py-2 rounded-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Gebruik preset
            </button>
            <button
              onClick={handleDeleteClick}
              disabled={!selectedPreset || isDeleting || !onDeletePreset}
              className="bg-destructive text-white text-xs font-semibold px-6 py-2 rounded-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-destructive/90 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Verwijder preset
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={isConfirmDialogOpen}
        onClose={() => setIsConfirmDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Preset verwijderen"
        message={`Weet je zeker dat je de preset "${selectedPreset?.naam || ''}" wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.`}
        confirmText="Verwijderen"
        cancelText="Annuleren"
        variant="destructive"
        isLoading={isDeleting}
      />
    </section>
  )
}

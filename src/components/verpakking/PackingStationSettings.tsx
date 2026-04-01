'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2, Printer, AlertCircle, Monitor, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'

interface PackingStation {
  id: string
  name: string
  printnode_printer_id: number
  printnode_printer_name: string | null
  is_active: boolean
}

interface PrintNodePrinter {
  id: number
  name: string
  description: string | null
  state: string
  computer: { id: number; name: string; state: string } | null
}

export default function PackingStationSettings() {
  const { t } = useTranslation()
  const [stations, setStations] = useState<PackingStation[]>([])
  const [printers, setPrinters] = useState<PrintNodePrinter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingPrinters, setIsLoadingPrinters] = useState(false)
  const [printersError, setPrintersError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formPrinterId, setFormPrinterId] = useState<number | null>(null)

  const fetchStations = useCallback(async () => {
    try {
      const res = await fetch('/api/verpakking/packing-stations')
      if (!res.ok) return
      const data = await res.json()
      setStations(data.stations ?? [])
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchPrinters = useCallback(async () => {
    setIsLoadingPrinters(true)
    setPrintersError(null)
    try {
      const res = await fetch('/api/verpakking/printnode/printers')
      if (!res.ok) {
        const data = await res.json()
        setPrintersError(data.error || t.settings.couldNotFetchPrinters)
        return
      }
      const data = await res.json()
      setPrinters(data.printers ?? [])
    } catch {
      setPrintersError(t.settings.couldNotFetchPrintersFromPrintNode)
    } finally {
      setIsLoadingPrinters(false)
    }
  }, [])

  useEffect(() => {
    fetchStations()
    fetchPrinters()
  }, [fetchStations, fetchPrinters])

  const handleSave = async () => {
    if (!formName.trim() || !formPrinterId) return

    setIsSaving(true)
    try {
      const printer = printers.find((p) => p.id === formPrinterId)

      if (editingId) {
        await fetch('/api/verpakking/packing-stations/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingId,
            name: formName.trim(),
            printnode_printer_id: formPrinterId,
            printnode_printer_name: printer?.name ?? null,
          }),
        })
      } else {
        await fetch('/api/verpakking/packing-stations/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName.trim(),
            printnode_printer_id: formPrinterId,
            printnode_printer_name: printer?.name ?? null,
          }),
        })
      }

      setShowForm(false)
      setEditingId(null)
      setFormName('')
      setFormPrinterId(null)
      await fetchStations()
    } catch {
      // silent
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t.settings.deleteStationConfirm)) return

    try {
      await fetch('/api/verpakking/packing-stations/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await fetchStations()
    } catch {
      // silent
    }
  }

  const handleEdit = (station: PackingStation) => {
    setEditingId(station.id)
    setFormName(station.name)
    setFormPrinterId(station.printnode_printer_id)
    setShowForm(true)
  }

  const handleSyncFromPicqer = async () => {
    setIsSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/verpakking/packing-stations/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setSyncResult(`${t.common.error}: ${data.error}`)
      } else {
        setSyncResult(data.message)
        await fetchStations()
      }
    } catch {
      setSyncResult(t.settings.syncFailed)
    } finally {
      setIsSyncing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t.settings.stations}</h2>
          <p className="text-sm text-muted-foreground">
            {t.settings.stationsDescription}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncFromPicqer}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 min-h-[44px] border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {t.settings.importFromPicqer}
          </button>
          <button
            onClick={() => {
              setShowForm(true)
              setEditingId(null)
              setFormName('')
              setFormPrinterId(null)
            }}
            className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.settings.newStation}
          </button>
        </div>
      </div>

      {/* Sync result */}
      {syncResult && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <RefreshCw className="w-4 h-4 flex-shrink-0" />
          {syncResult}
        </div>
      )}

      {/* PrintNode status */}
      {printersError && (
        <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t.settings.printNodeUnavailable}</p>
            <p className="text-xs mt-0.5">{printersError}</p>
          </div>
        </div>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
          <h3 className="font-medium">{editingId ? t.settings.editStation : t.settings.newStation}</h3>

          <div>
            <label className="block text-sm font-medium mb-1">{t.settings.name}</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t.settings.stationPlaceholder}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t.settings.printer}</label>
            {isLoadingPrinters ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.settings.fetchingPrinters}
              </div>
            ) : printers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                {t.settings.noPrintersFound}
              </p>
            ) : (
              <select
                value={formPrinterId ?? ''}
                onChange={(e) => setFormPrinterId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">{t.settings.selectPrinter}</option>
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.state}) {p.computer ? `— ${p.computer.name}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={!formName.trim() || !formPrinterId || isSaving}
              className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingId ? t.common.save : t.settings.create}
            </button>
            <button
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
              className="px-4 py-2 min-h-[44px] text-sm rounded-lg hover:bg-muted transition-colors"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Stations list */}
      {stations.length === 0 && !showForm ? (
        <div className="text-center py-12 text-muted-foreground">
          <Monitor className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">{t.settings.noStationsConfigured}</p>
          <p className="text-xs mt-1">{t.settings.noStationsHint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {stations.map((station) => {
            const printer = printers.find((p) => p.id === station.printnode_printer_id)
            const isOnline = printer?.state === 'online'

            return (
              <div
                key={station.id}
                className="flex items-center gap-4 p-4 border border-border rounded-lg bg-card"
              >
                <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                  <Monitor className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{station.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Printer className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-muted-foreground truncate">
                      {station.printnode_printer_name ?? `Printer #${station.printnode_printer_id}`}
                    </span>
                    {printer ? (
                      isOnline ? (
                        <span className="flex items-center gap-1 text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded flex-shrink-0">
                          <Wifi className="w-3 h-3" />
                          Online
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-red-700 bg-red-100 px-1.5 py-0.5 rounded flex-shrink-0">
                          <WifiOff className="w-3 h-3" />
                          Offline
                        </span>
                      )
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleEdit(station)}
                    className="px-3 py-2 min-h-[44px] text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  >
                    {t.settings.edit}
                  </button>
                  <button
                    onClick={() => handleDelete(station.id)}
                    className="p-2 min-w-[44px] min-h-[44px] text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

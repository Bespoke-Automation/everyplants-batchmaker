'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  SkipForward,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RotateCcw,
} from 'lucide-react'

interface OrderMapping {
  id: number
  floriday_fulfillment_order_id: string
  floriday_sales_order_ids: string[]
  floriday_status: string | null
  floriday_sequence_number: number
  floriday_customer_org_id: string | null
  floriday_delivery_date: string | null
  floriday_order_date: string | null
  num_sales_orders: number
  num_plates: number
  load_carrier_type: string | null
  num_load_carriers: number | null
  reference: string | null
  customer_name: string | null
  picqer_order_id: number | null
  picqer_order_number: string | null
  processing_status: string
  error_message: string | null
  updated_at: string
}

type StatusFilter = 'all' | 'created' | 'failed' | 'skipped'

export default function FloridayOrders() {
  const [orders, setOrders] = useState<OrderMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filter !== 'all') params.set('status', filter)
      const res = await fetch(`/api/floriday/orders?${params}`)
      if (res.ok) {
        const data = await res.json()
        setOrders(data.orders || [])
      }
    } catch (err) {
      console.error('Orders fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Alle' },
    { value: 'created', label: 'Aangemaakt' },
    { value: 'failed', label: 'Mislukt' },
    { value: 'skipped', label: 'Overgeslagen' },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Floriday Orders</h2>
        <button
          onClick={() => fetchOrders()}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Vernieuwen
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {statusFilters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === f.value
                ? 'bg-emerald-600/10 text-emerald-600 font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <div className="border border-border rounded-lg bg-card p-8 text-center">
          <p className="text-muted-foreground">Geen orders gevonden</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left p-3 font-medium w-8"></th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Klant</th>
                <th className="text-left p-3 font-medium">Referentie</th>
                <th className="text-left p-3 font-medium">Picqer</th>
                <th className="text-left p-3 font-medium">Leverdag</th>
                <th className="text-left p-3 font-medium">Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  expanded={expandedId === order.id}
                  onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  onRetried={fetchOrders}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function OrderRow({
  order,
  expanded,
  onToggle,
  onRetried,
}: {
  order: OrderMapping
  expanded: boolean
  onToggle: () => void
  onRetried: () => void
}) {
  const [retrying, setRetrying] = useState(false)
  const [retryResult, setRetryResult] = useState<{ success: boolean; message: string } | null>(null)

  async function handleRetry(e: React.MouseEvent) {
    e.stopPropagation()
    setRetrying(true)
    setRetryResult(null)
    try {
      const res = await fetch(`/api/floriday/orders/${order.floriday_fulfillment_order_id}/retry`, {
        method: 'POST',
      })
      const data = await res.json()
      if (data.success) {
        setRetryResult({ success: true, message: `Aangemaakt: ${data.picqer_order_number}` })
        onRetried()
      } else {
        setRetryResult({ success: false, message: data.error || 'Mislukt' })
      }
    } catch {
      setRetryResult({ success: false, message: 'Netwerkfout' })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
      >
        <td className="p-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </td>
        <td className="p-3">
          <StatusBadge status={order.processing_status} />
        </td>
        <td className="p-3">{order.customer_name || '-'}</td>
        <td className="p-3 font-mono text-xs">{order.reference || '-'}</td>
        <td className="p-3">
          {order.picqer_order_number ? (
            <span className="font-mono text-xs">{order.picqer_order_number}</span>
          ) : (
            '-'
          )}
        </td>
        <td className="p-3 text-muted-foreground">
          {order.floriday_delivery_date
            ? new Date(order.floriday_delivery_date).toLocaleDateString('nl-NL')
            : '-'}
        </td>
        <td className="p-3 text-muted-foreground text-xs">
          {new Date(order.updated_at).toLocaleString('nl-NL')}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={7} className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Detail label="Fulfillment Order ID" value={order.floriday_fulfillment_order_id} mono />
              <Detail label="Floriday Status" value={order.floriday_status} />
              <Detail label="Sales Orders" value={order.num_sales_orders?.toString()} />
              <Detail label="Dragertype" value={order.load_carrier_type} />
              <Detail label="Aantal dragers" value={order.num_load_carriers?.toString()} />
              <Detail label="Platen" value={order.num_plates?.toString()} />
              {order.picqer_order_id && (
                <div>
                  <p className="text-xs text-muted-foreground">Picqer</p>
                  <a
                    href={`https://green-bubble.picqer.com/orders/${order.picqer_order_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-600 hover:underline flex items-center gap-1"
                  >
                    {order.picqer_order_number}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {order.floriday_sales_order_ids?.length > 0 && (
                <div className="col-span-full">
                  <p className="text-xs text-muted-foreground">Gekoppelde Sales Order IDs</p>
                  <p className="font-mono text-xs mt-0.5 text-muted-foreground">
                    {order.floriday_sales_order_ids.join(', ')}
                  </p>
                </div>
              )}
              {order.error_message && (
                <div className="col-span-full">
                  <p className="text-xs text-muted-foreground">Foutmelding</p>
                  <p className="text-red-600 text-xs mt-0.5 font-mono">{order.error_message}</p>
                </div>
              )}
              <div className="col-span-full flex items-center gap-3 pt-1">
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-600/10 text-blue-600 hover:bg-blue-600/20 disabled:opacity-50 transition-colors font-medium"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                  {retrying ? 'Bezig...' : 'Opnieuw inschieten'}
                </button>
                {retryResult && (
                  <span className={`text-xs ${retryResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {retryResult.message}
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'created':
      return (
        <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Aangemaakt
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium">
          <XCircle className="w-3.5 h-3.5" />
          Mislukt
        </span>
      )
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
          <SkipForward className="w-3.5 h-3.5" />
          Overgeslagen
        </span>
      )
    default:
      return (
        <span className="text-xs text-muted-foreground">{status}</span>
      )
  }
}

function Detail({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 ${mono ? 'font-mono text-xs' : ''}`}>{value || '-'}</p>
    </div>
  )
}

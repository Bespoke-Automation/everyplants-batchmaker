'use client'

import { useState, useRef, useCallback } from 'react'
import { RefreshCw, Plus, Truck } from 'lucide-react'
import { TransformedOrder } from '@/types/order'

interface OrdersTableProps {
  orders: TransformedOrder[]
  isLoading: boolean
  onRefresh: () => void
  total: number
}

interface Column {
  key: string
  label: string
  minWidth: number
  initialWidth: number
}

const COLUMNS: Column[] = [
  { key: 'reference', label: 'Reference', minWidth: 100, initialWidth: 180 },
  { key: 'retailerName', label: 'Retailer name', minWidth: 80, initialWidth: 120 },
  { key: 'tagTitles', label: 'Tag titles', minWidth: 150, initialWidth: 200 },
  { key: 'bezorgland', label: 'Bezorgland', minWidth: 60, initialWidth: 80 },
  { key: 'leverdag', label: 'Leverdag', minWidth: 80, initialWidth: 100 },
  { key: 'picklistId', label: 'Picklist ID', minWidth: 80, initialWidth: 100 },
  { key: 'invoiceName', label: 'Invoicename', minWidth: 100, initialWidth: 120 },
  { key: 'orderId', label: 'OrderId', minWidth: 80, initialWidth: 100 },
  { key: 'plantnummer', label: 'Plantnummer', minWidth: 80, initialWidth: 100 },
  { key: 'retailerOrderNumber', label: 'Retailer order number', minWidth: 100, initialWidth: 150 },
  { key: 'idOrder', label: 'IdOrder', minWidth: 80, initialWidth: 100 },
  { key: 'idShipping', label: 'IdShipping', minWidth: 80, initialWidth: 80 },
]

export default function OrdersTable({ orders, isLoading, onRefresh, total }: OrdersTableProps) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: col.initialWidth }), {})
  )
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const getCountryBadgeColor = (country: string) => {
    const colors: Record<string, string> = {
      'NL': 'bg-indigo-100 text-indigo-700 border-indigo-200',
      'BE': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'DE': 'bg-gray-100 text-gray-700 border-gray-200',
      'FR': 'bg-blue-100 text-blue-700 border-blue-200',
      'AT': 'bg-red-100 text-red-700 border-red-200',
    }
    return colors[country] || 'bg-gray-50 text-gray-600 border-gray-200'
  }

  const getLeverdagBadgeColor = (leverdag: string) => {
    if (leverdag === 'zaterdag') {
      return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    }
    if (leverdag === 'Geen leverdag') {
      return 'bg-red-100 text-red-700 border-red-200'
    }
    return 'bg-green-100 text-green-700 border-green-200'
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

  const renderCell = (order: TransformedOrder, columnKey: string) => {
    switch (columnKey) {
      case 'reference':
        return <span className="font-mono text-muted-foreground">{order.reference}</span>
      case 'retailerName':
        return (
          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200 font-semibold whitespace-nowrap">
            {order.retailerName}
          </span>
        )
      case 'tagTitles':
        return (
          <div className="flex flex-wrap gap-1">
            {order.tags.slice(0, 3).map((tag, idx) => (
              <span
                key={idx}
                className="px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap"
                style={{
                  backgroundColor: tag.color,
                  color: tag.textColor,
                  borderColor: tag.color,
                }}
              >
                {tag.title}
              </span>
            ))}
            {order.tags.length > 3 && (
              <span className="px-2 py-1 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                +{order.tags.length - 3}
              </span>
            )}
          </div>
        )
      case 'bezorgland':
        return (
          <span className={`w-8 h-8 flex items-center justify-center rounded-full font-bold border shadow-sm ${getCountryBadgeColor(order.bezorgland)}`}>
            {order.bezorgland}
          </span>
        )
      case 'leverdag':
        return (
          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${getLeverdagBadgeColor(order.leverdag)}`}>
            {order.leverdag}
          </span>
        )
      case 'picklistId':
        return <span className="text-muted-foreground font-mono">{order.picklistId}</span>
      case 'invoiceName':
        return <span className="font-medium">{order.invoiceName}</span>
      case 'orderId':
        return <span className="text-muted-foreground">{order.orderId}</span>
      case 'plantnummer':
        return <span className="text-muted-foreground">{order.plantnummer || '-'}</span>
      case 'retailerOrderNumber':
        return <span className="text-muted-foreground">{order.retailerOrderNumber || '-'}</span>
      case 'idOrder':
        return <span className="text-muted-foreground">{order.idOrder}</span>
      case 'idShipping':
        return <span className="text-muted-foreground">{order.idShipping}</span>
      default:
        return null
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between bg-muted/5">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" /> Beschikbare Orders
          </h2>
          <div className="flex gap-2">
            <span className="bg-primary/10 text-primary text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border border-primary/20">
              Active Batches
            </span>
            <span className="bg-muted text-muted-foreground text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border border-border">
              Archive
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 hover:bg-muted rounded-md transition-all text-muted-foreground disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <div className="h-4 w-px bg-border mx-2"></div>
          <button className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
            <Plus className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar max-h-[500px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading orders from Picqer...</p>
            </div>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">No orders found matching your filters</p>
          </div>
        ) : (
          <table className="text-xs text-left w-full" style={{ tableLayout: 'fixed', minWidth: Object.values(columnWidths).reduce((a, b) => a + b, 0) }}>
            <thead className="bg-muted text-muted-foreground uppercase font-bold sticky top-0 z-10">
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
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-muted/50 transition-colors">
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className="px-4 py-4"
                      style={{ width: columnWidths[column.key], minWidth: column.minWidth }}
                    >
                      {renderCell(order, column.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {isLoading ? 'Loading...' : `${orders.length} of ${total} results (filtered)`}
      </div>
    </div>
  )
}

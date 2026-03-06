'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, CheckCircle, Link2, Loader2 } from 'lucide-react'
import Dialog from '@/components/ui/Dialog'

interface CatalogProduct {
  picqerProductId: number
  productcode: string
  name: string
  altSku: string | null
  tradeItemId: string | null
  tradeItemName: string | null
  supplierArticleCode: string | null
  matchMethod: string | null
}

interface TradeItemResult {
  trade_item_id: string
  supplier_article_code: string
  name: string
  vbn_product_code: number | null
}

interface MappingModalProps {
  product: CatalogProduct | null
  open: boolean
  onClose: () => void
  onMapped: () => void
}

export default function MappingModal({ product, open, onClose, onMapped }: MappingModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TradeItemResult[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state bij openen/sluiten
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setError(null)
      setSuccess(false)
      // Pre-fill zoekbalk met alt_sku als beschikbaar
      if (product?.altSku) {
        setQuery(product.altSku)
      }
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, product])

  // Auto-search wanneer query voorgevuld wordt met alt_sku
  useEffect(() => {
    if (open && product?.altSku && query === product.altSku) {
      searchTradeItems(product.altSku)
    }
    // Alleen bij mount met alt_sku
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const searchTradeItems = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    setError(null)
    try {
      const res = await fetch(`/api/floriday/trade-items/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (json.success) {
        setResults(json.tradeItems)
      } else {
        setError(json.error)
      }
    } catch {
      setError('Netwerkfout bij zoeken')
    } finally {
      setSearching(false)
    }
  }, [])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setSuccess(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchTradeItems(value)
    }, 300)
  }

  const handleSelect = async (tradeItem: TradeItemResult) => {
    if (!product) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/floriday/product-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          picqerProductId: product.picqerProductId,
          tradeItemId: tradeItem.trade_item_id,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setSuccess(true)
        setTimeout(() => {
          onMapped()
          onClose()
        }, 600)
      } else {
        setError(json.error ?? 'Mapping opslaan mislukt')
      }
    } catch {
      setError('Netwerkfout bij opslaan')
    } finally {
      setSaving(false)
    }
  }

  if (!product) return null

  const isMapped = !!product.tradeItemId

  return (
    <Dialog open={open} onClose={onClose} title="Product Mapping" className="max-w-lg">
      <div className="p-4 space-y-4">
        {/* Picqer product info */}
        <div className="bg-muted/50 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium">{product.name}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Code: <span className="font-mono">{product.productcode}</span></span>
            {product.altSku && (
              <span>Alt SKU: <span className="font-mono">{product.altSku}</span></span>
            )}
          </div>
          {isMapped && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-600">
              <Link2 className="w-3 h-3" />
              <span>Huidige mapping: {product.supplierArticleCode ?? product.tradeItemId?.slice(0, 8)}</span>
              {product.tradeItemName && (
                <span className="text-muted-foreground">({product.tradeItemName})</span>
              )}
            </div>
          )}
        </div>

        {/* Zoekbalk */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Zoek op naam of artikel code..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-3 py-2 rounded-lg flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            Mapping opgeslagen!
          </div>
        )}

        {/* Resultaten */}
        {results.length > 0 && !success && (
          <div className="border border-border rounded-lg max-h-64 overflow-y-auto divide-y divide-border">
            {results.map((ti) => (
              <button
                key={ti.trade_item_id}
                onClick={() => handleSelect(ti)}
                disabled={saving}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{ti.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono">{ti.supplier_article_code}</span>
                    {ti.vbn_product_code && (
                      <span>VBN: {ti.vbn_product_code}</span>
                    )}
                  </div>
                </div>
                {product.tradeItemId === ti.trade_item_id && (
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Geen resultaten */}
        {query.length >= 2 && !searching && results.length === 0 && !success && (
          <p className="text-center text-sm text-muted-foreground py-4">
            Geen trade items gevonden voor &ldquo;{query}&rdquo;
          </p>
        )}

        {/* Hint */}
        {query.length < 2 && !success && (
          <p className="text-center text-xs text-muted-foreground py-2">
            Typ minimaal 2 tekens om te zoeken in Floriday trade items
          </p>
        )}
      </div>
    </Dialog>
  )
}

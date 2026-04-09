'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Package,
  Truck,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Scale,
  Boxes,
  RefreshCw,
} from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'

interface PreviewProduct {
  picqer_product_id: number
  productcode: string
  quantity: number
  name: string
}

interface AdviceBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  products: { productcode: string; shipping_unit_name: string; quantity: number }[]
  box_cost?: number
  box_pick_cost?: number
  box_pack_cost?: number
  transport_cost?: number
  total_cost?: number
  carrier_code?: string
  weight_grams?: number
  weight_bracket?: string | null
}

interface AlternativePackaging {
  packaging_id: string
  name: string
  idpackaging: number
  box_cost?: number
  box_pick_cost?: number
  box_pack_cost?: number
  transport_cost?: number
  total_cost?: number
  carrier_code?: string
  is_recommended: boolean
  is_cheapest: boolean
}

interface MatchEntry {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  facturatie_box_sku: string | null
  rule_group: number
  specificity_score: number
  volume: number
  box_cost: number
  box_pick_cost: number
  box_pack_cost: number
  transport_cost: number
  total_cost: number
  carrier_code: string | null
  max_weight: number
  covers_all: boolean
}

interface ShippingUnit {
  shipping_unit_id: string
  shipping_unit_name: string
  quantity: number
}

interface PreviewResult {
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: AdviceBox[]
  alternatives: AlternativePackaging[]
  all_matches: MatchEntry[]
  shipping_units_detected: ShippingUnit[]
  unclassified_products: string[]
  excluded_packaging: string[]
  weight_exceeded: boolean
  cost_data_available: boolean
  country_code: string
  is_single_sku: boolean
  default_packaging: {
    packaging_id: string
    packaging_name: string
    idpackaging: number
    facturatie_box_sku: string | null
  } | null
}

interface PreviewResponse {
  success: boolean
  picklist: { idpicklist: number; picklistid: string; idorder: number }
  order: { idorder: number; orderid: string; deliveryname: string; deliverycountry: string; deliverycity: string }
  products: PreviewProduct[]
  preview: PreviewResult
}

function formatCents(cents: number | undefined): string {
  if (cents === undefined || cents === 0) return '-'
  return `€${(cents / 100).toFixed(2)}`
}

function confidenceBadge(confidence: string, t: ReturnType<typeof useTranslation>['t']) {
  switch (confidence) {
    case 'full_match':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> {t.engine.confidenceFull}</span>
    case 'partial_match':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"><AlertTriangle className="w-3 h-3" /> {t.engine.confidencePartial}</span>
    case 'no_match':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700"><AlertCircle className="w-3 h-3" /> {t.engine.confidenceNoMatch}</span>
    default:
      return null
  }
}

interface EnginePreviewPanelProps {
  picklistId: number
  picklistDisplayId: string
  onBack: () => void
}

export default function EnginePreviewPanel({ picklistId, picklistDisplayId, onBack }: EnginePreviewPanelProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<PreviewResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPreview = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/verpakking/engine/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picklistId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`)
        return
      }
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setIsLoading(false)
    }
  }, [picklistId])

  useEffect(() => {
    fetchPreview()
  }, [fetchPreview])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">{t.engine.previewLoading} {picklistDisplayId}...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4">
          <ArrowLeft className="w-4 h-4" /> {t.engine.back}
        </button>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">{t.engine.previewError}</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
            <button onClick={fetchPreview} className="mt-2 text-sm text-red-700 underline hover:no-underline">{t.engine.previewRetry}</button>
          </div>
        </div>
      </div>
    )
  }

  const { preview, order, products } = data

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="w-4 h-4" /> {t.engine.back}
          </button>
          <div>
            <h2 className="text-lg font-semibold">{t.engine.previewTitle} — {picklistDisplayId}</h2>
            <p className="text-sm text-muted-foreground">
              Order {order.orderid} · {order.deliveryname} · {order.deliverycity}, {order.deliverycountry}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {confidenceBadge(preview.confidence, t)}
          {preview.cost_data_available ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              <DollarSign className="w-3 h-3" /> {t.engine.costAvailable}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
              {t.engine.noCostData}
            </span>
          )}
          <button onClick={fetchPreview} className="p-2 text-muted-foreground hover:text-primary rounded-lg hover:bg-muted transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Single-SKU info */}
      {preview.is_single_sku && (
        <div className={`border rounded-lg p-3 flex items-start gap-3 text-sm ${
          preview.default_packaging
            ? 'bg-violet-50 border-violet-200 text-violet-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          <Package className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">{t.engine.singleSkuOrder}</span>
            {preview.default_packaging ? (
              <span> — {t.engine.defaultPackaging}: <strong>{preview.default_packaging.packaging_name}</strong>
                {preview.default_packaging.facturatie_box_sku && (
                  <span className="font-mono text-xs ml-1">({preview.default_packaging.facturatie_box_sku})</span>
                )}
              </span>
            ) : (
              <span> — <strong>{t.engine.noDefaultPackaging}</strong> ({t.engine.noDefaultPackagingHint})</span>
            )}
          </div>
        </div>
      )}

      {/* Weight warning */}
      {preview.weight_exceeded && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-sm text-amber-700">
          <Scale className="w-4 h-4 shrink-0" />
          <span className="font-medium">{t.engine.weightWarning}</span>
        </div>
      )}

      {/* Unclassified products warning */}
      {preview.unclassified_products.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {t.engine.unclassifiedWarning}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {preview.unclassified_products.map(pc => (
              <span key={pc} className="px-2 py-0.5 bg-amber-100 rounded text-xs font-mono">{pc}</span>
            ))}
          </div>
        </div>
      )}

      {/* Excluded packaging products info */}
      {preview.excluded_packaging?.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
          <div className="flex items-center gap-2 font-medium mb-1">
            <Package className="w-4 h-4 shrink-0" />
            {t.engine.excludedPackaging}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {preview.excluded_packaging.map(pc => (
              <span key={pc} className="px-2 py-0.5 bg-blue-100 rounded text-xs font-mono">{pc}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Products + Shipping Units */}
        <div className="space-y-4">
          {/* Products */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h3 className="font-semibold flex items-center gap-2"><Package className="w-4 h-4" /> {t.engine.products} ({products.length})</h3>
            </div>
            <div className="divide-y divide-border">
              {products.map(p => (
                <div key={p.picqer_product_id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-mono text-xs text-muted-foreground mr-2">{p.productcode}</span>
                    <span>{p.name}</span>
                  </div>
                  <span className="font-medium text-muted-foreground">×{p.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Shipping Units */}
          {preview.shipping_units_detected.length > 0 && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <h3 className="font-semibold flex items-center gap-2"><Boxes className="w-4 h-4" /> {t.engine.shippingUnits}</h3>
              </div>
              <div className="divide-y divide-border">
                {preview.shipping_units_detected.map(su => (
                  <div key={su.shipping_unit_id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span>{su.shipping_unit_name}</span>
                    <span className="font-medium text-muted-foreground">×{su.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Recommended boxes */}
        <div className="space-y-4">
          {/* Engine recommendation */}
          <div className="bg-card border-2 border-emerald-300 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-emerald-200 bg-emerald-50">
              <h3 className="font-semibold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {t.engine.recommendation} ({preview.advice_boxes.length} {preview.advice_boxes.length === 1 ? t.engine.box : t.engine.boxes})
              </h3>
            </div>
            {preview.advice_boxes.length === 0 ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-sm">{t.engine.noRecommendation}</div>
            ) : (
              <div className="divide-y divide-border">
                {preview.advice_boxes.map((box, i) => (
                  <div key={`${box.packaging_id}-${i}`} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">{box.packaging_name}</span>
                      {box.total_cost !== undefined && box.total_cost > 0 && (
                        <span className="text-lg font-bold text-emerald-700">{formatCents(box.total_cost)}</span>
                      )}
                    </div>
                    {/* Cost breakdown */}
                    {box.total_cost !== undefined && box.total_cost > 0 && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-2">
                        <span>{t.engine.material}: {formatCents(box.box_cost)}</span>
                        <span>Pick: {formatCents(box.box_pick_cost)}</span>
                        <span>Pack: {formatCents(box.box_pack_cost)}</span>
                        <span>{t.engine.transport}: {formatCents(box.transport_cost)}</span>
                        {box.carrier_code && <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> {box.carrier_code}</span>}
                        {box.weight_grams !== undefined && <span className="flex items-center gap-1"><Scale className="w-3 h-3" /> {(box.weight_grams / 1000).toFixed(1)}kg</span>}
                        {box.weight_bracket && <span>({box.weight_bracket})</span>}
                      </div>
                    )}
                    {/* Products in this box */}
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {box.products.map((p, j) => (
                        <div key={j}>
                          <span className="font-mono">{p.productcode}</span> ({p.shipping_unit_name}) ×{p.quantity}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Total cost */}
            {preview.advice_boxes.length > 1 && (
              <div className="px-4 py-2 border-t border-emerald-200 bg-emerald-50/50 flex justify-between items-center text-sm">
                <span className="font-medium text-emerald-700">{t.engine.total}</span>
                <span className="font-bold text-emerald-800">
                  {formatCents(preview.advice_boxes.reduce((sum, b) => sum + (b.total_cost ?? 0), 0))}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* All Matches Table */}
      {preview.all_matches.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold">{t.engine.allMatches} ({preview.all_matches.length})</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t.engine.sortedByCost}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left">
                  <th className="px-4 py-2 font-medium">{t.engine.packaging}</th>
                  <th className="px-4 py-2 font-medium text-right">{t.engine.material}</th>
                  <th className="px-4 py-2 font-medium text-right">Pick</th>
                  <th className="px-4 py-2 font-medium text-right">Pack</th>
                  <th className="px-4 py-2 font-medium text-right">{t.engine.transport}</th>
                  <th className="px-4 py-2 font-medium text-right">{t.engine.total}</th>
                  <th className="px-4 py-2 font-medium">{t.engine.carrier}</th>
                  <th className="px-4 py-2 font-medium text-center">{t.engine.fitsAll}</th>
                  <th className="px-4 py-2 font-medium text-right">{t.engine.maxKg}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.all_matches.map((m, i) => {
                  const isRecommended = preview.advice_boxes.length === 1 && preview.advice_boxes[0].packaging_id === m.packaging_id
                  const isCheapest = i === 0 && m.total_cost > 0
                  return (
                    <tr
                      key={`${m.packaging_id}-${m.rule_group}`}
                      className={`${isRecommended ? 'bg-emerald-50' : ''} ${isCheapest && !isRecommended ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.packaging_name}</span>
                          {isRecommended && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-200 text-emerald-800">{t.engine.recommended}</span>
                          )}
                          {isCheapest && !isRecommended && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-200 text-blue-800">{t.engine.cheapest}</span>
                          )}
                        </div>
                        {m.facturatie_box_sku && (
                          <span className="text-[10px] text-muted-foreground font-mono">{m.facturatie_box_sku}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(m.box_cost)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(m.box_pick_cost)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(m.box_pack_cost)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(m.transport_cost)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-bold">{formatCents(m.total_cost)}</td>
                      <td className="px-4 py-2 text-xs">{m.carrier_code || '-'}</td>
                      <td className="px-4 py-2 text-center">
                        {m.covers_all ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                        ) : (
                          <span className="text-xs text-muted-foreground">Nee</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">
                        {m.max_weight === Infinity ? '-' : `${(m.max_weight / 1000).toFixed(0)}kg`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Alternatives */}
      {preview.alternatives.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold">{t.engine.alternatives}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left">
                  <th className="px-4 py-2 font-medium">{t.engine.packaging}</th>
                  <th className="px-4 py-2 font-medium text-right">{t.engine.material}</th>
                  <th className="px-4 py-2 font-medium text-right">Pick</th>
                  <th className="px-4 py-2 font-medium text-right">Pack</th>
                  <th className="px-4 py-2 font-medium text-right">{t.engine.transport}</th>
                  <th className="px-4 py-2 font-medium text-right">{t.engine.total}</th>
                  <th className="px-4 py-2 font-medium">{t.engine.carrier}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.alternatives.map(alt => (
                  <tr
                    key={alt.packaging_id}
                    className={`${alt.is_recommended ? 'bg-emerald-50' : ''} ${alt.is_cheapest && !alt.is_recommended ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{alt.name}</span>
                        {alt.is_recommended && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-200 text-emerald-800">{t.engine.recommended}</span>
                        )}
                        {alt.is_cheapest && !alt.is_recommended && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-200 text-blue-800">{t.engine.cheapest}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(alt.box_cost)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(alt.box_pick_cost)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(alt.box_pack_cost)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatCents(alt.transport_cost)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-bold">{formatCents(alt.total_cost)}</td>
                    <td className="px-4 py-2 text-xs">{alt.carrier_code || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

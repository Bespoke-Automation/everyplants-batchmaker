'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, Sparkles, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'

interface AdviceBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  products: Array<{
    productcode: string
    shipping_unit_name: string
    quantity: number
  }>
}

interface ActualBox {
  packaging_name: string
  picqer_packaging_id: number
  products: Array<{
    productcode: string
    amount: number
  }>
}

interface PackagingAdvice {
  id: string
  order_id: number
  picklist_id: number | null
  status: 'calculated' | 'applied' | 'invalidated' | 'overridden'
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: AdviceBox[]
  unclassified_products: string[]
  tags_written: string[]
  calculated_at: string
  outcome: 'followed' | 'modified' | 'ignored' | 'no_advice' | null
  deviation_type: 'none' | 'extra_boxes' | 'fewer_boxes' | 'different_packaging' | 'mixed' | null
  actual_boxes: ActualBox[] | null
  resolved_at: string | null
  shipping_unit_fingerprint: string | null
  weight_exceeded: boolean
}

const PAGE_SIZE = 20

export default function EngineLog() {
  const [advices, setAdvices] = useState<PackagingAdvice[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confidenceFilter, setConfidenceFilter] = useState<string | null>(null)
  const [outcomeFilter, setOutcomeFilter] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchAdvices = async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({
        limit: PAGE_SIZE.toString(),
        offset: (page * PAGE_SIZE).toString(),
      })

      if (confidenceFilter) {
        params.append('confidence', confidenceFilter)
      }
      if (outcomeFilter) {
        params.append('outcome', outcomeFilter)
      }

      const response = await fetch(`/api/verpakking/engine/log?${params}`)
      if (!response.ok) throw new Error('Failed to fetch engine log')

      const data = await response.json()
      setAdvices(data.advices)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdvices()
  }, [page, confidenceFilter, outcomeFilter])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'full_match':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800">Volledig</span>
      case 'partial_match':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">Gedeeltelijk</span>
      case 'no_match':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-800">Geen match</span>
      default:
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-800">{confidence}</span>
    }
  }

  const getOutcomeBadge = (outcome: string | null) => {
    switch (outcome) {
      case 'followed':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800">Gevolgd</span>
      case 'modified':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">Gewijzigd</span>
      case 'ignored':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">Genegeerd</span>
      case 'no_advice':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600">Geen advies</span>
      case null:
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600">Open</span>
      default:
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-800">{outcome}</span>
    }
  }

  const getDeviationBadge = (deviationType: string | null) => {
    switch (deviationType) {
      case 'none':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800">Exact gevolgd</span>
      case 'extra_boxes':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">Extra dozen</span>
      case 'fewer_boxes':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">Minder dozen</span>
      case 'different_packaging':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">Andere verpakking</span>
      case 'mixed':
        return <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">Gemengde afwijking</span>
      default:
        return null
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  if (loading && advices.length === 0) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="font-medium">Fout bij ophalen engine log</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4">Engine Advieslog</h2>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2">
            <label htmlFor="confidence-filter" className="text-sm font-medium text-muted-foreground">
              Confidence:
            </label>
            <select
              id="confidence-filter"
              value={confidenceFilter || ''}
              onChange={(e) => {
                setConfidenceFilter(e.target.value || null)
                setPage(0)
              }}
              className="min-h-[44px] px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Alle</option>
              <option value="full_match">Volledig</option>
              <option value="partial_match">Gedeeltelijk</option>
              <option value="no_match">Geen match</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="outcome-filter" className="text-sm font-medium text-muted-foreground">
              Outcome:
            </label>
            <select
              id="outcome-filter"
              value={outcomeFilter || ''}
              onChange={(e) => {
                setOutcomeFilter(e.target.value || null)
                setPage(0)
              }}
              className="min-h-[44px] px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Alle</option>
              <option value="pending">Nog open</option>
              <option value="followed">Gevolgd</option>
              <option value="modified">Gewijzigd</option>
              <option value="ignored">Genegeerd</option>
              <option value="no_advice">Geen advies</option>
            </select>
          </div>

          <button
            onClick={() => fetchAdvices()}
            disabled={loading}
            className="min-h-[44px] px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ml-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Vernieuwen
          </button>
        </div>
      </div>

      {/* Empty state */}
      {advices.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <Sparkles className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">Nog geen engine-adviezen berekend</h3>
          <p className="text-sm text-muted-foreground">
            Start met inpakken om adviezen te genereren.
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Datum
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Order
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Confidence
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Advies dozen
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Outcome
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Fingerprint
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {advices.map((advice) => (
                    <>
                      <tr
                        key={advice.id}
                        onClick={() => toggleExpand(advice.id)}
                        className="hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {expandedId === advice.id ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                            {formatDate(advice.calculated_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">
                          #{advice.order_id}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {getConfidenceBadge(advice.confidence)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {advice.advice_boxes.map((box) => box.packaging_name).join(', ')}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {getOutcomeBadge(advice.outcome)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {advice.shipping_unit_fingerprint
                            ? advice.shipping_unit_fingerprint.substring(0, 20) +
                              (advice.shipping_unit_fingerprint.length > 20 ? '...' : '')
                            : '-'}
                        </td>
                      </tr>
                      {expandedId === advice.id && (
                        <tr key={`${advice.id}-detail`}>
                          <td colSpan={6} className="px-4 py-4 bg-muted/30">
                            <div className="space-y-4">
                              {/* Weight exceeded warning */}
                              {advice.weight_exceeded && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <p className="text-sm font-medium text-amber-800">Gewicht overschreden</p>
                                    <p className="text-xs text-amber-700 mt-1">
                                      Het maximale gewicht van één of meerdere dozen is overschreden.
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Deviation badge */}
                              {advice.deviation_type && getDeviationBadge(advice.deviation_type) && (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-muted-foreground">Afwijking:</span>
                                  {getDeviationBadge(advice.deviation_type)}
                                </div>
                              )}

                              {/* Tags written */}
                              {advice.tags_written && advice.tags_written.length > 0 && (
                                <div>
                                  <span className="text-sm font-medium text-muted-foreground">Tags geschreven:</span>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {advice.tags_written.map((tag, idx) => (
                                      <span
                                        key={idx}
                                        className="px-2 py-1 rounded-md text-xs bg-blue-100 text-blue-800"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Unclassified products warning */}
                              {advice.unclassified_products && advice.unclassified_products.length > 0 && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                  <p className="text-sm font-medium text-amber-800">Ongeclassificeerde producten:</p>
                                  <p className="text-xs text-amber-700 mt-1">
                                    {advice.unclassified_products.join(', ')}
                                  </p>
                                </div>
                              )}

                              {/* Advice vs Actual boxes */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Left: Advice */}
                                <div>
                                  <h4 className="text-sm font-semibold mb-3 text-foreground">Advies</h4>
                                  <div className="space-y-3">
                                    {advice.advice_boxes.map((box, idx) => (
                                      <div key={idx} className="bg-background border border-border rounded-lg p-3">
                                        <p className="text-sm font-medium mb-2">{box.packaging_name}</p>
                                        <ul className="text-xs text-muted-foreground space-y-1">
                                          {box.products.map((product, pidx) => (
                                            <li key={pidx}>
                                              {product.productcode} ({product.shipping_unit_name}) × {product.quantity}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Right: Actual */}
                                {advice.actual_boxes && advice.actual_boxes.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-semibold mb-3 text-foreground">Werkelijk</h4>
                                    <div className="space-y-3">
                                      {advice.actual_boxes.map((box, idx) => (
                                        <div key={idx} className="bg-background border border-border rounded-lg p-3">
                                          <p className="text-sm font-medium mb-2">{box.packaging_name}</p>
                                          <ul className="text-xs text-muted-foreground space-y-1">
                                            {box.products.map((product, pidx) => (
                                              <li key={pidx}>
                                                {product.productcode} × {product.amount}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Pagina {page + 1} van {totalPages || 1} ({total} resultaten)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 0 || loading}
                className="min-h-[44px] px-4 py-2 bg-background border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Vorige
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages - 1 || loading}
                className="min-h-[44px] px-4 py-2 bg-background border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Volgende
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

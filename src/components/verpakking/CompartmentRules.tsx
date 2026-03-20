'use client'

import { useState, useMemo, useCallback, Fragment } from 'react'
import {
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Box,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  Layers,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Package,
} from 'lucide-react'
import { useCompartmentRules, useShippingUnits } from '@/hooks/useCompartmentRules'
import type { CompartmentRule, ShippingUnit } from '@/hooks/useCompartmentRules'
import { useLocalPackagings } from '@/hooks/useLocalPackagings'

// ── Helpers ──────────────────────────────────────────────────────────────────

const OPERATORS = [
  { value: 'EN', label: 'EN', description: 'Alle regels moeten voldoen' },
  { value: 'OF', label: 'OF', description: 'Minstens één moet voldoen' },
  { value: 'ALTERNATIEF', label: 'ALTERNATIEF', description: 'Alternatief voor een EN-regel' },
] as const

function getOperatorColor(operator: string) {
  switch (operator) {
    case 'EN':
      return 'bg-blue-100 text-blue-800'
    case 'OF':
      return 'bg-amber-100 text-amber-800'
    case 'ALTERNATIEF':
      return 'bg-purple-100 text-purple-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

/** Build a human-readable summary for a rule group */
function buildGroupSummary(rules: CompartmentRule[]): string {
  const enRules = rules.filter(r => r.operator === 'EN')
  const altRules = rules.filter(r => r.operator === 'ALTERNATIEF')

  const parts: string[] = []
  for (const en of enRules) {
    let text = `${en.quantity}x ${en.shippingUnitName}`
    const alts = altRules.filter(a => a.alternativeForId === en.id)
    if (alts.length > 0) {
      const altNames = alts.map(a => a.shippingUnitName).join(' of ')
      text += ` (of ${altNames})`
    }
    parts.push(text)
  }

  return parts.join(' + ')
}

// ── Add Rule Form (inline) ───────────────────────────────────────────────────

interface AddRuleFormProps {
  ruleGroup: number
  packagingId: string
  shippingUnits: ShippingUnit[]
  enRulesInGroup: CompartmentRule[]
  onAdd: (rule: {
    packagingId: string
    ruleGroup: number
    shippingUnitId: string
    quantity: number
    operator: string
    alternativeForId: string | null
    sortOrder: number
  }) => Promise<void>
  onCancel: () => void
  nextSortOrder: number
}

function AddRuleForm({
  ruleGroup,
  packagingId,
  shippingUnits,
  enRulesInGroup,
  onAdd,
  onCancel,
  nextSortOrder,
}: AddRuleFormProps) {
  const [shippingUnitId, setShippingUnitId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [operator, setOperator] = useState('EN')
  const [alternativeForId, setAlternativeForId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groupedUnits = useMemo(() => {
    const groups: Record<string, ShippingUnit[]> = {}
    for (const unit of shippingUnits) {
      if (!groups[unit.productType]) {
        groups[unit.productType] = []
      }
      groups[unit.productType].push(unit)
    }
    return groups
  }, [shippingUnits])

  const handleSubmit = async () => {
    if (!shippingUnitId) {
      setError('Selecteer een shipping unit')
      return
    }
    if (operator === 'ALTERNATIEF' && !alternativeForId) {
      setError('Selecteer de EN-regel waarvoor dit een alternatief is')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      await onAdd({
        packagingId,
        ruleGroup,
        shippingUnitId,
        quantity,
        operator,
        alternativeForId: operator === 'ALTERNATIEF' ? alternativeForId : null,
        sortOrder: nextSortOrder,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij opslaan')
      setIsSaving(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-muted/50 rounded-lg border border-border">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
        <div className="sm:col-span-5">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Shipping unit</label>
          <select
            value={shippingUnitId}
            onChange={(e) => setShippingUnitId(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
          >
            <option value="">Selecteer...</option>
            {Object.entries(groupedUnits).map(([type, units]) => (
              <optgroup key={type} label={type}>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Aantal</label>
          <input type="number" min={1} value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
          />
        </div>
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Operator</label>
          <select value={operator}
            onChange={(e) => { setOperator(e.target.value); if (e.target.value !== 'ALTERNATIEF') setAlternativeForId(null) }}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
          >
            {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex items-center gap-1">
          <button onClick={handleSubmit} disabled={isSaving}
            className="flex items-center justify-center gap-1 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 min-h-[44px] flex-1">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button onClick={onCancel} disabled={isSaving}
            className="flex items-center justify-center px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted min-h-[44px]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {operator === 'ALTERNATIEF' && (
        <div className="mt-3">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Alternatief voor (EN-regel)</label>
          <select value={alternativeForId ?? ''} onChange={(e) => setAlternativeForId(e.target.value || null)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm min-h-[44px]">
            <option value="">Selecteer EN-regel...</option>
            {enRulesInGroup.map((rule) => (
              <option key={rule.id} value={rule.id}>{rule.quantity}x {rule.shippingUnitName}</option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}
    </div>
  )
}

// ── Rule Group Card ──────────────────────────────────────────────────────────

interface RuleGroupCardProps {
  groupNumber: number
  groupIndex: number
  totalGroups: number
  rules: CompartmentRule[]
  packagingId: string
  shippingUnits: ShippingUnit[]
  onAddRule: (rule: {
    packagingId: string; ruleGroup: number; shippingUnitId: string
    quantity: number; operator: string; alternativeForId: string | null; sortOrder: number
  }) => Promise<void>
  onDeleteRule: (id: string) => Promise<void>
  onDeleteGroup: () => void
}

function RuleGroupCard({
  groupNumber, groupIndex, totalGroups, rules, packagingId, shippingUnits,
  onAddRule, onDeleteRule, onDeleteGroup,
}: RuleGroupCardProps) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(false)

  const enRules = rules.filter((r) => r.operator === 'EN')
  const altRules = rules.filter((r) => r.operator === 'ALTERNATIEF')
  const nextSortOrder = rules.length > 0 ? Math.max(...rules.map((r) => r.sortOrder)) + 1 : 0

  const summary = buildGroupSummary(rules)

  return (
    <>
      {/* OF separator between groups */}
      {groupIndex > 0 && (
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 border-t border-amber-300" />
          <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold uppercase">OF</span>
          <div className="flex-1 border-t border-amber-300" />
        </div>
      )}

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {/* Group header */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
              {groupIndex + 1}
            </span>
            <span className="text-sm font-semibold">Combinatie {groupIndex + 1}</span>
          </div>
          <div className="flex items-center gap-1">
            {deleteGroupConfirm ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-destructive mr-1">Verwijderen?</span>
                <button onClick={() => { onDeleteGroup(); setDeleteGroupConfirm(false) }}
                  className="p-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setDeleteGroupConfirm(false)}
                  className="p-1.5 rounded-lg hover:bg-muted">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button onClick={() => setDeleteGroupConfirm(true)}
                className="p-1.5 rounded-lg hover:bg-destructive/10" title="Combinatie verwijderen">
                <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            )}
          </div>
        </div>

        {/* Human-readable summary */}
        {rules.length > 0 && (
          <div className="px-4 py-2.5 bg-blue-50/50 border-b border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {summary}
            </p>
          </div>
        )}

        {/* Rules list — group EN rules with their ALTERNATIEFs */}
        <div className="divide-y divide-border">
          {rules.length === 0 && !showAddForm && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Geen regels in deze combinatie. Voeg een regel toe.
            </div>
          )}

          {enRules.map((enRule, enIdx) => {
            const alts = altRules.filter(a => a.alternativeForId === enRule.id)
            return (
              <Fragment key={enRule.id}>
                {/* EN connector */}
                {enIdx > 0 && (
                  <div className="px-4 py-0.5 bg-muted/20">
                    <span className="text-[10px] font-bold text-blue-600 uppercase">en</span>
                  </div>
                )}

                {/* EN rule */}
                <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getOperatorColor('EN')}`}>EN</span>
                    <span className="text-sm font-semibold tabular-nums">{enRule.quantity}x</span>
                    <span className="text-sm truncate">{enRule.shippingUnitName}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {deleteConfirmId === enRule.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => { onDeleteRule(enRule.id); setDeleteConfirmId(null) }}
                          className="p-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteConfirmId(null)} className="p-1.5 rounded-lg hover:bg-muted">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirmId(enRule.id)}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 opacity-0 group-hover:opacity-100" title="Verwijderen">
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </div>
                </div>

                {/* ALTERNATIEF rules indented under the EN rule */}
                {alts.map(alt => (
                  <div key={alt.id} className="flex items-center justify-between px-4 py-2 pl-12 bg-purple-50/30 hover:bg-purple-50/50 transition-colors">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getOperatorColor('ALTERNATIEF')}`}>ALT</span>
                      <ArrowRight className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="text-sm tabular-nums">{alt.quantity}x</span>
                      <span className="text-sm truncate text-muted-foreground">{alt.shippingUnitName}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {deleteConfirmId === alt.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => { onDeleteRule(alt.id); setDeleteConfirmId(null) }}
                            className="p-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleteConfirmId(null)} className="p-1.5 rounded-lg hover:bg-muted">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(alt.id)}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 opacity-0 group-hover:opacity-100">
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </Fragment>
            )
          })}

          {/* Orphaned ALTERNATIEF rules (no matching EN) */}
          {altRules.filter(a => !enRules.some(e => e.id === a.alternativeForId)).map(rule => (
            <div key={rule.id} className="flex items-center justify-between px-4 py-3 bg-amber-50/30">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getOperatorColor(rule.operator)}`}>
                  {rule.operator}
                </span>
                <span className="text-sm font-medium">{rule.quantity}x</span>
                <span className="text-sm truncate">{rule.shippingUnitName}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Add rule */}
        <div className="px-4 py-3 border-t border-border">
          {showAddForm ? (
            <AddRuleForm ruleGroup={groupNumber} packagingId={packagingId} shippingUnits={shippingUnits}
              enRulesInGroup={enRules} onAdd={async (r) => { await onAddRule(r); setShowAddForm(false) }}
              onCancel={() => setShowAddForm(false)} nextSortOrder={nextSortOrder} />
          ) : (
            <button onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Plus className="w-4 h-4" />Regel toevoegen
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Packaging Overview Card ─────────────────────────────────────────────────

interface PackagingOverviewProps {
  packaging: { id: string; name: string; useInAutoAdvice: boolean }
  ruleCount: number
  groupCount: number
  isSelected: boolean
  onClick: () => void
}

function PackagingOverviewCard({ packaging, ruleCount, groupCount, isSelected, onClick }: PackagingOverviewProps) {
  const hasRules = ruleCount > 0
  const inAutoAdvice = packaging.useInAutoAdvice

  let statusColor = 'bg-gray-100 text-gray-600 border-gray-200'
  let statusText = 'Niet in auto-advies'
  if (inAutoAdvice && hasRules) {
    statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-200'
    statusText = `${groupCount} combinatie${groupCount !== 1 ? 's' : ''}`
  } else if (inAutoAdvice && !hasRules) {
    statusColor = 'bg-amber-50 text-amber-700 border-amber-200'
    statusText = 'Geen regels'
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
          : 'border-border bg-card hover:bg-muted/30'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{packaging.name}</span>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${statusColor}`}>
          {statusText}
        </span>
      </div>
    </button>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function CompartmentRules() {
  const { packagings, isLoading: packagingsLoading } = useLocalPackagings(true)
  const [selectedPackagingId, setSelectedPackagingId] = useState<string>('')

  // Fetch ALL rules (no filter) for overview counts
  const {
    rules: allRules,
    isLoading: allRulesLoading,
  } = useCompartmentRules()

  // Fetch rules for selected packaging
  const {
    rules,
    isLoading: rulesLoading,
    error,
    addRule,
    removeRule,
    refresh,
  } = useCompartmentRules(selectedPackagingId || undefined)

  const { shippingUnits, isLoading: unitsLoading } = useShippingUnits()

  // Rule counts per packaging (from all rules)
  const packagingStats = useMemo(() => {
    const stats: Record<string, { rules: number; groups: Set<number> }> = {}
    for (const r of allRules) {
      if (!stats[r.packagingId]) stats[r.packagingId] = { rules: 0, groups: new Set() }
      stats[r.packagingId].rules++
      stats[r.packagingId].groups.add(r.ruleGroup)
    }
    return stats
  }, [allRules])

  // KPIs
  const kpis = useMemo(() => {
    const autoAdvice = packagings.filter(p => p.useInAutoAdvice)
    const withRules = autoAdvice.filter(p => packagingStats[p.id]?.rules > 0)
    const withoutRules = autoAdvice.filter(p => !packagingStats[p.id]?.rules)
    return { total: autoAdvice.length, withRules: withRules.length, withoutRules: withoutRules.length }
  }, [packagings, packagingStats])

  // Uncovered shipping units: units that exist but appear in zero compartment rules
  const uncoveredUnits = useMemo(() => {
    const coveredUnitIds = new Set(allRules.map(r => r.shippingUnitId))
    return shippingUnits.filter(u => !coveredUnitIds.has(u.id))
  }, [allRules, shippingUnits])

  // Group rules by rule_group for the selected packaging
  const ruleGroups = useMemo(() => {
    const groups: Record<number, CompartmentRule[]> = {}
    for (const rule of rules) {
      if (!groups[rule.ruleGroup]) groups[rule.ruleGroup] = []
      groups[rule.ruleGroup].push(rule)
    }
    return groups
  }, [rules])

  const groupNumbers = useMemo(() => Object.keys(ruleGroups).map(Number).sort((a, b) => a - b), [ruleGroups])
  const nextGroupNumber = useMemo(() => groupNumbers.length === 0 ? 1 : Math.max(...groupNumbers) + 1, [groupNumbers])

  const handleAddRuleGroup = useCallback(async () => {
    if (!selectedPackagingId || shippingUnits.length === 0) return
    try {
      await addRule({
        packagingId: selectedPackagingId,
        ruleGroup: nextGroupNumber,
        shippingUnitId: shippingUnits[0].id,
        quantity: 1,
        operator: 'EN',
        sortOrder: 0,
      })
    } catch { /* handled by hook */ }
  }, [selectedPackagingId, shippingUnits, addRule, nextGroupNumber])

  const handleDeleteGroup = useCallback(async (groupNumber: number) => {
    const groupRules = ruleGroups[groupNumber] || []
    for (const rule of groupRules) {
      try { await removeRule(rule.id) } catch { /* continue */ }
    }
  }, [ruleGroups, removeRule])

  const selectedPackaging = packagings.find((p) => p.id === selectedPackagingId)
  const isDataLoading = packagingsLoading || unitsLoading || allRulesLoading

  if (isDataLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-lg text-muted-foreground">Gegevens laden...</p>
      </div>
    )
  }

  // Sort packagings: auto-advice first (without rules first), then rest
  const sortedPackagings = [...packagings].sort((a, b) => {
    const aAuto = a.useInAutoAdvice ? 1 : 0
    const bAuto = b.useInAutoAdvice ? 1 : 0
    if (aAuto !== bAuto) return bAuto - aAuto // auto-advice first
    const aHasRules = (packagingStats[a.id]?.rules ?? 0) > 0 ? 1 : 0
    const bHasRules = (packagingStats[b.id]?.rules ?? 0) > 0 ? 1 : 0
    if (aHasRules !== bHasRules) return aHasRules - bHasRules // without rules first (need attention)
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Box className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Compartiment Regels</h2>
            <p className="text-sm text-muted-foreground">
              Welke combinaties van producten passen in welke doos
            </p>
          </div>
        </div>
        <button onClick={refresh} className="p-2 rounded-lg hover:bg-muted transition-colors" title="Vernieuwen">
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="p-3 bg-card border border-border rounded-lg text-center">
          <div className="text-2xl font-bold">{kpis.total}</div>
          <div className="text-xs text-muted-foreground">In auto-advies</div>
        </div>
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
          <div className="text-2xl font-bold text-emerald-700">{kpis.withRules}</div>
          <div className="text-xs text-emerald-600">Dozen met regels</div>
        </div>
        <div className={`p-3 rounded-lg text-center border ${kpis.withoutRules > 0 ? 'bg-amber-50 border-amber-200' : 'bg-card border-border'}`}>
          <div className={`text-2xl font-bold ${kpis.withoutRules > 0 ? 'text-amber-700' : ''}`}>{kpis.withoutRules}</div>
          <div className={`text-xs ${kpis.withoutRules > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>Dozen zonder regels</div>
        </div>
        <div className={`p-3 rounded-lg text-center border ${uncoveredUnits.length > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className={`text-2xl font-bold ${uncoveredUnits.length > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{uncoveredUnits.length}</div>
          <div className={`text-xs ${uncoveredUnits.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>Ongedekte eenheden</div>
        </div>
      </div>

      {/* Uncovered shipping units warning */}
      {uncoveredUnits.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900">
                {uncoveredUnits.length} verzendeenhe{uncoveredUnits.length === 1 ? 'id' : 'den'} zonder compartimentregels
              </p>
              <p className="text-xs text-amber-700 mt-0.5 mb-2">
                Producten in deze eenheden kunnen niet automatisch aan een doos worden gekoppeld.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {uncoveredUnits.map(u => (
                  <span key={u.id} className="inline-flex items-center px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-mono">
                    {u.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two-column layout: packaging list + rule detail */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: Packaging list */}
        <div className="w-full lg:w-[280px] shrink-0 space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground uppercase mb-2">Verpakkingen</div>
          {sortedPackagings.map(pkg => (
            <PackagingOverviewCard
              key={pkg.id}
              packaging={pkg}
              ruleCount={packagingStats[pkg.id]?.rules ?? 0}
              groupCount={packagingStats[pkg.id]?.groups.size ?? 0}
              isSelected={selectedPackagingId === pkg.id}
              onClick={() => setSelectedPackagingId(pkg.id)}
            />
          ))}
        </div>

        {/* Right: Rule detail */}
        <div className="flex-1 min-w-0">
          {/* Error banner */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />{error.message}
            </div>
          )}

          {/* No packaging selected */}
          {!selectedPackagingId && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <Box className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-1">Selecteer een verpakking</h3>
              <p className="text-sm text-muted-foreground">
                Kies links een verpakking om de compartiment regels te bekijken en bewerken.
              </p>
            </div>
          )}

          {/* Rules loading */}
          {selectedPackagingId && rulesLoading && (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">Regels laden...</span>
            </div>
          )}

          {/* Rules content */}
          {selectedPackagingId && !rulesLoading && (
            <>
              {/* Packaging info header */}
              {selectedPackaging && (
                <div className="mb-4 p-3 bg-muted/50 rounded-lg flex items-center gap-3">
                  <Box className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold">{selectedPackaging.name}</span>
                    {selectedPackaging.length && selectedPackaging.width && selectedPackaging.height && (
                      <span className="text-xs text-muted-foreground ml-2">
                        ({selectedPackaging.length} x {selectedPackaging.width} x {selectedPackaging.height} cm)
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {groupNumbers.length} combinatie{groupNumbers.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {/* Status banner */}
              {selectedPackaging?.useInAutoAdvice && groupNumbers.length === 0 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-sm text-amber-800">
                    Deze verpakking staat in auto-advies maar heeft nog geen regels.
                    Voeg combinaties toe zodat de engine deze doos kan adviseren.
                  </p>
                </div>
              )}

              {/* Empty state */}
              {groupNumbers.length === 0 && (
                <div className="text-center py-8 mb-4">
                  <p className="text-sm text-muted-foreground mb-4">
                    Nog geen combinaties. Voeg er een toe om te beginnen.
                  </p>
                </div>
              )}

              {/* Rule groups */}
              <div className="space-y-2 mb-4">
                {groupNumbers.map((groupNum, idx) => (
                  <RuleGroupCard
                    key={groupNum}
                    groupNumber={groupNum}
                    groupIndex={idx}
                    totalGroups={groupNumbers.length}
                    rules={ruleGroups[groupNum]}
                    packagingId={selectedPackagingId}
                    shippingUnits={shippingUnits}
                    onAddRule={async (r) => { await addRule(r) }}
                    onDeleteRule={removeRule}
                    onDeleteGroup={() => handleDeleteGroup(groupNum)}
                  />
                ))}
              </div>

              {/* Add group button */}
              <button onClick={handleAddRuleGroup}
                className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                <Plus className="w-4 h-4" />
                Nieuwe combinatie toevoegen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

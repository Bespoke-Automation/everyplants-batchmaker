'use client'

import { useState, useMemo } from 'react'
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
} from 'lucide-react'
import { useCompartmentRules, useShippingUnits } from '@/hooks/useCompartmentRules'
import type { CompartmentRule, ShippingUnit } from '@/hooks/useCompartmentRules'
import { useLocalPackagings } from '@/hooks/useLocalPackagings'
import type { LocalPackaging } from '@/types/verpakking'

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

  // Group shipping units by product type
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
        {/* Shipping unit */}
        <div className="sm:col-span-5">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Shipping unit</label>
          <select
            value={shippingUnitId}
            onChange={(e) => setShippingUnitId(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary min-h-[44px]"
          >
            <option value="">Selecteer...</option>
            {Object.entries(groupedUnits).map(([type, units]) => (
              <optgroup key={type} label={type}>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Quantity */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Aantal</label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary min-h-[44px]"
          />
        </div>

        {/* Operator */}
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Operator</label>
          <select
            value={operator}
            onChange={(e) => {
              setOperator(e.target.value)
              if (e.target.value !== 'ALTERNATIEF') {
                setAlternativeForId(null)
              }
            }}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary min-h-[44px]"
          >
            {OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div className="sm:col-span-2 flex items-center gap-1">
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="flex items-center justify-center gap-1 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px] flex-1"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="flex items-center justify-center px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors min-h-[44px]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Alternative for selection (only shown for ALTERNATIEF) */}
      {operator === 'ALTERNATIEF' && (
        <div className="mt-3">
          <label className="block text-xs font-medium mb-1 text-muted-foreground">Alternatief voor (EN-regel)</label>
          <select
            value={alternativeForId ?? ''}
            onChange={(e) => setAlternativeForId(e.target.value || null)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary min-h-[44px]"
          >
            <option value="">Selecteer EN-regel...</option>
            {enRulesInGroup.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.quantity}x {rule.shippingUnitName}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}

// ── Rule Group Card ──────────────────────────────────────────────────────────

interface RuleGroupCardProps {
  groupNumber: number
  rules: CompartmentRule[]
  packagingId: string
  shippingUnits: ShippingUnit[]
  onAddRule: (rule: {
    packagingId: string
    ruleGroup: number
    shippingUnitId: string
    quantity: number
    operator: string
    alternativeForId: string | null
    sortOrder: number
  }) => Promise<void>
  onDeleteRule: (id: string) => Promise<void>
  onDeleteGroup: () => void
}

function RuleGroupCard({
  groupNumber,
  rules,
  packagingId,
  shippingUnits,
  onAddRule,
  onDeleteRule,
  onDeleteGroup,
}: RuleGroupCardProps) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(false)

  const enRules = rules.filter((r) => r.operator === 'EN')
  const nextSortOrder = rules.length > 0 ? Math.max(...rules.map((r) => r.sortOrder)) + 1 : 0

  // Build a human-readable summary
  const summary = rules
    .map((r) => {
      const prefix = r.operator !== 'EN' ? `(${r.operator}) ` : ''
      return `${prefix}${r.quantity}x ${r.shippingUnitName}`
    })
    .join(' + ')

  const handleAddRule = async (rule: {
    packagingId: string
    ruleGroup: number
    shippingUnitId: string
    quantity: number
    operator: string
    alternativeForId: string | null
    sortOrder: number
  }) => {
    await onAddRule(rule)
    setShowAddForm(false)
  }

  const handleDeleteRule = async (id: string) => {
    await onDeleteRule(id)
    setDeleteConfirmId(null)
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Group header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Regelgroep {groupNumber}</span>
          {rules.length > 0 && (
            <span className="text-xs text-muted-foreground">
              — {summary}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {deleteGroupConfirm ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-destructive mr-1">Groep verwijderen?</span>
              <button
                onClick={() => {
                  onDeleteGroup()
                  setDeleteGroupConfirm(false)
                }}
                className="p-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                title="Bevestig verwijdering"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDeleteGroupConfirm(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                title="Annuleren"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteGroupConfirm(true)}
              className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
              title="Regelgroep verwijderen"
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          )}
        </div>
      </div>

      {/* Rules list */}
      <div className="divide-y divide-border">
        {rules.length === 0 && !showAddForm && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Geen regels in deze groep. Voeg een regel toe.
          </div>
        )}

        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getOperatorColor(rule.operator)}`}>
                {rule.operator}
              </span>
              <span className="text-sm font-medium">
                {rule.quantity}x
              </span>
              <span className="text-sm truncate">
                {rule.shippingUnitName}
              </span>
              {rule.operator === 'ALTERNATIEF' && rule.alternativeForId && (
                <span className="text-xs text-muted-foreground">
                  (vervangt: {rules.find((r) => r.id === rule.alternativeForId)?.shippingUnitName ?? '?'})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {deleteConfirmId === rule.id ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-destructive mr-1">Wis?</span>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(rule.id)}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
                  title="Verwijderen"
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add rule section */}
      <div className="px-4 py-3 border-t border-border">
        {showAddForm ? (
          <AddRuleForm
            ruleGroup={groupNumber}
            packagingId={packagingId}
            shippingUnits={shippingUnits}
            enRulesInGroup={enRules}
            onAdd={handleAddRule}
            onCancel={() => setShowAddForm(false)}
            nextSortOrder={nextSortOrder}
          />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-4 h-4" />
            Regel toevoegen
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function CompartmentRules() {
  const {
    packagings,
    isLoading: packagingsLoading,
  } = useLocalPackagings(true)

  const [selectedPackagingId, setSelectedPackagingId] = useState<string>('')

  const {
    rules,
    isLoading: rulesLoading,
    error,
    addRule,
    removeRule,
    refresh,
  } = useCompartmentRules(selectedPackagingId || undefined)

  const {
    shippingUnits,
    isLoading: unitsLoading,
  } = useShippingUnits()

  // Auto-select first packaging when loaded
  const hasAutoSelected = useState(false)
  if (!hasAutoSelected[0] && packagings.length > 0 && !selectedPackagingId) {
    setSelectedPackagingId(packagings[0].id)
    hasAutoSelected[1](true)
  }

  // Group rules by rule_group
  const ruleGroups = useMemo(() => {
    const groups: Record<number, CompartmentRule[]> = {}
    for (const rule of rules) {
      if (!groups[rule.ruleGroup]) {
        groups[rule.ruleGroup] = []
      }
      groups[rule.ruleGroup].push(rule)
    }
    return groups
  }, [rules])

  const groupNumbers = useMemo(() => {
    return Object.keys(ruleGroups).map(Number).sort((a, b) => a - b)
  }, [ruleGroups])

  const nextGroupNumber = useMemo(() => {
    if (groupNumbers.length === 0) return 1
    return Math.max(...groupNumbers) + 1
  }, [groupNumbers])

  const handleAddRuleGroup = async () => {
    // We don't create a DB record for the group itself,
    // but we need to show the form. We add a placeholder.
    // Adding a rule with the new group number will create the group.
    // For now, just add the first rule.
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
    } catch {
      // Error is handled by the hook
    }
  }

  const handleDeleteGroup = async (groupNumber: number) => {
    const groupRules = ruleGroups[groupNumber] || []
    for (const rule of groupRules) {
      try {
        await removeRule(rule.id)
      } catch {
        // Continue deleting other rules even if one fails
      }
    }
  }

  const handleAddRule = async (rule: {
    packagingId: string
    ruleGroup: number
    shippingUnitId: string
    quantity: number
    operator: string
    alternativeForId: string | null
    sortOrder: number
  }) => {
    await addRule(rule)
  }

  const handleDeleteRule = async (id: string) => {
    await removeRule(id)
  }

  const selectedPackaging = packagings.find((p) => p.id === selectedPackagingId)
  const isDataLoading = packagingsLoading || unitsLoading

  if (isDataLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-lg text-muted-foreground">Gegevens laden...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Box className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Compartiment Regels</h2>
            <p className="text-sm text-muted-foreground">
              Configureer welke combinaties van shipping units in welke doos passen
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          title="Vernieuwen"
        >
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Packaging selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Selecteer verpakking</label>
        <div className="relative">
          <select
            value={selectedPackagingId}
            onChange={(e) => setSelectedPackagingId(e.target.value)}
            className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary appearance-none min-h-[44px]"
          >
            {packagings.length === 0 ? (
              <option value="">Geen verpakkingen beschikbaar</option>
            ) : (
              <>
                <option value="">Selecteer een verpakking...</option>
                {packagings.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name}
                  </option>
                ))}
              </>
            )}
          </select>
          <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message}
        </div>
      )}

      {/* No packaging selected */}
      {!selectedPackagingId && (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Box className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Selecteer een verpakking</h3>
          <p className="text-sm text-muted-foreground">
            Kies een verpakking hierboven om de compartiment regels te bekijken en bewerken.
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
          {/* Packaging info */}
          {selectedPackaging && (
            <div className="mb-4 p-3 bg-muted/50 rounded-lg flex items-center gap-3">
              <Box className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <span className="text-sm font-medium">{selectedPackaging.name}</span>
                {selectedPackaging.length && selectedPackaging.width && selectedPackaging.height && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({selectedPackaging.length} x {selectedPackaging.width} x {selectedPackaging.height} cm)
                  </span>
                )}
              </div>
              <span className="ml-auto text-xs text-muted-foreground">
                {groupNumbers.length} regelgroep{groupNumbers.length !== 1 ? 'en' : ''}
              </span>
            </div>
          )}

          {/* Empty state */}
          {groupNumbers.length === 0 && (
            <div className="text-center py-8 mb-4">
              <p className="text-sm text-muted-foreground mb-4">
                Nog geen regelgroepen voor deze verpakking. Voeg een groep toe om te beginnen.
              </p>
            </div>
          )}

          {/* Rule groups */}
          <div className="space-y-4 mb-4">
            {groupNumbers.map((groupNum) => (
              <RuleGroupCard
                key={groupNum}
                groupNumber={groupNum}
                rules={ruleGroups[groupNum]}
                packagingId={selectedPackagingId}
                shippingUnits={shippingUnits}
                onAddRule={handleAddRule}
                onDeleteRule={handleDeleteRule}
                onDeleteGroup={() => handleDeleteGroup(groupNum)}
              />
            ))}
          </div>

          {/* Add rule group button */}
          <button
            onClick={handleAddRuleGroup}
            className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nieuwe regelgroep toevoegen
          </button>
        </>
      )}
    </div>
  )
}

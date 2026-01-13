'use client'

import { useState, useRef, useEffect } from 'react'
import { Filter, Calendar, ChevronDown, X, Loader2 } from 'lucide-react'
import { FilterState, ALL_RETAILERS } from '@/types/filters'
import { COUNTRIES, COUNTRY_NAMES, DAYS } from '@/constants'
import { Preset } from '@/types/preset'
import PresetNameDialog from '@/components/ui/PresetNameDialog'
import { PostalRegion } from '@/lib/supabase/postalRegions'

interface FilterPanelProps {
  filters: FilterState
  metadata: {
    retailers: string[]
    tags: string[]
    countries: string[]
    leverdagen: string[]
  }
  onFilterChange: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  onReset: () => void
  isLoading: boolean
  hidePPS?: boolean
  onCreatePreset?: (preset: Omit<Preset, 'id'>) => Promise<Preset>
  onCreateBatch?: () => void
  isCreatingBatch?: boolean
  postalRegions?: PostalRegion[]
}

interface MultiSelectDropdownProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  disabled?: boolean
  placeholder?: string
  displayNames?: Record<string, string>
}

function MultiSelectDropdown({ label, options, selected, onChange, disabled, placeholder = 'Select options', displayNames }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const getDisplayName = (option: string) => displayNames?.[option] || option

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(s => s !== option))
    } else {
      onChange([...selected, option])
    }
  }

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary flex items-center justify-between disabled:opacity-50"
      >
        <span className="truncate text-left">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span>{selected.length} selected</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {selected.length > 0 && (
            <span
              onClick={clearAll}
              className="p-0.5 hover:bg-muted rounded"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-60 overflow-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options available</div>
          ) : (
            options.map(option => (
              <label
                key={option}
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggleOption(option)}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="truncate">{getDisplayName(option)}</span>
              </label>
            ))
          )}
        </div>
      )}

      {selected.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selected.slice(0, 3).map(item => (
            <span
              key={item}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded"
            >
              <span className="truncate max-w-[100px]">{getDisplayName(item)}</span>
              <button
                onClick={() => toggleOption(item)}
                className="hover:text-primary/70"
              >
                ×
              </button>
            </span>
          ))}
          {selected.length > 3 && (
            <span className="inline-flex items-center px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded">
              +{selected.length - 3} more
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default function FilterPanel({
  filters,
  metadata,
  onFilterChange,
  onReset,
  isLoading,
  hidePPS = false,
  onCreatePreset,
  onCreateBatch,
  isCreatingBatch = false,
  postalRegions = [],
}: FilterPanelProps) {
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false)
  const [isCreatingPreset, setIsCreatingPreset] = useState(false)

  const availableTags = metadata.tags.length > 0 ? metadata.tags : []
  const availableCountries = COUNTRIES
  const availableDays = metadata.leverdagen.length > 0 ? metadata.leverdagen : DAYS

  const handleRetailerChange = (retailer: string, checked: boolean) => {
    if (checked) {
      onFilterChange('retailers', [...filters.retailers, retailer])
    } else {
      onFilterChange('retailers', filters.retailers.filter(r => r !== retailer))
    }
  }

  const handleMultiSelectChange = (
    key: 'tags' | 'countries' | 'leverdagen',
    value: string
  ) => {
    const currentValues = filters[key]
    if (currentValues.includes(value)) {
      onFilterChange(key, currentValues.filter(v => v !== value))
    } else {
      onFilterChange(key, [...currentValues, value])
    }
  }

  const handleCreatePreset = async (name: string) => {
    if (!onCreatePreset) return

    setIsCreatingPreset(true)
    try {
      const preset: Omit<Preset, 'id'> = {
        naam: name,
        retailer: filters.retailers,
        tags: filters.tags,
        bezorgland: filters.countries,
        leverdag: filters.leverdagen,
        pps: filters.pps === 'ja',
        postal_regions: filters.postalRegions || [],
      }
      await onCreatePreset(preset)
      setIsPresetDialogOpen(false)
    } catch (error) {
      console.error('Failed to create preset:', error)
    } finally {
      setIsCreatingPreset(false)
    }
  }

  return (
    <section className="xl:col-span-4 space-y-4">
      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filters
          </h2>
          <button
            onClick={() => onFilterChange('retailers', ALL_RETAILERS)}
            className="text-xs text-primary font-medium hover:underline"
          >
            Selecteer alles
          </button>
        </div>
        <div className="p-4 space-y-4">
          {/* Retailer Checkboxes */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase mb-2 block">
              Retailer
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_RETAILERS.map(retailer => (
                <label
                  key={retailer}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={filters.retailers.includes(retailer)}
                    onChange={(e) => handleRetailerChange(retailer, e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                    disabled={isLoading}
                  />
                  {retailer}
                </label>
              ))}
            </div>
          </div>

          {/* Tags Dropdown */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
              Tags
            </label>
            <MultiSelectDropdown
              label="Tags"
              options={availableTags}
              selected={filters.tags}
              onChange={(selected) => onFilterChange('tags', selected)}
              disabled={isLoading}
              placeholder="Select tags"
            />
          </div>

          {/* Bezorgland Dropdown */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
              Bezorgland
            </label>
            <MultiSelectDropdown
              label="Bezorgland"
              options={availableCountries}
              selected={filters.countries}
              onChange={(selected) => onFilterChange('countries', selected)}
              disabled={isLoading}
              placeholder="Select countries"
              displayNames={COUNTRY_NAMES}
            />
          </div>

          {/* Postal Region Dropdown */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
              Regio
            </label>
            <MultiSelectDropdown
              label="Regio"
              options={postalRegions.map(r => r.region_id)}
              selected={filters.postalRegions || []}
              onChange={(selected) => onFilterChange('postalRegions', selected.length ? selected : undefined)}
              disabled={isLoading}
              placeholder="Alle regio's"
              displayNames={Object.fromEntries(postalRegions.map(r => [r.region_id, r.name]))}
            />
          </div>

          {/* Leverdag Dropdown & Label */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
                Leverdag
              </label>
              <MultiSelectDropdown
                label="Leverdag"
                options={availableDays}
                selected={filters.leverdagen}
                onChange={(selected) => onFilterChange('leverdagen', selected)}
                disabled={isLoading}
                placeholder="Select days"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
                Label
              </label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Start date - End date"
                  className="pl-9 w-full h-10 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          {/* PPS Radio */}
          {!hidePPS && (
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase mb-2 block">
                PPS <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="pps"
                    checked={filters.pps === 'ja'}
                    onChange={() => onFilterChange('pps', 'ja')}
                    className="w-4 h-4 text-primary focus:ring-primary"
                    disabled={isLoading}
                  />
                  Ja
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="pps"
                    checked={filters.pps === 'nee'}
                    onChange={() => onFilterChange('pps', 'nee')}
                    className="w-4 h-4 text-primary focus:ring-primary"
                    disabled={isLoading}
                  />
                  Nee
                </label>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              className="flex-1 bg-primary text-white font-semibold py-2 rounded-md hover:bg-opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              disabled={isLoading || isCreatingBatch || !onCreateBatch}
              onClick={onCreateBatch}
            >
              {isCreatingBatch ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Batch maken...
                </>
              ) : (
                'Maak batch'
              )}
            </button>
            <button
              onClick={() => setIsPresetDialogOpen(true)}
              className="flex-1 bg-secondary text-secondary-foreground font-semibold py-2 rounded-md hover:bg-opacity-80 transition-all disabled:opacity-50"
              disabled={isLoading || !onCreatePreset}
            >
              Maak preset
            </button>
            <button
              onClick={onReset}
              className="flex-1 bg-destructive text-destructive-foreground font-semibold py-2 rounded-md hover:bg-opacity-90 transition-all disabled:opacity-50"
              disabled={isLoading}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <PresetNameDialog
        open={isPresetDialogOpen}
        onClose={() => setIsPresetDialogOpen(false)}
        onSave={handleCreatePreset}
        isLoading={isCreatingPreset}
      />
    </section>
  )
}

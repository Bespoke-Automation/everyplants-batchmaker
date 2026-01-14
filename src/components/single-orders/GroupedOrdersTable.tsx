'use client'

import { useState, Fragment, useMemo } from 'react'
import { RefreshCw, Package, ChevronDown, ChevronRight } from 'lucide-react'
import { ProductGroup } from '@/types/singleOrder'
import { useTableSearch } from '@/hooks/useTableSearch'
import TableSearch from '@/components/ui/TableSearch'

interface GroupedOrdersTableProps {
  groups: ProductGroup[]
  isLoading: boolean
  onRefresh: () => void
  totalSingleOrders: number
  selectedGroups: ProductGroup[]
  onSelectionChange: (groups: ProductGroup[]) => void
}

const RETAILER_COLORS: Record<string, string> = {
  'Green Bubble': 'bg-green-100 text-green-700 border-green-200',
  'Everspring': 'bg-blue-100 text-blue-700 border-blue-200',
  'Ogreen': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Florafy': 'bg-purple-100 text-purple-700 border-purple-200',
  'Trendyplants': 'bg-orange-100 text-orange-700 border-orange-200',
  'Plantura': 'bg-pink-100 text-pink-700 border-pink-200',
}

export default function GroupedOrdersTable({
  groups,
  isLoading,
  onRefresh,
  totalSingleOrders,
  selectedGroups,
  onSelectionChange,
}: GroupedOrdersTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())

  const searchableFields = useMemo(() => [
    'productName' as const,
    'productCode' as const,
    (group: ProductGroup) => Object.keys(group.retailerBreakdown).join(' '),
    (group: ProductGroup) => group.orders.map(o => o.reference).join(' '),
  ], [])

  const { searchQuery, setSearchQuery, filteredItems: searchedGroups, clearSearch, isSearching } = useTableSearch(
    groups,
    searchableFields
  )

  const toggleExpanded = (productId: number) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId)
    } else {
      newExpanded.add(productId)
    }
    setExpandedGroups(newExpanded)
  }

  const toggleGroupSelection = (group: ProductGroup) => {
    const isSelected = selectedGroups.some(g => g.productId === group.productId)
    if (isSelected) {
      onSelectionChange(selectedGroups.filter(g => g.productId !== group.productId))
    } else {
      onSelectionChange([...selectedGroups, group])
    }
  }

  const toggleSelectAll = () => {
    if (selectedGroups.length === searchedGroups.length) {
      onSelectionChange([])
    } else {
      onSelectionChange([...searchedGroups])
    }
  }

  const isGroupSelected = (group: ProductGroup) =>
    selectedGroups.some(g => g.productId === group.productId)

  const getRetailerColor = (retailer: string) =>
    RETAILER_COLORS[retailer] || 'bg-gray-100 text-gray-700 border-gray-200'

  const totalSelectedOrders = selectedGroups.reduce((sum, g) => sum + g.totalCount, 0)

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between bg-muted/5">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" /> Single Orders by Product
          </h2>
          {selectedGroups.length > 0 && (
            <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-full border border-primary/20">
              {selectedGroups.length} groups selected ({totalSelectedOrders} orders)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TableSearch
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={clearSearch}
            placeholder="Zoek producten..."
            isSearching={isSearching}
          />
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 hover:bg-muted rounded-md transition-all text-muted-foreground disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[500px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading single orders from Picqer...</p>
              <p className="text-xs text-muted-foreground">This may take a moment as we analyze each order</p>
            </div>
          </div>
        ) : searchedGroups.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">No product groups found with 5+ single orders</p>
              <p className="text-xs text-muted-foreground mt-1">Try selecting more retailers or adjusting filters</p>
            </div>
          </div>
        ) : (
          <table className="text-sm text-left w-full">
            <thead className="bg-muted text-muted-foreground uppercase text-xs font-bold sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={selectedGroups.length === searchedGroups.length && searchedGroups.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </th>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 min-w-[250px]">Product Name</th>
                <th className="px-4 py-3 min-w-[120px]">SKU</th>
                <th className="px-4 py-3 w-[100px] text-center">Total Orders</th>
                <th className="px-4 py-3 min-w-[300px]">Retailer Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {searchedGroups.map((group) => (
                <Fragment key={group.productId}>
                  <tr
                    className={`hover:bg-muted/50 transition-colors ${isGroupSelected(group) ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={isGroupSelected(group)}
                        onChange={() => toggleGroupSelection(group)}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => toggleExpanded(group.productId)}
                        className="p-1 hover:bg-muted rounded transition-colors"
                      >
                        {expandedGroups.has(group.productId) ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-medium">{group.productName}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-mono text-muted-foreground text-xs bg-muted px-2 py-1 rounded">
                        {group.productCode}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded-full">
                        {group.totalCount}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(group.retailerBreakdown)
                          .sort(([, a], [, b]) => b - a)
                          .map(([retailer, count]) => (
                            <span
                              key={retailer}
                              className={`px-2 py-1 rounded text-xs font-semibold border ${getRetailerColor(retailer)}`}
                            >
                              {retailer}: {count}
                            </span>
                          ))}
                      </div>
                    </td>
                  </tr>
                  {expandedGroups.has(group.productId) && (
                    <tr>
                      <td colSpan={6} className="bg-muted/30 px-8 py-3">
                        <div className="text-xs">
                          <div className="font-bold text-muted-foreground uppercase mb-2">
                            Orders in this group
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
                            {group.orders.map((order) => (
                              <div
                                key={order.id}
                                className="bg-card border border-border rounded px-3 py-2 flex items-center justify-between"
                              >
                                <div>
                                  <span className="font-mono text-muted-foreground">{order.reference}</span>
                                  <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold border ${getRetailerColor(order.retailerName)}`}>
                                    {order.retailerName}
                                  </span>
                                </div>
                                <span className="text-muted-foreground">{order.bezorgland}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {isLoading ? 'Loading...' : `${searchedGroups.length} product groups${searchQuery ? ' (searched)' : ''} | ${totalSingleOrders} total single orders`}
      </div>
    </div>
  )
}

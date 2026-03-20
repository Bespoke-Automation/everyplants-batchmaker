/**
 * Box Optimizer — Finds the cheapest combination of boxes for a multi-product order.
 *
 * Given an order's shipping units and quantities, evaluates all feasible box combinations
 * and returns the one with the lowest total cost for the specific destination country.
 *
 * Uses branch-and-bound for small orders (≤12 total units) and greedy-with-improvement
 * for larger orders, with a hard timeout to guarantee real-time performance.
 *
 * Key insight: the cheapest combination depends on the DESTINATION COUNTRY because
 * carrier rates vary per country. A half-pallet might be cheap to Germany but expensive
 * to France, making multiple small parcels cheaper for France.
 */

import type { CostEntry } from './costProvider'
import { selectCostForWeight } from './costProvider'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ShippingUnitDemand {
  id: string
  name: string
  quantity: number
}

export interface BoxCandidate {
  packagingId: string
  packagingName: string
  idpackaging: number
  facturatieBoxSku: string | null
  /** Which units this candidate covers and how many */
  assignment: Map<string, number> // unitId → quantity
  /** Cost for this specific box (looked up per country) */
  cost: CostEntry | null
  totalCost: number
}

export interface OptimalSolution {
  boxes: BoxCandidate[]
  totalCost: number
  /** All units covered? */
  isComplete: boolean
  /** Which units remain uncovered (if incomplete) */
  uncoveredUnits: Map<string, number>
}

export interface PackagingInfo {
  id: string
  name: string
  idpackaging: number
  facturatieBoxSku: string | null
}

// ── Optimizer ──────────────────────────────────────────────────────────────

const TIMEOUT_MS = 500
const MAX_CANDIDATES = 500

/**
 * Find the cheapest box combination for the given demand and country.
 *
 * @param demand - shipping units that need packing (id → {name, quantity})
 * @param capacities - Map<packagingId, Map<shippingUnitId, maxQuantity>>
 * @param packagingInfo - metadata per packaging (name, idpackaging, facturatie_box_sku)
 * @param costMap - cost entries per box SKU for the destination country
 * @param productWeights - optional weight per unit type in grams (for weight bracket selection)
 */
export function solveOptimalBoxes(
  demand: Map<string, ShippingUnitDemand>,
  capacities: Map<string, Map<string, number>>,
  packagingInfo: Map<string, PackagingInfo>,
  costMap: Map<string, CostEntry[]> | null,
  productWeights?: Map<string, number> // unitId → avg weight in grams
): OptimalSolution {
  const startTime = Date.now()
  const totalUnits = Array.from(demand.values()).reduce((s, d) => s + d.quantity, 0)

  // Phase 1: Generate candidates
  const candidates = generateCandidates(demand, capacities, packagingInfo, costMap, productWeights)

  if (candidates.length === 0) {
    return {
      boxes: [],
      totalCost: 0,
      isComplete: false,
      uncoveredUnits: new Map(Array.from(demand.entries()).map(([id, d]) => [id, d.quantity])),
    }
  }

  // Sort candidates by cost-per-unit (cheapest first for pruning efficiency)
  candidates.sort((a, b) => {
    const aPerUnit = a.totalCost / Math.max(1, sumAssignment(a.assignment))
    const bPerUnit = b.totalCost / Math.max(1, sumAssignment(b.assignment))
    return aPerUnit - bPerUnit
  })

  // Compute cheapest cost per unit across all candidates (for lower-bound pruning)
  const cheapestPerUnit = candidates.length > 0
    ? Math.min(...candidates.map(c => c.totalCost / Math.max(1, sumAssignment(c.assignment))))
    : Infinity

  // Phase 2: Branch-and-bound
  const demandMap = new Map(
    Array.from(demand.entries()).map(([id, d]) => [id, { id, name: d.name, remaining: d.quantity }])
  )

  let bestSolution: OptimalSolution = {
    boxes: [],
    totalCost: Infinity,
    isComplete: false,
    uncoveredUnits: new Map(Array.from(demandMap.entries()).map(([id, d]) => [id, d.remaining])),
  }

  // For very large candidate sets, use greedy first as upper bound
  if (candidates.length > 50 || totalUnits > 8) {
    bestSolution = greedySolve(cloneDemandMap(demandMap), candidates, startTime)
  }

  // Branch-and-bound (skip for very large problems)
  if (totalUnits <= 15 && candidates.length <= MAX_CANDIDATES) {
    const bbResult = branchAndBound(
      cloneDemandMap(demandMap),
      candidates,
      [],
      0,
      bestSolution.totalCost,
      startTime,
      0,
      cheapestPerUnit
    )
    if (bbResult && bbResult.totalCost < bestSolution.totalCost) {
      bestSolution = bbResult
    }
  }

  return bestSolution
}

// ── Candidate Generation ───────────────────────────────────────────────────

function generateCandidates(
  demand: Map<string, ShippingUnitDemand>,
  capacities: Map<string, Map<string, number>>,
  packagingInfo: Map<string, PackagingInfo>,
  costMap: Map<string, CostEntry[]> | null,
  productWeights?: Map<string, number>
): BoxCandidate[] {
  const candidates: BoxCandidate[] = []
  const demandEntries = Array.from(demand.entries())

  for (const [packagingId, unitCapacities] of capacities) {
    const info = packagingInfo.get(packagingId)
    if (!info) continue

    // Which demand units can this box hold?
    const relevantUnits = demandEntries.filter(([unitId]) => unitCapacities.has(unitId))
    if (relevantUnits.length === 0) continue

    // Look up cost for this box
    let costEntries: CostEntry[] | undefined
    if (costMap && info.facturatieBoxSku) {
      costEntries = costMap.get(info.facturatieBoxSku) ?? undefined
    }

    // Generate single-type fills
    for (const [unitId, unitDemand] of relevantUnits) {
      const maxCap = unitCapacities.get(unitId) ?? 0
      const maxFill = Math.min(unitDemand.quantity, maxCap)

      for (let qty = 1; qty <= maxFill; qty++) {
        const assignment = new Map<string, number>()
        assignment.set(unitId, qty)

        const weight = productWeights ? (productWeights.get(unitId) ?? 0) * qty : 0
        const cost = costEntries ? selectCostForWeight(costEntries, weight) : null

        candidates.push({
          packagingId,
          packagingName: info.name,
          idpackaging: info.idpackaging,
          facturatieBoxSku: info.facturatieBoxSku,
          assignment,
          cost,
          totalCost: cost?.totalCost ?? Infinity,
        })
      }
    }

    // Generate mixed fills (pairs of unit types)
    if (relevantUnits.length >= 2) {
      for (let i = 0; i < relevantUnits.length; i++) {
        for (let j = i + 1; j < relevantUnits.length; j++) {
          const [unitIdA, demandA] = relevantUnits[i]
          const [unitIdB, demandB] = relevantUnits[j]
          const maxCapA = unitCapacities.get(unitIdA) ?? 0
          const maxCapB = unitCapacities.get(unitIdB) ?? 0

          if (maxCapA === 0 || maxCapB === 0) continue

          // Proportional filling: qA/maxA + qB/maxB <= 1.0
          const maxQtyA = Math.min(demandA.quantity, maxCapA)
          for (let qA = 1; qA <= maxQtyA; qA++) {
            const remainingRatio = 1.0 - (qA / maxCapA)
            const maxQtyB = Math.min(
              demandB.quantity,
              Math.floor(remainingRatio * maxCapB)
            )
            if (maxQtyB < 1) continue

            for (let qB = 1; qB <= maxQtyB; qB++) {
              const assignment = new Map<string, number>()
              assignment.set(unitIdA, qA)
              assignment.set(unitIdB, qB)

              const weight = productWeights
                ? (productWeights.get(unitIdA) ?? 0) * qA + (productWeights.get(unitIdB) ?? 0) * qB
                : 0
              const cost = costEntries ? selectCostForWeight(costEntries, weight) : null

              candidates.push({
                packagingId,
                packagingName: info.name,
                idpackaging: info.idpackaging,
                facturatieBoxSku: info.facturatieBoxSku,
                assignment,
                cost,
                totalCost: cost?.totalCost ?? Infinity,
              })
            }

            // Cap total candidates
            if (candidates.length > MAX_CANDIDATES * 2) break
          }
          if (candidates.length > MAX_CANDIDATES * 2) break
        }
        if (candidates.length > MAX_CANDIDATES * 2) break
      }
    }
  }

  // Remove candidates without cost data (they can't be optimized on cost)
  // Keep them only if ALL candidates lack cost data (fall back to any-box mode)
  const withCost = candidates.filter(c => c.totalCost < Infinity)
  if (withCost.length > 0) {
    return withCost.slice(0, MAX_CANDIDATES)
  }

  return candidates.slice(0, MAX_CANDIDATES)
}

// ── Branch and Bound ───────────────────────────────────────────────────────

interface DemandState {
  id: string
  name: string
  remaining: number
}

function cloneDemandMap(demand: Map<string, DemandState>): Map<string, DemandState> {
  const clone = new Map<string, DemandState>()
  for (const [id, d] of demand) {
    clone.set(id, { ...d })
  }
  return clone
}

function demandTotalRemaining(demand: Map<string, DemandState>): number {
  let total = 0
  for (const d of demand.values()) total += d.remaining
  return total
}

function hasRemainingDemand(demand: Map<string, DemandState>): boolean {
  for (const d of demand.values()) {
    if (d.remaining > 0) return true
  }
  return false
}

function branchAndBound(
  demand: Map<string, DemandState>,
  candidates: BoxCandidate[],
  currentBoxes: BoxCandidate[],
  currentCost: number,
  bestCost: number,
  startTime: number,
  startIndex: number,
  cheapestPerUnit: number
): OptimalSolution | null {
  // Timeout check
  if (Date.now() - startTime > TIMEOUT_MS) return null

  // Check if all demand is satisfied
  const totalRemaining = demandTotalRemaining(demand)
  if (totalRemaining === 0) {
    return {
      boxes: [...currentBoxes],
      totalCost: currentCost,
      isComplete: true,
      uncoveredUnits: new Map(),
    }
  }

  // Lower bound pruning: even the cheapest possible boxes can't beat best
  if (currentCost >= bestCost) return null

  // Lower bound: remaining units * cheapest cost per unit from any candidate
  const lowerBound = totalRemaining * cheapestPerUnit
  if (currentCost + lowerBound >= bestCost) return null

  let best: OptimalSolution | null = null
  let localBestCost = bestCost

  for (let i = startIndex; i < candidates.length; i++) {
    const candidate = candidates[i]

    // Can this candidate cover any remaining demand?
    let covers = false
    for (const [unitId, qty] of candidate.assignment) {
      const demandItem = demand.get(unitId)
      if (demandItem && demandItem.remaining > 0 && qty > 0) {
        covers = true
        break
      }
    }
    if (!covers) continue

    // Apply candidate: reduce demand
    const newDemand = cloneDemandMap(demand)
    let valid = true
    for (const [unitId, qty] of candidate.assignment) {
      const demandItem = demand.get(unitId)
      const newDemandItem = newDemand.get(unitId)
      if (!demandItem || !newDemandItem) {
        if (qty > 0) { valid = false; break }
        continue
      }
      if (qty > demandItem.remaining) {
        // Adjust: only assign what's available
        const actual = Math.min(qty, demandItem.remaining)
        if (actual === 0) { valid = false; break }
        newDemandItem.remaining = Math.max(0, demandItem.remaining - actual)
      } else {
        newDemandItem.remaining = Math.max(0, demandItem.remaining - qty)
      }
    }
    if (!valid) continue

    const newCost = currentCost + candidate.totalCost

    // Pruning
    if (newCost >= localBestCost) continue

    // Recurse — only consider candidates at index >= i to avoid permutations
    const result = branchAndBound(
      newDemand,
      candidates,
      [...currentBoxes, candidate],
      newCost,
      localBestCost,
      startTime,
      i, // allow same box type again (index i, not i+1)
      cheapestPerUnit
    )

    if (result && result.isComplete && result.totalCost < localBestCost) {
      localBestCost = result.totalCost
      best = result
    }
  }

  return best
}

// ── Greedy Solver (fallback / upper bound) ─────────────────────────────────

function greedySolve(
  demand: Map<string, DemandState>,
  candidates: BoxCandidate[],
  startTime: number
): OptimalSolution {
  const boxes: BoxCandidate[] = []
  let totalCost = 0

  while (hasRemainingDemand(demand)) {
    if (Date.now() - startTime > TIMEOUT_MS) break

    // Find the candidate with the best cost-per-covered-unit
    let bestCandidate: BoxCandidate | null = null
    let bestScore = Infinity

    for (const candidate of candidates) {
      let coveredUnits = 0
      for (const [unitId, qty] of candidate.assignment) {
        const d = demand.get(unitId)
        if (d) coveredUnits += Math.min(qty, d.remaining)
      }
      if (coveredUnits === 0) continue

      const score = candidate.totalCost / coveredUnits
      if (score < bestScore) {
        bestScore = score
        bestCandidate = candidate
      }
    }

    if (!bestCandidate) break

    // Apply
    for (const [unitId, qty] of bestCandidate.assignment) {
      const d = demand.get(unitId)
      if (d) d.remaining = Math.max(0, d.remaining - qty)
    }
    boxes.push(bestCandidate)
    totalCost += bestCandidate.totalCost
  }

  const uncovered = new Map<string, number>()
  for (const d of demand.values()) {
    if (d.remaining > 0) uncovered.set(d.id, d.remaining)
  }

  return {
    boxes,
    totalCost,
    isComplete: uncovered.size === 0,
    uncoveredUnits: uncovered,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sumAssignment(assignment: Map<string, number>): number {
  let sum = 0
  for (const qty of assignment.values()) sum += qty
  return sum
}

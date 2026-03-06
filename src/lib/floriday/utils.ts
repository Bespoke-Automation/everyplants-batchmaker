// ══════════════════════════════════════════════════════════════
// Floriday ISO Week Utilities
// ══════════════════════════════════════════════════════════════

/**
 * Bereken het ISO 8601 weeknummer voor een datum.
 * ISO weken starten op maandag; week 1 bevat de eerste donderdag van het jaar.
 */
export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // Zet naar dichtstbijzijnde donderdag: huidige dag + 4 - dagnummer (ma=1, zo=7)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return { year: d.getUTCFullYear(), week: weekNo }
}

/**
 * Geeft een array van N ISO weken vanaf vandaag.
 * Bijv. getNextNWeeks(6) → [{year:2026, week:10}, ..., {year:2026, week:15}]
 */
export function getNextNWeeks(n: number): Array<{ year: number; week: number }> {
  const weeks: Array<{ year: number; week: number }> = []
  const today = new Date()

  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i * 7)
    const w = getISOWeek(d)
    // Voorkom duplicaten bij jaargrens
    if (weeks.length === 0 || weekKey(w.year, w.week) !== weekKey(weeks[weeks.length - 1].year, weeks[weeks.length - 1].week)) {
      weeks.push(w)
    } else {
      // Schuif een extra dag op om volgende week te pakken
      d.setDate(d.getDate() + 1)
      weeks.push(getISOWeek(d))
    }
  }

  return weeks
}

/**
 * Format jaar + week als "2026-W10" string (voor Map keys).
 */
export function weekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * Converteer een delivery_date string (YYYY-MM-DD) naar ISO week.
 */
export function dateToISOWeek(dateStr: string): { year: number; week: number } {
  return getISOWeek(new Date(dateStr))
}

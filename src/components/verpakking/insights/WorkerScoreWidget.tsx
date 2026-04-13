'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface WorkerRow {
  workerId: number
  followRate: number | null
  vsAverage: number
  totalSessions: number
}

/**
 * Small widget for the verpakkingsmodule main screen. Shows the current
 * worker's follow rate and trend compared to average. Only renders when
 * a worker is selected (workerId > 0).
 */
export default function WorkerScoreWidget({ workerId }: { workerId: number }) {
  const [data, setData] = useState<WorkerRow | null>(null)

  const fetchScore = useCallback(async () => {
    if (!workerId) return
    try {
      const res = await fetch('/api/verpakking/insights/workers')
      if (!res.ok) return
      const json = await res.json()
      const rows = json.rows as WorkerRow[]
      const me = rows.find((r) => r.workerId === workerId)
      if (me) setData(me)
    } catch {
      // Non-critical — widget silently fails
    }
  }, [workerId])

  useEffect(() => {
    fetchScore()
  }, [fetchScore])

  if (!data || data.followRate === null) return null

  const TrendIcon =
    data.vsAverage > 2 ? TrendingUp : data.vsAverage < -2 ? TrendingDown : Minus
  const trendColor =
    data.vsAverage > 2
      ? 'text-emerald-700'
      : data.vsAverage < -2
        ? 'text-red-700'
        : 'text-muted-foreground'

  return (
    <Link
      href={`/verpakkingsmodule/insights/workers/${workerId}`}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted/50 border border-border rounded-lg text-xs hover:bg-muted transition-colors"
      title="Bekijk jouw prestaties"
    >
      <span className="font-medium">{data.followRate.toFixed(0)}% gevolgd</span>
      <span className={`flex items-center gap-0.5 ${trendColor}`}>
        <TrendIcon className="w-3 h-3" />
        {data.vsAverage >= 0 ? '+' : ''}
        {data.vsAverage.toFixed(0)}pp
      </span>
    </Link>
  )
}

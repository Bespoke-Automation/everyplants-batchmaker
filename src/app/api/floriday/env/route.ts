import { NextResponse } from 'next/server'
import { getFloridayEnv } from '@/lib/floriday/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ env: getFloridayEnv() })
}

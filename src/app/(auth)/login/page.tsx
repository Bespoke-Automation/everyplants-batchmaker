'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Lock } from 'lucide-react'
import { createAuthBrowserClient } from '@/lib/supabase/browser'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const supabase = createAuthBrowserClient()

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam === 'invalid_code' || errorParam === 'missing_code') {
      setError('De resetlink is ongeldig of verlopen. Vraag een nieuwe aan.')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        if (authError.status === 429 || authError.code === 'over_request_rate_limit') {
          setError('Te veel loginpogingen. Wacht ongeveer 5 minuten en probeer opnieuw.')
        } else {
          setError('Ongeldig e-mailadres of wachtwoord')
        }
        setLoading(false)
      } else {
        // Hard redirect so middleware picks up the new Supabase cookies
        window.location.href = '/'
      }
    } catch {
      setError('Er ging iets mis')
      setLoading(false)
    }
  }

  return (
    <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
      <div className="flex flex-col items-center mb-6">
        <div className="bg-green-100 p-3 rounded-full mb-4">
          <Lock className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">EveryPlants</h1>
        <p className="text-gray-500 mt-2">Log in om verder te gaan</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mailadres"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
            autoFocus
          />
        </div>
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Wachtwoord"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          />
        </div>

        <div className="text-right">
          <a
            href="/wachtwoord-vergeten"
            className="text-sm text-green-600 hover:text-green-700"
          >
            Wachtwoord vergeten?
          </a>
        </div>

        {error && (
          <p className="text-red-500 text-sm text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Inloggen...' : 'Inloggen'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}

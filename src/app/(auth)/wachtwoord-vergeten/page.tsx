'use client'

import { useState } from 'react'
import { Mail, ArrowLeft } from 'lucide-react'
import { createAuthBrowserClient } from '@/lib/supabase/browser'
import { getSiteUrl } from '@/lib/supabase/siteUrl'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const supabase = createAuthBrowserClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getSiteUrl()}/auth/callback`,
      })

      if (resetError) {
        if (resetError.status === 429 || resetError.code === 'over_request_rate_limit') {
          setError('Te veel verzoeken. Wacht enkele minuten en probeer opnieuw.')
        } else {
          setError('Er ging iets mis. Probeer het later opnieuw.')
        }
        setLoading(false)
      } else {
        setSent(true)
        setLoading(false)
      }
    } catch {
      setError('Er ging iets mis. Probeer het later opnieuw.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-green-100 p-3 rounded-full mb-4">
            <Mail className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Wachtwoord vergeten</h1>
          <p className="text-gray-500 mt-2 text-center">
            Voer je e-mailadres in om een resetlink te ontvangen
          </p>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <p className="text-gray-700">
              Als dit e-mailadres bij ons bekend is, ontvang je binnen enkele minuten een e-mail met een resetlink.
            </p>
            <a
              href="/login"
              className="inline-flex items-center gap-2 text-green-600 hover:text-green-700 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Terug naar inloggen
            </a>
          </div>
        ) : (
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

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Versturen...' : 'Verstuur resetlink'}
            </button>

            <a
              href="/login"
              className="flex items-center justify-center gap-2 text-green-600 hover:text-green-700 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Terug naar inloggen
            </a>
          </form>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { KeyRound } from 'lucide-react'
import { createAuthBrowserClient } from '@/lib/supabase/browser'

export default function NewPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const supabase = createAuthBrowserClient()

  useEffect(() => {
    async function checkSession() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        window.location.href = '/login'
        return
      }
      setSessionChecked(true)
    }
    checkSession()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Wachtwoord moet minimaal 8 tekens zijn')
      return
    }

    if (password !== confirmPassword) {
      setError('Wachtwoorden komen niet overeen')
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        if (updateError.status === 422) {
          setError('Dit wachtwoord voldoet niet aan de vereisten. Kies een ander wachtwoord.')
        } else {
          setError('Er ging iets mis. Probeer het opnieuw.')
        }
        setLoading(false)
      } else {
        setSuccess(true)
        setTimeout(() => {
          window.location.href = '/'
        }, 2000)
      }
    } catch {
      setError('Er ging iets mis. Probeer het opnieuw.')
      setLoading(false)
    }
  }

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
          <p className="text-center text-gray-500">Laden...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-green-100 p-3 rounded-full mb-4">
            <KeyRound className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Nieuw wachtwoord instellen</h1>
          <p className="text-gray-500 mt-2 text-center">
            Kies een nieuw wachtwoord voor je account
          </p>
        </div>

        {success ? (
          <div className="text-center space-y-2">
            <p className="text-green-600 font-medium">Je wachtwoord is gewijzigd!</p>
            <p className="text-gray-500 text-sm">Je wordt doorgestuurd...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nieuw wachtwoord"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                autoFocus
              />
            </div>
            <div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Bevestig wachtwoord"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password || !confirmPassword}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Opslaan...' : 'Wachtwoord opslaan'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

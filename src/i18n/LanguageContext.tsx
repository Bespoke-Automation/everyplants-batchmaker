'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import nl from './nl'
import en from './en'
import type { Dictionary } from './nl'

type Language = 'nl' | 'en'

const STORAGE_KEY = 'verpakking_language'

const dictionaries: Record<Language, Dictionary> = { nl, en }

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: Dictionary
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'nl',
  setLanguage: () => {},
  t: nl,
})

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'nl'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'nl') return stored
  } catch { /* ignore */ }
  return 'nl'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('nl')

  // Restore from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const stored = getStoredLanguage()
    if (stored !== 'nl') setLanguageState(stored)
  }, [])

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch { /* ignore */ }
  }, [])

  const t = dictionaries[language]

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useTranslation() {
  return useContext(LanguageContext)
}

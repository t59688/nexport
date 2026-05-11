import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import zhCN from './locales/zh-CN'

export const LANGUAGE_STORAGE_KEY = 'nexport.language'
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function normalizeLanguage(raw?: string | null): AppLanguage {
  if (!raw) return 'zh-CN'
  if (raw.toLowerCase().startsWith('en')) return 'en'
  return 'zh-CN'
}

export function getStoredLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'zh-CN'
  return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))
}

export function persistLanguage(language: AppLanguage) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
}

const initialLanguage =
  typeof window === 'undefined'
    ? 'zh-CN'
    : normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? window.navigator.language)

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng: initialLanguage,
  fallbackLng: 'zh-CN',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n

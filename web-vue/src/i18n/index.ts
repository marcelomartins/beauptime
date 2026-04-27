import { createI18n } from 'vue-i18n'
import { enMessages } from './messages/en'

export const defaultLocale = 'en'

export const messages = {
  en: enMessages,
} as const

export const supportedLocales = Object.keys(messages)

export const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: defaultLocale,
  globalInjection: true,
  messages,
})

export const setLocale = (locale: keyof typeof messages) => {
  i18n.global.locale.value = locale

  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = defaultLocale
}

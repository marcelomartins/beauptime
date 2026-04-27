import type { ApiResponse } from '@bea-uptime/contracts'

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

const resolveRequestUrl = (url: string) => {
  if (!configuredApiBaseUrl) {
    return url
  }

  return new URL(url, configuredApiBaseUrl.endsWith('/') ? configuredApiBaseUrl : `${configuredApiBaseUrl}/`).toString()
}

export const requestJson = async <T>(url: string, errorMessage: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(resolveRequestUrl(url), {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const payload = (await response.json()) as ApiResponse<T>

  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? errorMessage : payload.error.message)
  }

  return payload.data
}

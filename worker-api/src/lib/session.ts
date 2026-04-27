import type { AdminSession } from '@/modules/auth/auth-types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const SESSION_COOKIE_NAME = 'bea_uptime_admin'
const SESSION_KEY_CONTEXT = 'bea-uptime/admin-session/v1'
export const SESSION_TTL_SECONDS = 60 * 60 * 12

type ParsedAdminSessionToken = {
  payload: string
  signature: Uint8Array
  session: AdminSession
}

const toUint8Array = (bytes: ArrayBuffer | Uint8Array) => {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) => {
  const binary = Array.from(toUint8Array(bytes), (value) => String.fromCharCode(value)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const fromBase64Url = (value: string) => {
  if (!value) {
    return null
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')

  try {
    const binary = atob(padded)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  }
  catch {
    return null
  }
}

const sha256 = async (value: string) => {
  return toUint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

const deriveSessionKey = async (rootSecret: string) => {
  const derivedKey = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${SESSION_KEY_CONTEXT}:${rootSecret}`),
  )

  return crypto.subtle.importKey('raw', derivedKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) {
    return false
  }

  let difference = 0

  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }

  return difference === 0
}

const signPayload = async (rootSecret: string, value: string) => {
  const signature = await crypto.subtle.sign('HMAC', await deriveSessionKey(rootSecret), encoder.encode(value))
  return toUint8Array(signature)
}

const parseAdminSession = (token: string): ParsedAdminSessionToken | null => {
  const parts = token.split('.')

  if (parts.length !== 2) {
    return null
  }

  const [payload, signature] = parts
  const payloadBytes = fromBase64Url(payload)
  const signatureBytes = fromBase64Url(signature)

  if (!payloadBytes || !signatureBytes) {
    return null
  }

  try {
    const value = JSON.parse(decoder.decode(payloadBytes)) as Partial<AdminSession>
    const exp = value.exp

    if (value.role !== 'admin' || typeof exp !== 'number' || !Number.isInteger(exp)) {
      return null
    }

    return {
      payload,
      signature: signatureBytes,
      session: {
        role: 'admin' as const,
        exp,
      },
    }
  }
  catch {
    return null
  }
}

export const isMatchingRootPassword = async (password: string, rootSecret: string) => {
  if (!rootSecret) {
    return false
  }

  const [passwordDigest, secretDigest] = await Promise.all([sha256(password), sha256(rootSecret)])
  return timingSafeEqual(passwordDigest, secretDigest)
}

export const createAdminSession = (now = Date.now()): AdminSession => {
  return {
    role: 'admin',
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  }
}

export const signAdminSessionToken = async (rootSecret: string, session: AdminSession) => {
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)))
  const signature = await signPayload(rootSecret, payload)
  return `${payload}.${toBase64Url(signature)}`
}

export const verifyAdminSessionToken = async (rootSecret: string, token: string) => {
  const parsedToken = parseAdminSession(token)

  if (!parsedToken) {
    return null
  }

  const expectedSignature = await signPayload(rootSecret, parsedToken.payload)

  if (!timingSafeEqual(expectedSignature, parsedToken.signature)) {
    return null
  }

  if (parsedToken.session.exp <= Math.floor(Date.now() / 1000)) {
    return null
  }

  return parsedToken.session
}

export const getSessionCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
})

export const getSessionCookieName = () => SESSION_COOKIE_NAME

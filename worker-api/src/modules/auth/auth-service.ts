import type { LoginRequest, SessionResponse } from '@bea-uptime/contracts'
import type { AppBindings } from '@/env'
import { ApiError } from '@/lib/errors'
import { createAdminSession, isMatchingRootPassword, signAdminSessionToken, verifyAdminSessionToken } from '@/lib/session'

const AUTHENTICATED_SESSION: SessionResponse = { authenticated: true }
const UNAUTHENTICATED_SESSION: SessionResponse = { authenticated: false }

const getRootSecret = (env: AppBindings) => {
  const rootSecret = env.AUTH_ROOT_SECRET?.trim()

  if (!rootSecret) {
    throw new ApiError(500, 'auth_not_configured', 'Authentication is not configured.')
  }

  return rootSecret
}

export const resolveSession = async (env: AppBindings, token: string) => {
  return verifyAdminSessionToken(getRootSecret(env), token)
}

export const getSessionState = async (env: AppBindings, token?: string | null): Promise<SessionResponse> => {
  if (!token) {
    return UNAUTHENTICATED_SESSION
  }

  const resolved = await resolveSession(env, token)

  return resolved ? AUTHENTICATED_SESSION : UNAUTHENTICATED_SESSION
}

export const login = async (env: AppBindings, payload: LoginRequest) => {
  const rootSecret = getRootSecret(env)
  const validPassword = await isMatchingRootPassword(payload.password, rootSecret)

  if (!validPassword) {
    throw new ApiError(401, 'invalid_credentials', 'Invalid credentials.')
  }

  const session = createAdminSession()

  return {
    session,
    sessionToken: await signAdminSessionToken(rootSecret, session),
    response: AUTHENTICATED_SESSION,
  }
}

export const logout = async (_env: AppBindings, _token?: string | null) => {}

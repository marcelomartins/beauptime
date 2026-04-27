import { Hono } from 'hono'
import type { Context } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '@/env'
import { logger } from '@/lib/logger'
import { authModule } from '@/modules/auth/auth'
import { healthModule } from '@/modules/infra/health'
import { incidentModule } from '@/modules/incident/incident'
import { monitorModule } from '@/modules/monitor/monitor'
import { runScheduledCleanup, runScheduledMonitorSweep } from '@/modules/monitor/monitor-service'
import { serviceModule } from '@/modules/service/service'
import { statusModule } from '@/modules/status/status'
import { cors } from '@/middlewares/cors'
import { csrfProtection } from '@/middlewares/csrf-protection'
import { handleError } from '@/middlewares/error-handler'
import { optionalAuth } from '@/middlewares/optional-auth'
import { requestId } from '@/middlewares/request-id'
import { security } from '@/middlewares/security'

const AUTH_PREFIX = '/auth'
const API_V1_PREFIX = '/api/v1'
const MONITOR_SWEEP_CRON = '*/1 * * * *'
const CLEANUP_CRON = '17 3 * * *'
const PROTECTED_SPA_SHELL_PATH = '/index-spa.html'

const protectedAppPrefixes = ['/dashboard'] as const

const isProtectedAppPath = (path: string) => {
	return protectedAppPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

const isBackendPath = (path: string) => {
	return path === '/health'
		|| path === AUTH_PREFIX
		|| path.startsWith(`${AUTH_PREFIX}/`)
		|| path === API_V1_PREFIX
		|| path.startsWith(`${API_V1_PREFIX}/`)
}

const hasFileExtension = (path: string) => /\/[^/]+\.[^/]+$/.test(path)

const toPublicHtmlAssetPath = (path: string) => {
	if (path === '/') {
		return '/index.html'
	}

	const normalizedPath = path.replace(/\/+$/, '')
 	return `${normalizedPath}.html`
}

const serveAsset = (c: Context<AppEnv>, assetPath: string) => {
  const assetUrl = new URL(assetPath, c.req.url)
  return c.env.ASSETS.fetch(new Request(assetUrl, c.req.raw))
}

const serveAppShell = (c: Context<AppEnv>) => serveAsset(c, PROTECTED_SPA_SHELL_PATH)

const requireAppShellAuth = (): MiddlewareHandler<AppEnv> => {
	return async (c, next) => {
		if (!c.get('currentAdminSession')) {
			return c.redirect('/')
		}

		await next()
	}
}

const serveProtectedAppShell = [requireAppShellAuth(), serveAppShell] as const

const app = new Hono<AppEnv>()

app.use('*', requestId())
app.use('*', security())
app.use('*', cors())
app.use('*', csrfProtection())
app.use('*', optionalAuth())

app.onError(handleError)

app.route('/health', healthModule)
app.route(AUTH_PREFIX, authModule)
app.route(`${API_V1_PREFIX}/monitor`, monitorModule)
app.route(`${API_V1_PREFIX}/status`, statusModule)
app.route(`${API_V1_PREFIX}/services`, serviceModule)
app.route(`${API_V1_PREFIX}/incidents`, incidentModule)
app.get('/dashboard', ...serveProtectedAppShell)
app.get('/dashboard/*', ...serveProtectedAppShell)

app.notFound(async (c) => {
	if (isProtectedAppPath(c.req.path)) {
		if (!c.get('currentAdminSession')) {
			return c.redirect('/')
		}

		return serveAppShell(c)
	}

	if (c.req.path === PROTECTED_SPA_SHELL_PATH) {
		if (!c.get('currentAdminSession')) {
			return c.redirect('/')
		}

		return serveAppShell(c)
	}

	if (isBackendPath(c.req.path)) {
		return new Response('Not Found', { status: 404 })
	}

	if (!hasFileExtension(c.req.path)) {
		return serveAsset(c, toPublicHtmlAssetPath(c.req.path))
	}

	return c.env.ASSETS.fetch(c.req.raw)
})

export default {
	fetch: app.fetch,
	scheduled: async (controller: ScheduledController, env: AppEnv['Bindings'], _ctx: ExecutionContext) => {
		if (controller.cron === CLEANUP_CRON) {
			await runScheduledCleanup(env)
			return
		}

		if (controller.cron === MONITOR_SWEEP_CRON) {
			await runScheduledMonitorSweep(env)
			return
		}

		logger.warn('Ignoring unknown scheduled trigger', {
			cron: controller.cron,
		})
	},
}

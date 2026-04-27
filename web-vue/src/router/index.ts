import type { RouteRecordRaw } from 'vue-router'
import { appRoutes } from './routes-spa'
import { publicRoutes } from './routes-public'

export const routes: RouteRecordRaw[] = [...publicRoutes, ...appRoutes]

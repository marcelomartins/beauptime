import type { RouteRecordRaw } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'

const InternalConsolePage = () => import('@/modules/dashboard/pages/DashboardPage.vue')

export const appRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AppLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: InternalConsolePage,
        meta: { requiresAuth: true },
      },
      {
        path: 'dashboard/new',
        name: 'dashboard-new',
        component: InternalConsolePage,
        meta: { requiresAuth: true },
      },
      {
        path: 'dashboard/incidents',
        name: 'dashboard-incidents',
        component: InternalConsolePage,
        meta: { requiresAuth: true },
      },
      {
        path: 'dashboard/:slug',
        name: 'dashboard-service-detail',
        component: InternalConsolePage,
        meta: { requiresAuth: true },
      },
    ],
  },
]

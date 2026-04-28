import type { RouteRecordRaw } from 'vue-router'
import HomePage from '@/public-pages/HomePage.vue'
import StatusPage from '@/public-pages/StatusPage.vue'
import PublicLayout from '@/public-pages/layouts/PublicLayout.vue'

export const publicRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: PublicLayout,
    children: [
      {
        path: '',
        name: 'home',
        component: HomePage,
        meta: {
          centerContent: true,
          redirectIfAuthenticated: true,
        },
      },
      {
        path: 'status',
        name: 'status',
        component: StatusPage,
        meta: {
          centerContent: false,
        },
      },
    ],
  },
]

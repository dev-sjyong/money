export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  runtimeConfig: { public: { supabaseUrl: '', supabaseAnonKey: '' } },
  app: {
    head: {
      htmlAttrs: { lang: 'ko' },
      title: '두런 · 함께 쓰는 가계부',
      meta: [{ name: 'description', content: '간편하게 기록하고 정확하게 살피는 우리 집 가계부' }],
      link: [{ rel: 'icon', href: '/favicon.svg' }],
    },
  },
})

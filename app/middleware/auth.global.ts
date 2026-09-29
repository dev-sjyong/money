export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()
  await auth.init()
  if (to.path !== '/login' && !auth.user.value) return navigateTo('/login')
  if (to.path === '/login' && auth.user.value) return navigateTo('/dashboard')
})

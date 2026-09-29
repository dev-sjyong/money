import { createClient } from '@supabase/supabase-js'
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public
  const supabase =
    config.supabaseUrl && config.supabaseAnonKey
      ? createClient(config.supabaseUrl, config.supabaseAnonKey)
      : null
  return { provide: { supabase } }
})

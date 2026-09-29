<script setup lang="ts">
definePageMeta({ layout: false })
const { configured, user } = useAuth()
const { $supabase } = useNuxtApp()
const email = ref(''),
  password = ref(''),
  signup = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
async function submit() {
  if (!$supabase || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = signup.value
      ? await $supabase.auth.signUp({ email: email.value, password: password.value })
      : await $supabase.auth.signInWithPassword({ email: email.value, password: password.value })
    if (result.error) throw result.error
    if (result.data.session) {
      user.value = result.data.user
      await navigateTo('/dashboard')
    } else notice.value = '가입 확인 이메일을 보냈어요. 이메일 인증 후 로그인해 주세요.'
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
function toggleAuth() {
  signup.value = !signup.value
  error.value = ''
  notice.value = ''
}
</script>
<template>
  <main class="login-page">
    <section class="login-story">
      <NuxtLink class="brand" to="/">Ⅱ 두런</NuxtLink>
      <div>
        <span class="eyebrow">함께 쓰는, 제대로 된 가계부</span>
        <h1>우리의 일상을<br />차곡차곡.</h1>
        <p>작은 커피 한 잔부터<br />함께 모으는 내일의 집까지.</p>
        <div class="ledger-art" aria-hidden="true">
          <span>오늘의 기록</span>
          <div>나란히 쌓이는 일상 <b>+ 여유</b></div>
          <div>함께 그리는 내일 <b>+ 가능성</b></div>
          <div class="art-total">우리의 균형 <b>두런</b></div>
        </div>
      </div>
      <small>혼자 시작해도, 둘이 함께해도.</small>
    </section>
    <section class="login-form">
      <div>
        <span class="eyebrow">어서 오세요</span>
        <h2>{{ signup ? '새로운 기록의 시작' : '다시 만나 반가워요.' }}</h2>
        <p class="muted">이메일로 간편하게 {{ signup ? '가입' : '로그인' }}하세요.</p>
        <div v-if="!configured" class="alert">
          연결 설정이 필요합니다. 프로젝트의 <code>.env.example</code>을 참고해 Supabase URL과 공개
          키를 설정한 후 서버를 다시 시작하세요.
        </div>
        <form @submit.prevent="submit">
          <label
            >이메일<input
              v-model="email"
              type="email"
              required
              autocomplete="email"
              placeholder="you@example.com" /></label
          ><label
            >비밀번호<input
              v-model="password"
              type="password"
              required
              minlength="8"
              :autocomplete="signup ? 'new-password' : 'current-password'"
              placeholder="8자 이상 입력해 주세요"
          /></label>
          <p v-if="error" class="alert error" role="alert">{{ error }}</p>
          <p v-if="notice" class="alert" role="status">{{ notice }}</p>
          <button class="button full" :disabled="busy || !configured">
            {{ busy ? '처리 중…' : signup ? '회원가입' : '로그인' }} <span>→</span>
          </button>
        </form>
        <button class="text-button auth-toggle" @click="toggleAuth">
          {{ signup ? '이미 계정이 있나요? 로그인' : '처음 오셨나요? 회원가입' }}
        </button>
        <p class="fineprint">직접 기록하는 가계부.<br />은행·카드 연결 없이 시작할 수 있어요.</p>
      </div>
    </section>
  </main>
</template>

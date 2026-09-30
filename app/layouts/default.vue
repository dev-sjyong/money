<script setup lang="ts">
const route = useRoute()
const auth = useAuth()
const { households, householdId, current, load } = useHousehold()
const { data, loading, error, refresh } = useLedger()
const signError = ref('')
const links = [
  ['/dashboard', '◫', '한눈에 보기'],
  ['/transactions', '⇄', '거래 내역'],
  ['/accounts', '▤', '자산과 계정'],
  ['/budgets', '◎', '월 예산'],
  ['/repayment', '▦', '개인회생 일정'],
  ['/reports', '▧', '통계 한눈에'],
  ['/reports/income-expense', '▥', '월별 수입·지출'],
  ['/reports/assets', '◷', '자산·부채 보고서'],
  ['/reports/net-worth', '↗', '순자산 추이'],
  ['/settings', '⚙', '설정'],
]
watch(
  () => auth.user.value?.id,
  async (id) => {
    if (id) {
      try {
        await load()
        await refresh()
      } catch (e) {
        error.value = message(e)
      }
    }
  },
  { immediate: true },
)
watch(householdId, async () => {
  data.value = { accounts: [], transactions: [], budgets: [], members: [] }
  await refresh()
})
async function logout() {
  try {
    await auth.signOut()
  } catch (e) {
    signError.value = message(e)
  }
}
</script>
<template>
  <div class="shell">
    <aside class="sidebar">
      <NuxtLink to="/dashboard" class="brand"
        ><span class="brand-mark">Ⅱ</span> 두런<span class="brand-caption"
          >우리의 돈, 나란히</span
        ></NuxtLink
      >
      <div class="household-picker">
        <label for="household">함께 쓰는 가계부</label
        ><select id="household" v-model="householdId">
          <option value="" disabled>가계부를 만들어 주세요</option>
          <option v-for="h in households" :key="h.id" :value="h.id">{{ h.name }}</option>
        </select>
      </div>
      <nav aria-label="주 메뉴">
        <NuxtLink
          v-for="[href, icon, label] in links"
          :key="href"
          :to="href!"
          :class="{
            active: href === '/reports' ? route.path === href : route.path.startsWith(href!),
          }"
          ><span aria-hidden="true">{{ icon }}</span
          >{{ label }}</NuxtLink
        >
      </nav>
      <div class="sidebar-note">
        <span class="status-dot"></span> 하나의 기록, 두 개의 균형
        <p>오늘의 기록이<br />내일의 여유가 되도록.</p>
      </div>
      <div class="profile">
        <span class="avatar">{{ auth.user.value?.email?.slice(0, 1).toUpperCase() }}</span>
        <div>
          <small>{{ auth.user.value?.email }}</small
          ><button class="text-button" @click="logout">로그아웃</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span
          >{{ current?.name || '새로운 시작' }} <span class="muted">/ 개인·2인 가계부</span></span
        >
        <div>
          <span class="member-badge">{{ data.members.length || 1 }}명 함께</span
          ><button class="text-button" :disabled="loading || !householdId" @click="refresh">
            새로고침 ↻</button
          ><button class="text-button mobile-logout" @click="logout">로그아웃</button>
        </div>
      </header>
      <div v-if="error || signError" class="alert error" role="alert">
        {{ error || signError }} <button @click="refresh">다시 시도</button>
      </div>
      <div v-if="loading" class="loading-bar" role="status">가계부를 불러오고 있어요…</div>
      <div
        v-if="!householdId && !loading && !route.path.startsWith('/settings')"
        class="empty panel"
      >
        <span class="eyebrow">첫 번째 페이지</span>
        <h1>우리의 가계부를 시작해요.</h1>
        <p>가계부를 만들거나 받은 초대 코드로 참여할 수 있어요.</p>
        <NuxtLink class="button" to="/settings">가계부 만들기 →</NuxtLink>
      </div>
      <div v-show="householdId || route.path.startsWith('/settings')"><slot /></div>
      <footer>
        두런 <span>차곡차곡 기록하는 우리 집 이야기.</span><span>KRW · 원화 기준</span>
      </footer>
    </main>
  </div>
</template>

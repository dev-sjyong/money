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
  ['/fixed-expenses', '↻', '고정지출'],
  ['/repayment', '▦', '개인회생 일정'],
  ['/reports', '▧', '통계 한눈에'],
  ['/reports/income-expense', '▥', '월별 수입·지출'],
  ['/reports/assets', '◷', '자산·부채 보고서'],
  ['/reports/net-worth', '↗', '순자산 추이'],
  ['/settings', '⚙', '설정'],
]
const menuOpen = ref(false)
const menuToggle = ref<HTMLButtonElement | null>(null)
const menuPanel = ref<HTMLElement | null>(null)
const groups = [
  { title: '일상 기록', items: links.slice(0, 3) },
  { title: '지출 계획', items: links.slice(3, 6) },
  { title: '통계와 보고서', items: links.slice(6, 10) },
  { title: '가계부 관리', items: links.slice(10) },
]
const primaryLinks = [links[0]!, links[1]!, links[4]!, links[6]!]
function isActive(href: string) {
  return href === '/reports' ? route.path === href : route.path.startsWith(href)
}
async function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    await nextTick()
    menuPanel.value?.querySelector<HTMLAnchorElement>('a')?.focus()
  }
}
function closeMenu() {
  menuOpen.value = false
  menuToggle.value?.focus()
}
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)
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
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
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
      <nav class="desktop-navigation" aria-label="주 메뉴">
        <div v-for="group in groups" :key="group.title" class="navigation-group">
          <p class="navigation-title">{{ group.title }}</p>
          <NuxtLink
            v-for="[href, icon, label] in group.items"
            :key="href"
            :to="href!"
            :class="{ active: isActive(href!) }"
            :aria-current="isActive(href!) ? 'page' : undefined"
          >
            <span aria-hidden="true">{{ icon }}</span
            >{{ label }}
          </NuxtLink>
        </div>
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
    <main id="main-content" class="main" tabindex="-1">
      <section
        v-if="menuOpen"
        id="mobile-menu"
        ref="menuPanel"
        class="mobile-menu panel"
        aria-label="전체 메뉴"
        @keydown.esc.prevent="closeMenu"
      >
        <div class="section-title">
          <h2>전체 메뉴</h2>
          <button class="text-button" @click="closeMenu">닫기 ✕</button>
        </div>
        <nav aria-label="전체 화면">
          <div v-for="group in groups" :key="group.title" class="navigation-group">
            <p class="navigation-title">{{ group.title }}</p>
            <NuxtLink
              v-for="[href, icon, label] in group.items"
              :key="href"
              :to="href!"
              :class="{ active: isActive(href!) }"
              :aria-current="isActive(href!) ? 'page' : undefined"
              ><span aria-hidden="true">{{ icon }}</span
              >{{ label }}</NuxtLink
            >
          </div>
        </nav>
      </section>
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
    <nav class="mobile-navigation" aria-label="빠른 이동">
      <NuxtLink
        v-for="[href, icon, label] in primaryLinks"
        :key="href"
        :to="href!"
        :class="{ active: isActive(href!) }"
        :aria-current="isActive(href!) ? 'page' : undefined"
        ><span aria-hidden="true">{{ icon }}</span
        >{{ label }}</NuxtLink
      >
      <button
        ref="menuToggle"
        :aria-expanded="menuOpen"
        aria-controls="mobile-menu"
        :class="{ active: menuOpen }"
        @click="toggleMenu"
      >
        <span aria-hidden="true">☰</span>전체 메뉴
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
const { current, householdId, load } = useHousehold()
const { rpc, refresh, isOwner } = useLedger()
const name = ref(''),
  rename = ref(''),
  token = ref(''),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
watch(current, (h) => (rename.value = h?.name ?? ''), { immediate: true })
async function action(kind: 'create' | 'rename' | 'join') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (kind === 'create')
      householdId.value = await rpc<string>('create_household', { p_name: name.value })
    if (kind === 'rename')
      await rpc('rename_household', { p_household: householdId.value, p_name: rename.value })
    if (kind === 'join')
      householdId.value = await rpc<string>('accept_invite', { p_token: token.value.trim() })
    await load()
    await refresh()
    notice.value = kind === 'join' ? '가계부에 참여했어요.' : '저장했어요.'
    name.value = ''
    token.value = ''
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">우리에게 맞게</span>
      <h1>가계부 설정</h1>
      <p class="muted">혼자, 또는 둘이 함께 시작하세요.</p>
    </div>
  </div>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <p v-if="notice" class="alert" role="status">{{ notice }}</p>
  <div class="settings-grid">
    <form class="panel" @submit.prevent="action('create')">
      <h2>새 가계부 만들기</h2>
      <p class="muted">기본 자산·부채·수입·지출 항목을 함께 준비해 드려요.</p>
      <label
        >가계부 이름<input
          v-model="name"
          required
          maxlength="100"
          placeholder="우리집 가계부" /></label
      ><button class="button" :disabled="busy">가계부 만들기 →</button>
    </form>
    <form class="panel" @submit.prevent="action('join')">
      <h2>초대받은 가계부 참여</h2>
      <p class="muted">소유자에게 받은 24시간 유효 초대 코드를 입력하세요.</p>
      <label
        >초대 코드<input v-model="token" required placeholder="받은 코드를 붙여 넣으세요" /></label
      ><button class="secondary" :disabled="busy">가계부 참여</button>
    </form>
    <form v-if="current && isOwner" class="panel" @submit.prevent="action('rename')">
      <h2>가계부 이름 수정</h2>
      <label>이름<input v-model="rename" required maxlength="100" /></label
      ><button class="secondary" :disabled="busy">이름 저장</button>
    </form>
    <div v-if="current" class="panel">
      <h2>함께 쓰기와 시작 잔액</h2>
      <NuxtLink class="setting-link" to="/settings/members">구성원 관리 <span>→</span></NuxtLink
      ><NuxtLink v-if="isOwner" class="setting-link" to="/settings/accounts"
        >초기 자산·부채 등록 <span>→</span></NuxtLink
      ><NuxtLink class="setting-link" to="/accounts">계정과목 관리 <span>→</span></NuxtLink>
    </div>
  </div>
</template>

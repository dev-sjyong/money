<script setup lang="ts">
const { data, isOwner, rpc, refresh } = useLedger()
const { householdId } = useHousehold()
const { user } = useAuth()
const token = ref(''),
  busy = ref(false),
  error = ref(''),
  removing = ref('')
async function invite() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    token.value = await rpc<string>('create_invite', { p_household: householdId.value })
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await rpc('remove_member', { p_household: householdId.value, p_user: removing.value })
    await refresh()
    removing.value = ''
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
      <span class="eyebrow">둘이 쓰면 더 든든하게</span>
      <h1>구성원</h1>
      <p class="muted">가계부 하나에 최대 두 명이 함께할 수 있어요.</p>
    </div>
    <button
      v-if="isOwner && data.members.length < 2"
      class="button"
      :disabled="busy"
      @click="invite"
    >
      초대 코드 만들기
    </button>
  </div>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <div v-if="token" class="panel">
    <h2>24시간 동안 유효한 초대 코드</h2>
    <input
      :value="token"
      readonly
      aria-label="발급된 초대 코드"
      @focus="($event.target as HTMLInputElement).select()"
    />
    <p class="fineprint">
      함께 쓸 분에게 전달해 주세요. 회원가입 후 설정에서 참여할 수 있습니다. 다시 발급하면 이전
      코드는 만료됩니다.
    </p>
  </div>
  <section class="panel">
    <div v-for="m in data.members" :key="m.id" class="member-row">
      <span class="avatar">{{ m.role === 'OWNER' ? '나' : '함께' }}</span>
      <div>
        <strong>{{
          m.user_id === user?.id ? '나' : m.role === 'OWNER' ? '가계부 소유자' : '함께 쓰는 구성원'
        }}</strong
        ><small class="block muted">{{ m.user_id }}</small>
      </div>
      <span class="badge">{{ m.role === 'OWNER' ? '소유자' : '구성원' }}</span
      ><button
        v-if="isOwner && m.role === 'MEMBER'"
        class="text-button danger"
        @click="removing = m.user_id"
      >
        내보내기
      </button>
    </div>
    <div v-if="removing" class="alert error">
      <p>이 구성원의 접근 권한을 해제할까요? 기존 거래는 남아 있습니다.</p>
      <button class="secondary danger" :disabled="busy" @click="remove">내보내기 확인</button>
      <button class="secondary" @click="removing = ''">취소</button>
    </div>
    <p class="fineprint">
      소유자는 설정·구성원·계정·거래·예산을 관리합니다. 구성원은 거래 등록·수정, 예산 관리, 보고서
      조회가 가능합니다.
    </p>
  </section>
</template>

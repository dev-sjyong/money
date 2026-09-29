<script setup lang="ts">
import { today, won } from '~/utils/accounting'
const { accounts, label } = useAccounts()
const { isOwner, data, rpc, refresh } = useLedger()
const { householdId } = useHousehold()
const date = ref(today()),
  values = ref<Record<string, string>>({}),
  busy = ref(false),
  error = ref('')
const opening = computed(() => data.value.transactions.find((t) => t.is_opening))
const eligible = computed(() =>
  accounts.value.filter((a) => ['ASSET', 'LIABILITY'].includes(a.type) && !a.is_archived),
)
const net = computed(() =>
  eligible.value.reduce(
    (s, a) =>
      s +
      (/^\d+$/.test(values.value[a.id] || '')
        ? BigInt(values.value[a.id]!) * (a.type === 'ASSET' ? 1n : -1n)
        : 0n),
    0n,
  ),
)
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const balances = eligible.value
      .filter((a) => values.value[a.id] && values.value[a.id] !== '0')
      .map((a) => ({ account_id: a.id, amount: values.value[a.id] }))
    await rpc('create_opening', {
      p_household: householdId.value,
      p_date: date.value,
      p_balances: balances,
    })
    await refresh()
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
      <span class="eyebrow">우리의 출발점</span>
      <h1>초기 자산·부채</h1>
      <p class="muted">기록을 시작하는 날, 이미 가지고 있던 금액을 알려 주세요.</p>
    </div>
  </div>
  <div v-if="!isOwner" class="panel">소유자만 초기 자산을 등록할 수 있어요.</div>
  <div v-else-if="opening" class="panel">
    <h2>시작 잔액이 등록되어 있어요.</h2>
    <p class="muted">수정이 필요하면 초기 거래의 분개를 수정하세요.</p>
    <NuxtLink class="button" :to="`/transactions/${opening.id}`">초기 거래 확인 →</NuxtLink>
  </div>
  <form v-else class="panel narrow" @submit.prevent="save">
    <label>기준일<input v-model="date" type="date" required /></label>
    <div v-for="a in eligible" :key="a.id" class="opening-row">
      <label :for="a.id"
        >{{ label(a.id) }}
        <span class="badge">{{ a.type === 'ASSET' ? '자산' : '부채' }}</span></label
      ><input
        :id="a.id"
        v-model="values[a.id]"
        inputmode="numeric"
        pattern="[0-9]*"
        placeholder="0"
      /><span>원</span>
    </div>
    <p class="hint">
      금액이 있는 계정만 입력하세요. 필요한 계정은
      <NuxtLink to="/accounts">자산과 계정</NuxtLink>에서 먼저 추가할 수 있어요.
    </p>
    <div class="journal-totals">
      <span>기초 순자산</span><strong>{{ won(net) }}원</strong>
    </div>
    <p class="fineprint">
      자산과 부채의 차이는 기초순자산으로 자동 기록됩니다. 별도의 잔액 값은 저장하지 않습니다.
    </p>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <button class="button" :disabled="busy">{{ busy ? '저장 중…' : '초기 자산 등록' }}</button>
  </form>
</template>

<script setup lang="ts">
import type { Budget } from '~/types/ledger'
import { today, percent } from '~/utils/accounting'
const month = ref(today().slice(0, 7))
const { rows, summary } = useBudgets(month)
const { active, label } = useAccounts()
const { rpc, refresh } = useLedger()
const { householdId } = useHousehold()
const account = ref(''),
  amount = ref(''),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const [year, m] = month.value.split('-').map(Number)
    await rpc('save_budget', {
      p_household: householdId.value,
      p_account: account.value,
      p_year: year,
      p_month: m,
      p_amount: amount.value,
    })
    await refresh()
    notice.value = '예산을 저장했어요.'
    account.value = ''
    amount.value = ''
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function remove(id: string) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await rpc('delete_budget', { p_id: id })
    await refresh()
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
function editBudget(b: Budget) {
  account.value = b.account_id
  amount.value = b.amount
}
watch(month, (value) => {
  if (!/^\d{4}-\d{2}$/.test(value)) month.value = today().slice(0, 7)
})
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">소비에도 나만의 속도</span>
      <h1>월 예산</h1>
      <p class="muted">목표를 정하고, 남은 여유를 확인해요.</p>
    </div>
    <input v-model="month" type="month" required aria-label="예산 월" />
  </div>
  <div class="stat-grid">
    <div class="panel">
      <span class="muted">전체 예산</span><MoneyValue :value="summary.total" />
    </div>
    <div class="panel">
      <span class="muted">사용한 금액</span><MoneyValue :value="summary.used" />
    </div>
    <div class="panel">
      <span class="muted">남은 예산</span><MoneyValue :value="summary.total - summary.used" />
    </div>
  </div>
  <form class="panel toolbar budget-form" @submit.prevent="save">
    <label
      >지출 항목<select v-model="account" required>
        <option value="" disabled>항목을 선택하세요</option>
        <option v-for="a in active.filter((a) => a.type === 'EXPENSE')" :key="a.id" :value="a.id">
          {{ label(a.id) }}
        </option>
      </select></label
    ><label
      >월 예산 (원)<input
        v-model="amount"
        inputmode="numeric"
        pattern="[1-9][0-9]*"
        required
        placeholder="600000" /></label
    ><button class="button" :disabled="busy || !month">예산 저장</button
    ><span class="fineprint">같은 항목을 저장하면 예산이 수정됩니다.</span>
  </form>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <p v-if="notice" class="alert" role="status">{{ notice }}</p>
  <section class="panel">
    <div v-for="b in rows" :key="b.id" class="budget-row">
      <div>
        <strong>{{ label(b.account_id) }}</strong>
        <div class="progress">
          <span
            :style="{ width: Math.min(100, percent(b.used, BigInt(b.amount))) + '%' }"
            :class="{ over: b.used > BigInt(b.amount) }"
          ></span>
        </div>
      </div>
      <div>
        <MoneyValue :value="b.used" /><small class="block muted"
          >예산 <MoneyValue :value="b.amount"
        /></small>
      </div>
      <div>
        <strong :class="{ danger: b.used > BigInt(b.amount) }"
          >{{ percent(b.used, BigInt(b.amount)).toFixed(0) }}%</strong
        ><small class="block muted">잔여 <MoneyValue :value="BigInt(b.amount) - b.used" /></small>
      </div>
      <button class="text-button" @click="editBudget(b)">수정</button
      ><button class="text-button danger" :disabled="busy" @click="remove(b.id)">삭제</button>
    </div>
    <p v-if="!rows.length" class="empty-text">아직 이번 달 예산이 없어요. 첫 목표를 정해 보세요.</p>
    <p class="fineprint">
      상위 항목은 하위 지출의 차변 금액을 포함합니다. 전체 예산과 사용액에서는 중첩 예산을 한 번만
      계산합니다.
    </p>
  </section>
</template>

<script setup lang="ts">
import type { TransactionHistory } from '~/types/ledger'
import { historyLabels } from '~/types/ledger'
const props = defineProps<{ transactionId: string; version?: string }>()
const { householdId } = useHousehold(),
  { user } = useAuth()
const { history } = useTransactionHistory()
const records = ref<TransactionHistory[]>([]),
  loading = ref(false),
  error = ref('')
let generation = 0
async function load() {
  const token = ++generation,
    h = householdId.value
  records.value = []
  error.value = ''
  loading.value = true
  try {
    const result = await history(h, props.transactionId)
    if (token === generation && h === householdId.value) records.value = result
  } catch (e) {
    if (token === generation) error.value = message(e)
  } finally {
    if (token === generation) loading.value = false
  }
}
watch(() => [householdId.value, props.transactionId, props.version], load, { immediate: true })
onBeforeUnmount(() => {
  generation++
})
function actor(id: string | null) {
  return !id ? '도입 시점 기록' : id === user.value?.id ? '나' : `구성원 ${id.slice(0, 8)}`
}
function time(value: string) {
  return new Date(value).toLocaleString('ko-KR')
}
</script>
<template>
  <section class="panel history-panel" aria-label="거래 변경 이력">
    <div class="section-title">
      <h2>변경 이력</h2>
      <button class="text-button" :disabled="loading" @click="load">이력 새로고침</button>
    </div>
    <p class="fineprint">
      누가 언제 변경했는지와 당시 내용을 확인할 수 있어요. 도입 이전의 수정·삭제 내역은 포함되지
      않습니다.
    </p>
    <p v-if="loading" role="status">이력을 불러오고 있어요…</p>
    <p v-else-if="error" class="alert error" role="alert">이력을 불러오지 못했어요. {{ error }}</p>
    <p v-else-if="!records.length" class="empty-text">아직 기록된 이력이 없어요.</p>
    <ol v-else class="history-list">
      <li v-for="record in records" :key="record.id">
        <details>
          <summary>
            <span class="badge">{{ historyLabels[record.action] }}</span
            ><span>{{ actor(record.actor_id) }}</span
            ><time :datetime="record.created_at">{{ time(record.created_at) }}</time
            ><span class="text-button">내용 보기</span>
          </summary>
          <div class="history-comparison">
            <div v-if="record.before_snapshot">
              <h3>
                {{
                  record.action === 'DELETE'
                    ? '삭제한 내용'
                    : record.action === 'RESTORE'
                      ? '휴지통의 내용'
                      : '변경 전'
                }}
              </h3>
              <TransactionSnapshot :snapshot="record.before_snapshot" />
            </div>
            <div v-if="record.after_snapshot">
              <h3>
                {{
                  record.action === 'UPDATE'
                    ? '변경 후'
                    : record.action === 'RESTORE'
                      ? '복구한 내용'
                      : '저장된 내용'
                }}
              </h3>
              <TransactionSnapshot :snapshot="record.after_snapshot" />
            </div>
          </div>
        </details>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { today, percent } from '~/utils/accounting'
const month = ref(today().slice(0, 7))
const { summary, trend, expenses } = useDashboard(month)
const { summary: budget } = useBudgets(month)
const { transactions } = useTransactions()
const { user } = useAuth()
watch(month, (value) => {
  if (!/^\d{4}-\d{2}$/.test(value)) month.value = today().slice(0, 7)
})
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">OUR MONEY, OUR EVERYDAY</span>
      <h1>잘 쌓이고 있어요, 우리의 일상.</h1>
      <p class="muted">오늘의 자산과 이번 달의 흐름을 살펴보세요.</p>
    </div>
    <NuxtLink to="/transactions/new" class="button">＋ 거래 기록</NuxtLink>
  </div>
  <section class="overview">
    <div class="net-worth">
      <div class="card-top"><span>현재 순자산</span><span class="pill">우리의 자산</span></div>
      <MoneyValue :value="summary.netWorth" />
      <div class="net-bottom">
        <span>총 자산 <MoneyValue :value="summary.assets" /></span
        ><span>총 부채 <MoneyValue :value="summary.liabilities" /></span>
      </div>
    </div>
    <div class="month-flow">
      <div class="section-title">
        <h2>이번 달의 흐름</h2>
        <input v-model="month" type="month" aria-label="조회 월" required />
      </div>
      <div class="flow-item">
        <span><i class="mini-icon income">↙</i>들어온 돈</span
        ><MoneyValue :value="summary.income" />
      </div>
      <div class="flow-item">
        <span><i class="mini-icon expense">↗</i>나간 돈</span
        ><MoneyValue :value="summary.expense" />
      </div>
      <div class="flow-item flow-total">
        <span>이번 달 남은 돈</span><MoneyValue :value="summary.surplus" />
      </div>
    </div>
  </section>
  <section class="dashboard-grid">
    <div class="panel">
      <div class="section-title">
        <div>
          <span class="eyebrow">한 걸음씩, 더 나은 내일</span>
          <h2>순자산의 발자취</h2>
        </div>
        <NuxtLink to="/reports/net-worth" class="text-button">자세히 ↗</NuxtLink>
      </div>
      <ReportChart :items="trend" title="최근 6개월 월말 순자산" />
    </div>
    <div class="panel budget-card">
      <div class="section-title">
        <h2>예산, 얼마나 남았을까요?</h2>
        <NuxtLink to="/budgets">↗</NuxtLink>
      </div>
      <span class="muted">이번 달 남은 예산</span><MoneyValue :value="budget.total - budget.used" />
      <div class="progress">
        <span
          :style="{ width: Math.min(100, percent(budget.used, budget.total)) + '%' }"
          :class="{ over: budget.used > budget.total }"
        ></span>
      </div>
      <div class="split small">
        <span>사용 <MoneyValue :value="budget.used" /></span
        ><span>{{ percent(budget.used, budget.total).toFixed(0) }}%</span>
      </div>
      <p class="fineprint">
        전체 예산 <MoneyValue :value="budget.total" /> · 중첩된 하위 예산은 중복 합산하지 않아요.
      </p>
    </div>
  </section>
  <section class="dashboard-grid lower">
    <div class="panel">
      <div class="section-title">
        <h2>최근 기록</h2>
        <NuxtLink to="/transactions" class="text-button">모두 보기 →</NuxtLink>
      </div>
      <TransactionTable :items="transactions.slice(0, 5)" />
    </div>
    <div class="panel">
      <div class="section-title">
        <h2>주요 지출</h2>
        <span class="muted small">{{ month }}</span>
      </div>
      <ReportChart :items="expenses.slice(0, 5)" title="월 지출 카테고리" />
    </div>
  </section>
</template>

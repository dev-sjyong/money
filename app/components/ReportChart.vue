<script setup lang="ts">
import { won } from '~/utils/accounting'
const props = defineProps<{ items: { label: string; value: bigint }[]; title: string }>()
const max = computed(() =>
  props.items.reduce((m, i) => {
    const v = i.value < 0n ? -i.value : i.value
    return v > m ? v : m
  }, 1n),
)
function width(v: bigint) {
  return Number(((v < 0n ? -v : v) * 10000n) / max.value) / 100
}
</script>
<template>
  <div class="chart" role="group" :aria-label="title">
    <div v-for="i in items" :key="i.label" class="chart-row">
      <span>{{ i.label }}</span>
      <div class="chart-track">
        <div
          class="chart-bar"
          :class="{ negative: i.value < 0n }"
          :style="{ width: width(i.value) + '%' }"
        ></div>
      </div>
      <span class="money">{{ won(i.value) }}<small> 원</small></span>
    </div>
    <p v-if="!items.length" class="empty-text">아직 기록이 없어요.</p>
  </div>
</template>

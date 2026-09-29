<script setup lang="ts">
import { won } from '~/utils/accounting'
withDefaults(defineProps<{ value: bigint | string; unit?: boolean }>(), { unit: true })
</script>
<template>
  <span class="money">{{ won(value) }}<small v-if="unit !== false"> 원</small></span>
</template>

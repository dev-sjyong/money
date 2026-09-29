<script setup lang="ts">
import { displayAmount, normalizeAmountInput, incrementAmount } from '~/utils/transactionDraft'
const props = withDefaults(defineProps<{ modelValue: string; label?: string; quick?: boolean }>(), {
  label: '금액',
  quick: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const editingValue = ref('')
const focused = ref(false),
  error = ref('')
const shown = computed(() => (focused.value ? editingValue.value : displayAmount(props.modelValue)))
function focus(event: FocusEvent) {
  // Keep the displayed text stable while the user selects or replaces it.
  editingValue.value = (event.target as HTMLInputElement).value
  focused.value = true
}
function input(event: Event) {
  error.value = ''
  editingValue.value = (event.target as HTMLInputElement).value
  emit('update:modelValue', normalizeAmountInput(editingValue.value))
}
function add(step: bigint) {
  try {
    emit('update:modelValue', incrementAmount(props.modelValue, step))
    error.value = ''
  } catch (e) {
    error.value = message(e)
  }
}
function clear() {
  emit('update:modelValue', '')
  error.value = ''
}
</script>
<template>
  <div class="amount-control">
    <input
      :value="shown"
      type="text"
      inputmode="numeric"
      enterkeyhint="next"
      autocomplete="off"
      pattern="[0-9,]*"
      maxlength="25"
      required
      placeholder="0"
      :aria-label="label"
      @input="input"
      @focus="focus"
      @blur="focused = false"
    />
    <div v-if="quick" class="quick-amounts" aria-label="빠른 금액 입력">
      <button type="button" class="secondary" @click="add(1000n)">＋1천</button>
      <button type="button" class="secondary" @click="add(10000n)">＋1만</button>
      <button type="button" class="secondary" @click="add(50000n)">＋5만</button>
      <button type="button" class="text-button" @click="clear">초기화</button>
    </div>
    <p
      v-if="quick && modelValue && /^\d+$/.test(modelValue)"
      class="amount-preview"
      aria-live="polite"
    >
      {{ displayAmount(modelValue) }}원
    </p>
    <p v-if="error" class="danger small" role="alert">{{ error }}</p>
  </div>
</template>

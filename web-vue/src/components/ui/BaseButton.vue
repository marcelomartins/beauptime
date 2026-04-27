<script setup lang="ts">
defineProps<{
  variant?: 'primary' | 'ghost'
  type?: 'button' | 'submit' | 'reset'
}>()
</script>

<template>
  <button class="button" :class="variant ?? 'primary'" :type="type ?? 'button'">
    <slot />
  </button>
</template>

<style scoped>
.button {
  border: 1px solid transparent;
  border-radius: 999px;
  min-height: 44px;
  padding: 0 18px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 180ms ease, opacity 180ms ease, background-color 180ms ease, border-color 180ms ease, color 180ms ease;
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #f8fbff;
  box-shadow: var(--shadow);
}

.ghost {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.ghost:hover:not(:disabled) {
  background: var(--surface-muted);
}
</style>

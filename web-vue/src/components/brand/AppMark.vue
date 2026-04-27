<template>
  <svg class="app-mark" viewBox="0 0 96 96" role="img" aria-label="BeaUptime logo">
    <rect class="app-mark__frame" x="10" y="10" width="76" height="76" rx="24" />
    <rect class="app-mark__bar" x="19" y="26" width="16" height="46" rx="8" />
    <rect class="app-mark__bar" x="40" y="26" width="16" height="46" rx="8" />
    <rect class="app-mark__bar" x="61" y="26" width="16" height="46" rx="8" />
  </svg>
</template>

<style scoped>
.app-mark {
  display: block;
}

.app-mark__frame {
  fill: var(--surface);
  stroke: color-mix(in srgb, var(--success) 22%, var(--border-strong));
  stroke-width: 4;
}

.app-mark__bar {
  fill: var(--success);
}
</style>

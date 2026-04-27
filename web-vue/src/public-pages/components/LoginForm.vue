<script setup lang="ts">
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAuth } from '@/modules/auth/auth'

const router = useRouter()
const { login, loading, errorMessage, session } = useAuth()

const form = reactive({
  password: '',
})

const submit = async () => {
  await login(form)

  if (session.value?.authenticated) {
    await router.push('/dashboard')
  }
}
</script>

<template>
  <form class="login-form" @submit.prevent="submit">
    <label>
      <span>{{ $t('auth.fields.password') }}</span>
      <input v-model="form.password" autocomplete="current-password" type="password" required />
    </label>

    <p class="helper">{{ $t('auth.passwordOnlyHint') }}</p>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <BaseButton type="submit">{{ loading ? $t('auth.actions.loginPending') : $t('auth.actions.login') }}</BaseButton>
  </form>
</template>

<style scoped>
.login-form {
  display: grid;
  gap: 16px;
}

label {
  display: grid;
  gap: 8px;
  font-weight: 700;
  color: var(--text-soft);
}

input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 16px;
  min-height: 50px;
  padding: 0 16px;
  background: var(--surface);
  color: var(--text);
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.helper {
  margin: -4px 0 0;
  color: var(--text-soft);
  font-size: 0.95rem;
}

.error {
  margin: 0;
  color: var(--danger);
}

.login-form :deep(.button) {
  width: 100%;
}
</style>

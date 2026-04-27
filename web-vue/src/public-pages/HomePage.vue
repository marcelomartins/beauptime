<script setup lang="ts">
import AppMark from '@/components/brand/AppMark.vue'
import LoginForm from './components/LoginForm.vue'
</script>

<template>
  <div class="landing-page">
    <section class="hero-card shell-card">
      <div class="hero-copy">
        <span class="eyebrow">{{ $t('home.badge') }}</span>

        <div class="brand-lockup">
          <AppMark class="brand-logo" />

          <div class="brand-copy">
            <h1>{{ $t('app.name') }}</h1>
            <p>{{ $t('home.title') }}</p>
          </div>
        </div>

        <p class="hero-description">{{ $t('home.description') }}</p>

      </div>

      <aside class="login-card">
        <div class="login-header">
          <h2>{{ $t('home.loginTitle') }}</h2>
          <p>{{ $t('home.loginDescription') }}</p>
        </div>

        <LoginForm />
      </aside>
    </section>
  </div>
</template>

<style scoped>
.landing-page {
  width: min(1180px, 100%);
}

.shell-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 28px;
  box-shadow: var(--shadow-lg);
}

.hero-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
  gap: 24px;
  padding: 24px;
  width: 100%;
  align-items: stretch;
}

.hero-copy {
  display: grid;
  gap: 18px;
  align-content: start;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-faint);
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 18px;
}

.brand-logo {
  width: 92px;
  height: 92px;
  flex: 0 0 auto;
  filter: drop-shadow(0 16px 28px rgba(37, 99, 235, 0.18));
}

.brand-copy {
  display: grid;
  gap: 8px;
}

.brand-copy h1 {
  font-size: clamp(2.2rem, 6vw, 3.4rem);
  font-weight: 800;
  color: var(--text);
  margin: 0;
  line-height: 0.95;
  letter-spacing: -0.05em;
}

.brand-copy p,
.hero-description,
.login-header p {
  margin: 0;
  color: var(--text-soft);
  line-height: 1.6;
}

.brand-copy p {
  font-size: 1rem;
  max-width: 34ch;
}

.hero-description {
  font-size: 0.95rem;
  max-width: 42ch;
}

.utility-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  max-width: 520px;
}

.utility-item {
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid var(--border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--surface)), var(--surface));
  display: grid;
  gap: 6px;
}

.utility-item strong {
  color: var(--text);
  font-size: 0.92rem;
}

.utility-item span {
  color: var(--text-soft);
  font-size: 0.86rem;
  line-height: 1.45;
}

.login-card {
  width: 100%;
  padding: 22px;
  border-radius: 24px;
  border: 1px solid var(--border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, var(--surface)), var(--surface) 44%);
  display: grid;
  gap: 18px;
}

.login-header {
  display: grid;
  gap: 6px;
}

.login-header h2 {
  font-size: 1.35rem;
  font-weight: 800;
  margin: 0;
  color: var(--text);
}

@media (max-width: 980px) {
  .hero-card {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hero-card {
    padding: 20px;
    border-radius: 22px;
    gap: 20px;
  }

  .brand-lockup {
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }

  .brand-logo {
    width: 74px;
    height: 74px;
  }

  .utility-strip {
    grid-template-columns: 1fr;
  }

  .login-card {
    padding: 20px;
  }
}
</style>

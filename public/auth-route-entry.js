import { normalizeAuthConfig } from './auth-account-state.js';
import { guardAuthRoute, markAuthRouteReady } from './auth-browser-context.js';
import { SupabaseAuthClient } from './supabase-auth-client.js';

async function startAuthPage() {
  const config = normalizeAuthConfig(window.__MINUTO106_CONFIG__);
  const client = config.available ? new SupabaseAuthClient(config) : null;
  try {
    const guard = await guardAuthRoute({
      client,
      config: window.__MINUTO106_CONFIG__,
      access: window.Minuto106Access,
      storage: window.localStorage,
      location: window.location,
      document,
    });
    if (guard.redirected) return;
  } catch {
    markAuthRouteReady(document);
  }
  await import('./auth-page-controller.js');
}

startAuthPage().catch(() => {
  markAuthRouteReady(document);
  document.documentElement.dataset.authRouteGuard = 'failed';
});

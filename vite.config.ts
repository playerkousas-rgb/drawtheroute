import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(async () => {
  const plugins: PluginOption[] = [react(), tailwindcss()];
  try {
    // @ts-expect-error - optional module that may not exist at build time
    const m = await import('./.vite-source-tags.js');
    plugins.push(m.sourceTags());
  } catch {}
  // allowedHosts: true (allow-all) is required so the live-preview host can reach the dev server
  return { plugins, server: { host: true, allowedHosts: true as const } };
})

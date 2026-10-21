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
  } catch { /* optional module that may not exist at build time */ }
  // allowedHosts: true (allow-all) is required so the live-preview host can reach the dev server
  return {
    plugins,
    server: { host: true, allowedHosts: true as const },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes('node_modules')) {
              if (id.includes('leaflet')) return 'leaflet';
              if (id.includes('recharts')) return 'recharts';
              if (id.includes('framer-motion') || id.includes('lucide-react') || id.includes('proj4') || id.includes('file-saver') || id.includes('html2canvas') || id.includes('xlsx')) return 'vendor';
              if (id.includes('react')) return 'vendor';
            }
          },
        },
      },
    },
  };
})

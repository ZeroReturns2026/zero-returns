import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// We build an IIFE bundle so the theme extension can drop a single <script> tag.
// Output: dist/sizing-widget.js + dist/sizing-widget.css
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.tsx'),
      name: 'HeyTailorWidget',
      fileName: () => 'sizing-widget.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (asset) => {
          if (asset.name?.endsWith('.css')) return 'sizing-widget.css';
          return 'assets/[name][extname]';
        },
      },
    },
    emptyOutDir: true,
    cssCodeSplit: false,
  },
});

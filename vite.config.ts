import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative base ensures assets load reliably on any GitHub Pages repo URL or custom domain
  base: './',
  plugins: [react(), tailwindcss()],
});

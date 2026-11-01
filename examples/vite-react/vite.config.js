import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import updatify from 'react-updatify';

export default defineConfig({
  plugins: [react(), updatify()],
});

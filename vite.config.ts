import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: Vite không chạy thư mục /api của Vercel, nên tự phục vụ /api/check-link bằng đúng code đó.
const devCheckLink = (): Plugin => ({
  name: 'dev-check-link',
  configureServer(server) {
    server.middlewares.use('/api/check-link', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const mod = await server.ssrLoadModule('/api/check-link.ts');
      const r: Response = await mod.default(new Request('http://localhost/api/check-link', { method: req.method, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }));
      res.statusCode = r.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(await r.text());
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devCheckLink()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});

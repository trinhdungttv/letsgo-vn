import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: Vite không chạy thư mục /api của Vercel, nên tự phục vụ các route /api cần dùng bằng đúng code đó.
const DEV_API_ROUTES = ['check-link', 'resolve-map'];
const devApi = (): Plugin => ({
  name: 'dev-api',
  configureServer(server) {
    // api/resolve-map đọc biến Supabase từ process.env như trên Vercel
    const env = loadEnv(server.config.mode, process.cwd(), '');
    for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) if (env[k] && !process.env[k]) process.env[k] = env[k];
    for (const route of DEV_API_ROUTES) {
      server.middlewares.use(`/api/${route}`, async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule(`/api/${route}.ts`);
        const headers = new Headers();
        for (const k of ['content-type', 'x-letsgo-token']) {
          const v = req.headers[k];
          if (typeof v === 'string') headers.set(k, v);
        }
        const r: Response = await mod.default(new Request(`http://localhost/api/${route}`, {
          method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        }));
        res.statusCode = r.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(await r.text());
      });
    }
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devApi()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});

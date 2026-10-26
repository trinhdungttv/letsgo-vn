import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { RELEASE_NOTES } from './src/lib/releaseNotes';
import { cleanNotes, DEV_BUILD_ID, MAX_NOTES_IN_VERSION_FILE } from './src/lib/releaseUpdate';

// Dev: Vite không chạy thư mục /api của Vercel, nên tự phục vụ các route /api cần dùng bằng đúng code đó.
const DEV_API_ROUTES = ['check-link', 'resolve-map', 'osm-tile'];
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
        for (const k of ['content-type', 'x-letsgo-token', 'referer']) {
          const v = req.headers[k];
          if (typeof v === 'string') headers.set(k, v);
        }
        // req.url ở đây đã bỏ tiền tố /api/<route> → giữ lại phần query (?z=&x=&y= của osm-tile)
        const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
        const r: Response = await mod.default(new Request(`http://localhost/api/${route}${query}`, {
          method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        }));
        res.statusCode = r.status;
        res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/json');
        const cache = r.headers.get('cache-control');
        if (cache) res.setHeader('Cache-Control', cache);
        res.end(Buffer.from(await r.arrayBuffer()));
      });
    }
  },
});

// Popup "Có phiên bản mới": mỗi lần build có 1 mã (commit SHA của Vercel, không có thì giờ build) được nhúng vào bundle
// VÀ ghi ra dist/version.json cùng danh sách release notes (src/lib/releaseNotes.ts). Trang đang mở định kỳ tải
// /version.json — mã khác mã trong bundle của nó = server đã có bản mới. Không cần biến môi trường nào.
const releaseVersion = (): Plugin => {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim().slice(0, 7);
  const builtAt = new Date().toISOString();
  const buildId = sha || `t${builtAt.replace(/\D/g, '').slice(0, 14)}`;
  const notes = cleanNotes(RELEASE_NOTES).slice(0, MAX_NOTES_IN_VERSION_FILE);
  const releaseId = notes[0]?.id ?? '';
  return {
    name: 'release-version',
    // Chạy dev: mã 'dev' → popup không bao giờ hiện
    config: (_c, env) => ({ define: { __APP_BUILD_ID__: JSON.stringify(env.command === 'build' ? buildId : DEV_BUILD_ID), __APP_RELEASE_ID__: JSON.stringify(releaseId) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId, builtAt, releaseId, notes }, null, 2) });
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devApi(), releaseVersion()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});

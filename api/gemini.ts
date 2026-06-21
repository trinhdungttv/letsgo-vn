// Vercel Serverless Function (Edge) — proxy goi Google Gemini de KHONG lo API key ra client bundle.
//
// Cau hinh bat buoc (lam 1 lan):
//   Vercel > Project > Settings > Environment Variables > them GEMINI_API_KEY (KHONG co tien to VITE_).
//   Sau do rotate (thu hoi + tao moi) key cu trong Google AI Studio vi key cu da tung nam trong bundle.
//
// Client (src/lib/gemini.ts) POST len day voi body { model, body }; function nay gan key o phia server.

export const config = { runtime: 'edge' };

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: 'Server chua cau hinh GEMINI_API_KEY' }, 500);
  }

  let payload: { model?: string; body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body khong hop le' }, 400);
  }

  const model = typeof payload.model === 'string' && payload.model ? payload.model : 'gemini-2.5-flash';

  const upstream = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload.body ?? {}),
  });

  // Chuyen nguyen status + body cua Gemini ve client de logic xu ly loi (429/503...) van hoat dong.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

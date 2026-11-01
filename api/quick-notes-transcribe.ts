// Vercel Serverless Function (Edge) — CHEP LOI + TOM TAT 1 ban ghi am cua "Ghi chu nhanh" bang Gemini 2.5 Flash.
//
// POST { recording_id }  (header x-letsgo-token)  ->  luong NDJSON (moi dong 1 JSON, xem TranscribeEvent):
//   { type: 'status', text } · { type: 'delta', text } · { type: 'ping' } ·
//   { type: 'done', summary, transcript, truncated } · { type: 'error', error }
//
// Buoc: kiem phien (quick_notes_rpc 'whoami') -> doc ban ghi CUA CHINH nguoi do (khoa service_role) -> tai file tu
// bucket rieng tu 'quick-notes' -> gui Gemini (stream) -> luu transcript / summary vao quick_note_recordings
// (luu dan moi ~20 giay de bi ngat giua chung van con phan da chep).
// Edge phai tra byte dau tien trong 25 giay va stream toi da 300 giay -> tra luong ngay, gui 'ping' moi 10 giay.
// Ban ghi rat dai (> ~2 gio) co the khong kip / bi cat -> bao 'truncated'.
//
// Cau hinh: GEMINI_API_KEY (da co cho api/gemini.ts) + SUPABASE_SERVICE_ROLE_KEY (nhu api/quick-notes-audio.ts).
// Chi phi uoc tinh (gia Gemini 2.5 Flash): ~0,18 USD (~4.500-5.000d) cho 1 gio ghi am.
import { createClient } from '@supabase/supabase-js';
import { sessionUserId, TOKEN_HEADER } from './_letsgoSession';
import { geminiAudioStream } from './_geminiAudio';
import { splitTranscript, transcribePrompt, type TranscribeEvent } from '../src/lib/quickNotes/transcript';

export const config = { runtime: 'edge' };

const BUCKET = 'quick-notes';
const SAVE_EVERY_MS = 20_000;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const gemini = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  if (!base || !anon) return json({ error: 'Server chưa cấu hình Supabase' }, 500);
  if (!service) return json({ error: 'Server chưa cấu hình SUPABASE_SERVICE_ROLE_KEY' }, 503);
  if (!gemini) return json({ error: 'Server chưa cấu hình GEMINI_API_KEY' }, 503);

  const userId = await sessionUserId(req.headers.get(TOKEN_HEADER) ?? '');
  if (!userId) return json({ error: 'Phiên đăng nhập hết hạn — đăng nhập lại rồi thử.' }, 401);

  let recordingId = '';
  try {
    const body = (await req.json()) as { recording_id?: unknown };
    recordingId = typeof body?.recording_id === 'string' ? body.recording_id : '';
  } catch {
    return json({ error: 'Body khong hop le' }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return json({ error: 'Thiếu mã bản ghi âm' }, 400);

  const admin = createClient(base, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rec, error: recErr } = await admin
    .from('quick_note_recordings')
    .select('id, note_id, storage_path, mime_type')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (recErr) return json({ error: `Lỗi đọc bản ghi: ${recErr.message}` }, 500);
  if (!rec) return json({ error: 'Không tìm thấy bản ghi âm' }, 404);

  // Ghi chú đi kèm giúp Gemini nghe đúng tên người / công ty
  const { data: note } = await admin.from('quick_notes').select('body').eq('id', rec.note_id).eq('user_id', userId).maybeSingle();

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: TranscribeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          closed = true; // người dùng đã đóng trang
        }
      };
      const ping = setInterval(() => send({ type: 'ping' }), 10_000);
      let full = '';
      let lastSave = Date.now();
      // Lưu lần lượt (không chồng nhau) để bản lưu dở chậm không ghi đè bản cuối
      let queue: Promise<unknown> = Promise.resolve();
      const save = async (text: string) => {
        const { summary, transcript } = splitTranscript(text);
        const { error } = await admin.from('quick_note_recordings')
          .update({ summary: summary || null, transcript: transcript || null })
          .eq('id', rec.id).eq('user_id', userId);
        if (error) throw new Error(`Không lưu được bản chép: ${error.message}`);
        return { summary, transcript };
      };
      try {
        send({ type: 'status', text: 'Đang lấy file ghi âm…' });
        const { data: blob, error } = await admin.storage.from(BUCKET).download(rec.storage_path);
        if (error || !blob) throw new Error(`Không tải được file ghi âm: ${error?.message ?? 'không rõ'}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mime = (rec.mime_type || 'audio/webm').split(';')[0].trim();

        const result = await geminiAudioStream({
          bytes, mime, key: gemini,
          prompt: transcribePrompt(note?.body ?? ''),
          onStatus: text => send({ type: 'status', text }),
          onDelta: text => {
            full += text;
            send({ type: 'delta', text });
            if (Date.now() - lastSave > SAVE_EVERY_MS) {
              lastSave = Date.now();
              const snapshot = full;
              queue = queue.then(() => save(snapshot)).catch(() => {});
            }
          },
        });
        if (!result.text.trim()) throw new Error('Gemini không trả về nội dung nào.');
        const truncated = result.finishReason === 'MAX_TOKENS';
        await queue;
        const saved = await save(truncated ? `${result.text}\n(… bản ghi quá dài, phần cuối chưa được chép)` : result.text);
        send({ type: 'done', ...saved, truncated });
      } catch (e) {
        await queue;
        if (full.trim()) await save(`${full}\n(… bị dừng giữa chừng)`).catch(() => {});
        send({ type: 'error', error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(ping);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* đã đóng */ }
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

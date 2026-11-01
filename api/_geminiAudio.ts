// Dung chung cho route /api: gui 1 file ghi am cho Gemini va nhan ket qua dang chay chu (stream).
// Ten file bat dau bang "_" -> Vercel KHONG bien no thanh route rieng.
//
// Da thu that 01/11/2026 voi gemini-2.5-flash: nhan "audio/webm" (Chrome / MediaRecorder, khong co do dai trong file)
// va "audio/mp4" (Safari / iPhone); gui "video/webm" thi bi tu choi. File nho (<= 8 MB) gui thang trong request,
// file lon hon tai len Files API cua Gemini roi xoa ngay sau khi xong (Google tu xoa sau 48 gio neu xoa loi).

const API = 'https://generativelanguage.googleapis.com';
export const GEMINI_AUDIO_MODEL = 'gemini-2.5-flash';
const INLINE_MAX_BYTES = 8 * 1024 * 1024;

export interface GeminiAudioResult {
  text: string;
  finishReason: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Loi Gemini -> cau tieng Viet de hien cho nguoi dung. */
export function geminiErrorText(status: number, body: string): string {
  let msg = '';
  try {
    msg = (JSON.parse(body) as { error?: { message?: string } })?.error?.message ?? '';
  } catch {
    msg = body.slice(0, 200);
  }
  if (status === 429) return 'Gemini đang quá tải hoặc hết hạn mức — thử lại sau ít phút.';
  if (status === 400 && /api key/i.test(msg)) return 'GEMINI_API_KEY trên server không hợp lệ.';
  if (status === 403) return 'GEMINI_API_KEY chưa được phép dùng Gemini API.';
  if (status >= 500) return 'Gemini đang lỗi tạm thời — thử lại sau ít phút.';
  return `Gemini báo lỗi ${status}: ${msg || 'không rõ'}`;
}

async function uploadFile(bytes: Uint8Array, mime: string, key: string): Promise<{ uri: string; name: string }> {
  const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'letsgo-quick-note-audio' } }),
  });
  const url = start.headers.get('x-goog-upload-url');
  if (!start.ok || !url) throw new Error(geminiErrorText(start.status, await start.text()));
  const up = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: bytes,
  });
  if (!up.ok) throw new Error(geminiErrorText(up.status, await up.text()));
  type GFile = { name: string; uri: string; state?: string };
  let file = ((await up.json()) as { file: GFile }).file;
  // File âm thanh thường dùng được ngay; vẫn chờ tối đa ~60 giây nếu Gemini còn đang xử lý
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i += 1) {
    await sleep(2000);
    const r = await fetch(`${API}/v1beta/${file.name}?key=${key}`);
    if (r.ok) file = (await r.json()) as GFile;
  }
  if (file.state === 'FAILED') throw new Error('Gemini không đọc được file ghi âm này.');
  return { uri: file.uri, name: file.name };
}

/**
 * Gui file ghi am + cau lenh, goi onDelta voi tung doan chu Gemini tra ve. onStatus bao buoc dang lam.
 * Tra ve toan bo chu + ly do ket thuc ('STOP' = xong, 'MAX_TOKENS' = bi cat vi qua dai).
 */
export async function geminiAudioStream(opts: {
  bytes: Uint8Array;
  mime: string;
  prompt: string;
  key: string;
  onDelta: (text: string) => void;
  onStatus?: (text: string) => void;
}): Promise<GeminiAudioResult> {
  const { bytes, mime, prompt, key, onDelta, onStatus } = opts;
  let uploaded: { uri: string; name: string } | null = null;
  try {
    let audioPart: Record<string, unknown>;
    if (bytes.length <= INLINE_MAX_BYTES) {
      audioPart = { inline_data: { mime_type: mime, data: toBase64(bytes) } };
    } else {
      onStatus?.('Đang gửi file ghi âm cho Gemini…');
      uploaded = await uploadFile(bytes, mime, key);
      audioPart = { file_data: { mime_type: mime, file_uri: uploaded.uri } };
    }
    onStatus?.('Gemini đang nghe bản ghi…');
    const res = await fetch(`${API}/v1beta/models/${GEMINI_AUDIO_MODEL}:streamGenerateContent?alt=sse&key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [audioPart, { text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok || !res.body) throw new Error(geminiErrorText(res.status, await res.text()));

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let text = '';
    let finishReason = '';
    const handleLine = (line: string) => {
      const l = line.trim();
      if (!l.startsWith('data:')) return;
      type Chunk = { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; error?: { message?: string } };
      let j: Chunk;
      try {
        j = JSON.parse(l.slice(5)) as Chunk;
      } catch {
        return;
      }
      if (j.error) throw new Error(`Gemini báo lỗi: ${j.error.message ?? 'không rõ'}`);
      const c = j.candidates?.[0];
      const t = (c?.content?.parts ?? []).map(p => p.text ?? '').join('');
      if (t) {
        text += t;
        onDelta(t);
      }
      if (c?.finishReason) finishReason = c.finishReason;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (buf) handleLine(buf);
    if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason) && !text) {
      throw new Error(`Gemini dừng giữa chừng (${finishReason}).`);
    }
    return { text, finishReason };
  } finally {
    if (uploaded) {
      await fetch(`${API}/v1beta/${uploaded.name}?key=${key}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

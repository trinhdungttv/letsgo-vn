// ============================================================================
// CSKH — Tìm hiểu vùng miền (AI tổng hợp) — port PRM regionInsight.ts, gọi Gemini
// ----------------------------------------------------------------------------
// Hiểu vùng quê / nơi ở của người liên hệ để trò chuyện, chọn quà: nét đặc sắc, đặc thù,
// văn hoá, con người, ẩm thực, địa danh, người nổi tiếng quê ở đó. Gọi Gemini qua proxy
// api/gemini.ts với responseSchema (JSON đúng khuôn) — kết quả VẪN được làm sạch bằng
// sanitizeInsight() trước khi hiện. Khoá JSON giữ giống PRM (notable_people…).
// Hàm thuần (dựng yêu cầu + đọc kết quả), có test.
// ============================================================================

export interface NotablePerson {
  name: string;
  note: string;
}

export interface RegionInsight {
  highlights: string;
  traits: string;
  culture: string;
  people: string;
  food: string[];
  places: string[];
  notablePeople: NotablePerson[];
}

/** Khuôn JSON theo kiểu Schema của Gemini (OpenAPI rút gọn, kiểu viết HOA). */
export const REGION_SCHEMA = {
  type: 'OBJECT',
  required: ['highlights', 'traits', 'culture', 'people', 'food', 'places', 'notable_people'],
  propertyOrdering: ['highlights', 'traits', 'culture', 'people', 'food', 'places', 'notable_people'],
  properties: {
    highlights: { type: 'STRING', description: 'Nét đặc sắc nổi tiếng nhất, 1–2 câu' },
    traits: { type: 'STRING', description: 'Đặc thù vùng: địa lý, kinh tế, thế mạnh, khu công nghiệp — 2–3 câu' },
    culture: { type: 'STRING', description: 'Văn hoá, lễ hội, tín ngưỡng, dân tộc — 2–3 câu' },
    people: { type: 'STRING', description: 'Con người, tính cách, cách giao tiếp, điều nên/không nên khi làm việc — 2–3 câu' },
    food: { type: 'ARRAY', items: { type: 'STRING' }, description: '4–8 món ăn, đặc sản (hợp làm quà)' },
    places: { type: 'ARRAY', items: { type: 'STRING' }, description: '4–8 địa danh nổi tiếng' },
    notable_people: {
      type: 'ARRAY',
      description: 'Tối đa 8 lãnh đạo / người nổi tiếng chắc chắn quê ở vùng này',
      items: {
        type: 'OBJECT',
        required: ['name', 'note'],
        properties: {
          name: { type: 'STRING' },
          note: { type: 'STRING', description: 'Lĩnh vực / chức vụ (ghi "từng là" nếu không còn đương nhiệm) và quê cụ thể' },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  'Bạn là chuyên gia văn hoá, địa lý và nhân vật Việt Nam. Trả lời bằng tiếng Việt, ngắn gọn, đúng sự thật.',
  'Người dùng là nhân viên chăm sóc khách hàng doanh nghiệp, muốn hiểu vùng quê / nơi ở của một người đại diện khách hàng để trò chuyện, chọn quà và xây dựng quan hệ tốt hơn.',
  'Chỉ nêu lãnh đạo / người nổi tiếng mà bạn chắc chắn sinh ra hoặc có quê gốc ở vùng này; không chắc thì bỏ qua — ít còn hơn sai. Chức vụ có thể đã thay đổi: ghi "từng là" khi không chắc còn đương nhiệm.',
  'Từ 1/7/2025 Việt Nam sáp nhập tỉnh và bỏ cấp huyện; khi được hỏi về một tỉnh cũ hay huyện cũ, hãy nói về vùng đất đó theo bản sắc truyền thống.',
].join('\n');

/** Thân yêu cầu generateContent của Gemini (proxy api/gemini.ts chuyển nguyên). */
export function buildRegionRequest(region: string, context = ''): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      role: 'user',
      parts: [{ text: `Vùng cần tìm hiểu: ${region}.${context ? ` Bối cảnh: ${context}.` : ''}\nTổng hợp theo các mục trong schema.` }],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: REGION_SCHEMA,
      maxOutputTokens: 8192,
    },
  };
}

const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, n: number): string[] =>
  Array.isArray(v) ? v.map(x => str(x, 80)).filter(Boolean).slice(0, n) : [];

/** Làm sạch dữ liệu (từ AI hoặc đọc lại từ bộ nhớ máy) về đúng kiểu, bỏ phần rỗng/lạ. */
export function sanitizeInsight(raw: unknown): RegionInsight | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const people = r.notable_people ?? r.notablePeople;
  const insight: RegionInsight = {
    highlights: str(r.highlights),
    traits: str(r.traits),
    culture: str(r.culture),
    people: str(r.people),
    food: strList(r.food, 10),
    places: strList(r.places, 10),
    notablePeople: Array.isArray(people)
      ? people
        .map(p => ({ name: str((p as NotablePerson)?.name, 80), note: str((p as NotablePerson)?.note, 200) }))
        .filter(p => p.name)
        .slice(0, 10)
      : [],
  };
  const empty = !insight.highlights && !insight.traits && !insight.culture && !insight.people
    && insight.food.length === 0 && insight.places.length === 0 && insight.notablePeople.length === 0;
  return empty ? null : insight;
}

interface GeminiResponse {
  error?: string | { message?: string; code?: number };
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

/** Đọc kết quả generateContent; ném Error (tiếng Việt) khi lỗi / bị chặn / bị cắt / JSON hỏng. */
export function parseRegionResponse(data: unknown): RegionInsight {
  const d = (data ?? {}) as GeminiResponse;
  if (d.error) throw new Error(typeof d.error === 'string' ? d.error : d.error.message || 'AI báo lỗi');
  if (d.promptFeedback?.blockReason) throw new Error('AI từ chối yêu cầu này — thử lại sau.');
  const cand = d.candidates?.[0];
  const reason = cand?.finishReason ?? '';
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(reason)) throw new Error('AI từ chối yêu cầu này — thử lại sau.');
  if (reason === 'MAX_TOKENS') throw new Error('Câu trả lời bị cắt giữa chừng — bấm Làm mới để thử lại.');
  const text = (cand?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('');
  let parsed: unknown;
  try {
    // Phòng khi model vẫn bọc ```json … ```
    parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new Error('Không đọc được kết quả AI — bấm Làm mới để thử lại.');
  }
  const insight = sanitizeInsight(parsed);
  if (!insight) throw new Error('AI không trả về thông tin — bấm Làm mới để thử lại.');
  return insight;
}

/** Vùng có thể tìm hiểu của 1 người: quê quán, tỉnh nơi ở, tên nơi trong link Maps. */
export interface RegionCandidate {
  label: string;
  region: string;
  context: string;
}

export function regionCandidates(c: { originProvince: string; province: string }, placeName = ''): RegionCandidate[] {
  const out: RegionCandidate[] = [];
  const add = (label: string, region: string, context: string) => {
    const r = region.trim();
    if (r && !out.some(x => x.region.toLowerCase() === r.toLowerCase())) out.push({ label, region: r, context });
  };
  add(`Quê ${c.originProvince.trim()}`, c.originProvince, 'quê quán của người liên hệ');
  add(c.province.trim(), c.province, 'nơi người liên hệ đang sống và làm việc');
  add(placeName, placeName, 'nơi ở hiện tại theo link Google Maps');
  return out;
}

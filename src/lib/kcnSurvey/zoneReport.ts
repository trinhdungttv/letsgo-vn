// Báo cáo khảo sát 1 KCN để đưa AI khác (Gemini, ChatGPT…) đọc & phân tích lương / nhu cầu tuyển dụng của khu vực.
// Hàm thuần: gom dữ liệu chuyến / ảnh chỉ tiêu / ghi âm thành các phần của báo cáo (zonePdf.ts vẽ ra PDF chữ thật).
import type { SurveyPhoto, SurveyTrip, SurveyVoiceNote } from './api';
import { STATUS_META, type SurveyStatus } from './companies';
import { findStar, foldName, photoStarRef, type SurveyStar } from './stars';

export interface ZoneReportInput {
  zoneName: string;
  province: string | null;
  /** Báo cáo 1 chuyến: thêm vào tiêu đề (VD "chuyến 04/11/2026 08:15") và dùng `periodText` thay cho khoảng ngày */
  scope?: { label: string; periodText: string } | null;
  /** null = từ trước tới nay */
  from: Date | null;
  to: Date;
  trips: readonly SurveyTrip[];
  photos: readonly SurveyPhoto[];
  voice: readonly SurveyVoiceNote[];
  stars: readonly SurveyStar[];
}

export interface ReportCompany {
  name: string;
  starred: boolean;
  photos: number;
  /** vị trí tuyển (gộp, không trùng) */
  positions: string[];
  /** số lượng ở lần chụp gần nhất có ghi số lượng */
  headcount: number | null;
  /** các mức lương ghi trên bảng (không trùng, mới nhất trước) */
  wages: string[];
  firstAt: string;
  lastAt: string;
}

export interface ReportPhoto {
  photo: SurveyPhoto;
  starred: boolean;
  /** chữ ghi trên ảnh (công cụ vẽ ghi chú) */
  markText: string[];
}

export interface ZoneReport {
  title: string;
  periodText: string;
  summary: { trips: number; distanceM: number; photos: number; voice: number; companies: number; starred: number; headcount: number; withWage: number };
  companies: ReportCompany[];
  photos: ReportPhoto[];
  voice: SurveyVoiceNote[];
  passed: { status: SurveyStatus; label: string; names: string[] }[];
  trips: SurveyTrip[];
}

const fmtD = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.map(x => x.trim()).filter(x => { const k = foldName(x); if (!x || seen.has(k)) return false; seen.add(k); return true; });
};

export function buildZoneReport(i: ZoneReportInput): ZoneReport {
  const photos = [...i.photos].sort((a, b) => b.taken_at.localeCompare(a.taken_at));
  const starredOf = (p: SurveyPhoto) => !!findStar(i.stars, photoStarRef(p));

  // Theo công ty: ảnh không ghi tên công ty gom chung 1 dòng
  const byCo = new Map<string, SurveyPhoto[]>();
  for (const p of photos) {
    const k = foldName(p.company_name) || '—';
    const l = byCo.get(k);
    if (l) l.push(p); else byCo.set(k, [p]);
  }
  const companies: ReportCompany[] = [...byCo.values()].map(list => ({
    name: list[0].company_name.trim() || 'Chưa rõ công ty',
    starred: list.some(starredOf),
    photos: list.length,
    positions: uniq(list.flatMap(p => p.positions.split(/[,;\n]/))),
    headcount: list.find(p => p.headcount != null)?.headcount ?? null,
    wages: uniq(list.map(p => p.wage_text)),
    firstAt: list[list.length - 1].taken_at,
    lastAt: list[0].taken_at,
  })).sort((a, b) => Number(b.starred) - Number(a.starred) || b.lastAt.localeCompare(a.lastAt));

  const passedBy = new Map<SurveyStatus, Set<string>>();
  for (const t of i.trips) for (const p of t.passed) {
    const st = (STATUS_META[p.status] ? p.status : 'osm') as SurveyStatus;
    let s = passedBy.get(st);
    if (!s) { s = new Set(); passedBy.set(st, s); }
    s.add(p.name.trim());
  }
  const passed = [...passedBy.entries()].sort((a, b) => STATUS_META[a[0]].rank - STATUS_META[b[0]].rank)
    .map(([status, names]) => ({ status, label: STATUS_META[status].label, names: [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi')) }));

  const real = companies.filter(c => c.name !== 'Chưa rõ công ty');
  return {
    title: `Khảo sát tuyển dụng — ${i.zoneName}${i.province ? ` (${i.province})` : ''}${i.scope ? ` — ${i.scope.label}` : ''}`,
    periodText: i.scope ? i.scope.periodText : i.from ? `${fmtD(i.from)} – ${fmtD(i.to)}` : `Toàn bộ dữ liệu tới ${fmtD(i.to)}`,
    summary: {
      trips: i.trips.length,
      distanceM: i.trips.reduce((m, t) => m + t.distance_m, 0),
      photos: photos.length,
      voice: i.voice.length,
      companies: real.length,
      starred: real.filter(c => c.starred).length,
      headcount: real.reduce((m, c) => m + (c.headcount ?? 0), 0),
      withWage: real.filter(c => c.wages.length).length,
    },
    companies,
    photos: photos.map(p => ({
      photo: p,
      starred: starredOf(p),
      markText: p.annotations.flatMap(m => (m.t === 'text' && m.text.trim() ? [m.text.trim()] : [])),
    })),
    voice: [...i.voice].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)),
    passed,
    trips: [...i.trips].sort((a, b) => b.started_at.localeCompare(a.started_at)),
  };
}

/** Đoạn mở đầu cho AI đọc: tài liệu là gì, từng trường nghĩa là gì, nên phân tích gì. */
export function reportIntro(r: ZoneReport): string[] {
  return [
    `Tài liệu tổng hợp dữ liệu khảo sát thực địa tại ${r.title.replace(/^Khảo sát tuyển dụng — /, '')}, thời gian: ${r.periodText}.`
      + ' Người khảo sát đi xe quanh KCN, chụp bảng thông báo tuyển dụng treo ở cổng các nhà máy và ghi lại nội dung.',
    'Mỗi mục ở phần "Chi tiết từng bảng tuyển dụng" là 1 ảnh: ngày chụp, công ty, vị trí đang tuyển, số lượng, mức lương ghi'
      + ' trên bảng (giữ nguyên chữ trên bảng), ghi chú của người khảo sát. Ảnh bảng tuyển dụng (nếu có) nằm ngay dưới mỗi mục.'
      + ' Nhãn [Chú trọng] = công ty người khảo sát gắn sao, cần chú trọng.'
      + ' Nhãn [Online - Chưa xác thực] = ảnh tuyển dụng lấy trên mạng, vị trí theo link Google Maps, người khảo sát chưa tới tận nơi kiểm tra — độ tin cậy thấp hơn ảnh chụp thực địa.',
    'Gợi ý phân tích: mặt bằng lương theo vị trí (thấp nhất / phổ biến / cao nhất), công ty tuyển nhiều nhất, vị trí đang thiếu,'
      + ' phúc lợi hay được nhắc (xe đưa đón, cơm, phụ cấp…), xu hướng theo thời gian nếu có nhiều lần khảo sát.',
  ];
}

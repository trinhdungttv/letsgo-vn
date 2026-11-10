// PHÁP NHÂN cho giấy tờ = thông tin ở Pháp lý (Workspace → Pháp lý, bảng legal_entities — nguồn đầy đủ, DUY NHẤT)
// + bộ ký/dấu ở quote_entities (chữ ký, con dấu, cách căn, nơi ký, người ký khác, logo riêng nếu cần).
// Thuần, có test (legalLink.test.ts). Gọi từ listEntities (lib/costPlan/api.ts) nên MỌI nơi dùng pháp nhân
// (báo giá PDF, báo giá theo file Excel mẫu, danh sách vào cổng ở CSKH → Đi họp) đều nhận dữ liệu đã gộp.
//
// Ghép bộ ký/dấu với pháp nhân Pháp lý theo thứ tự: quote_entities.legal_entity_id (migration 219) →
// legal_entities.quote_entity_id (nút "Lấy từ pháp nhân báo giá" ở Pháp lý) → cùng MST → cùng tên (bỏ dấu).
import { foldVn } from '../companyMatch';
import { DEFAULT_LAYOUT, type LegalEntityLite, type QuoteEntity, type StampRow } from './entity';
import { emptyProfile, type CompanyProfileData } from './quoteDoc';

/** Tên tự đặt kiểu "Pháp nhân 1" — không nói lên gì, nên thay bằng tên viết tắt của công ty. */
export const isGenericLabel = (s: string) => /^\s*(pháp nhân|phap nhan)\s*\d*\s*$/i.test(s.normalize('NFC')) || !s.trim();

// Cụm loại hình đứng đầu tên công ty (dạng có dấu, so khớp không phân biệt hoa thường). Cụm dài trước.
const PREFIXES = [
  'chi nhánh công ty trách nhiệm hữu hạn một thành viên', 'chi nhánh công ty trách nhiệm hữu hạn', 'chi nhánh công ty cổ phần',
  'chi nhánh công ty tnhh mtv', 'chi nhánh công ty tnhh', 'chi nhánh công ty cp',
  'công ty trách nhiệm hữu hạn một thành viên', 'công ty trách nhiệm hữu hạn', 'công ty cổ phần',
  'công ty tnhh một thành viên', 'công ty tnhh mtv', 'công ty tnhh', 'công ty cp', 'cty tnhh mtv', 'cty tnhh', 'cty cp', 'ctcp',
  'tổng công ty', 'công ty', 'cty',
];

/** "CÔNG TY CỔ PHẦN LET'S GO VN" → "LET'S GO VN"; "Công ty TNHH MTV ABC" → "ABC". Không bỏ được gì → giữ nguyên. */
export function shortEntityName(name: string | null | undefined): string {
  const s = (name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const low = s.toLocaleLowerCase('vi-VN');
  for (const p of PREFIXES) {
    if (low.startsWith(p + ' ')) {
      const rest = s.slice(p.length).replace(/^[\s\-–—:,.]+/, '').trim();
      if (rest) return rest;
    }
  }
  return s;
}

const taxDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const nameKey = (s: string | null | undefined) => foldVn(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** Bộ ký/dấu cũ (chưa gắn) có phải của pháp nhân Pháp lý này không: cùng MST, hoặc cùng tên (bỏ dấu, bỏ ký tự lạ). */
export function sameCompany(data: Pick<CompanyProfileData, 'name' | 'taxCode'>, legal: Pick<LegalEntityLite, 'name' | 'tax_code'>): boolean {
  const a = taxDigits(data.taxCode), b = taxDigits(legal.tax_code);
  if (a.length >= 8 && a === b) return true;
  const n1 = nameKey(data.name), n2 = nameKey(legal.name);
  return !!n1 && n1 === n2;
}

const pick = (legal: string | null | undefined, own: string) => ((legal ?? '').trim() ? (legal ?? '').trim() : own);

function fromLegal(l: LegalEntityLite, s: StampRow | null, order: number, logos: ReadonlyMap<string, string>): QuoteEntity {
  const own = s?.data ?? emptyProfile();
  const data: CompanyProfileData = {
    name: pick(l.name, own.name), address: pick(l.address, own.address), taxCode: pick(l.tax_code, own.taxCode),
    phone: pick(l.phone, own.phone), email: pick(l.email, own.email), website: pick(l.website, own.website),
    // Người ký / chức danh: ghi riêng ở bộ ký/dấu (vd người được uỷ quyền) → dùng; để trống → người đại diện theo pháp luật
    // ở Pháp lý. Đã ghi người ký khác mà chưa ghi chức danh → để trống (không lấy chức danh của người đại diện).
    signerName: own.signerName.trim() ? own.signerName : (l.legal_rep ?? '').trim(),
    signerTitle: own.signerTitle.trim() ? own.signerTitle : own.signerName.trim() ? '' : (l.legal_rep_title ?? '').trim(),
    place: own.place,
  };
  const layout = s?.layout ?? DEFAULT_LAYOUT;
  const ownLogo = s?.logo ?? null;
  const legalLogo = l.logo_url ? logos.get(l.logo_url) ?? null : null;
  const useOwn = !!ownLogo && (!legalLogo || layout.logoOwn === true);
  return {
    id: l.id,
    label: (l.short_name ?? '').trim() || shortEntityName(data.name) || (s && !isGenericLabel(s.label) ? s.label : '') || 'Pháp nhân',
    data, layout,
    logo: useOwn ? ownLogo : legalLogo ?? ownLogo,
    logo_source: useOwn ? 'own' : legalLogo ? 'legal' : ownLogo ? 'own' : null,
    signature: s?.signature ?? null, seal: s?.seal ?? null,
    has_signature: !!s?.has_signature, has_seal: !!s?.has_seal,
    sort_order: order, updated_by_name: s?.updated_by_name ?? null, updated_at: s?.updated_at ?? null,
    stamp_id: s?.id ?? null, legal_id: l.id, legal: l,
    own: { label: s?.label ?? '', data: own, logo: ownLogo },
  };
}

function fromStamp(s: StampRow, order: number): QuoteEntity {
  return {
    id: s.id,
    label: isGenericLabel(s.label) ? shortEntityName(s.data.name) || s.label || 'Pháp nhân' : s.label,
    data: s.data, layout: s.layout, logo: s.logo, logo_source: s.logo ? 'own' : null,
    signature: s.signature, seal: s.seal, has_signature: s.has_signature, has_seal: s.has_seal,
    sort_order: order, updated_by_name: s.updated_by_name, updated_at: s.updated_at,
    stamp_id: s.id, legal_id: null, legal: null,
    own: { label: s.label, data: s.data, logo: s.logo },
  };
}

/**
 * Gộp danh sách: mọi pháp nhân CÒN HOẠT ĐỘNG ở Pháp lý (đúng thứ tự bên đó, đã giải thể thì ẩn) kèm bộ ký/dấu của nó,
 * rồi tới các bộ ký/dấu cũ chưa gắn được vào pháp nhân nào (vẫn dùng được, có nút gắn vào Pháp lý).
 * `logos`: link logo Pháp lý → ảnh data URL đã tải sẵn (PDF / Excel cần ảnh nhúng); thiếu → dùng logo riêng.
 */
export function mergeEntities(stamps: readonly StampRow[], legals: readonly LegalEntityLite[], logos: ReadonlyMap<string, string> = new Map()): QuoteEntity[] {
  const legalIds = new Set(legals.map(l => l.id));
  const active = legals.filter(l => l.status !== 'dissolved');
  const byLegal = new Map<string, StampRow>();
  const claimed = new Set<string>();
  const take = (l: LegalEntityLite, s: StampRow) => { byLegal.set(l.id, s); claimed.add(s.id); };
  // 1. đã gắn rõ (migration 219) — kể cả pháp nhân đã giải thể (để bộ ký/dấu đó không hiện lẻ loi)
  for (const s of stamps) {
    if (s.legal_entity_id && legalIds.has(s.legal_entity_id) && !byLegal.has(s.legal_entity_id)) { byLegal.set(s.legal_entity_id, s); claimed.add(s.id); }
  }
  const free = (s: StampRow) => !claimed.has(s.id) && !(s.legal_entity_id && legalIds.has(s.legal_entity_id));
  // 2. Pháp lý đã ghi "lấy từ pháp nhân báo giá"
  for (const l of active) {
    if (byLegal.has(l.id) || !l.quote_entity_id) continue;
    const s = stamps.find(x => x.id === l.quote_entity_id && free(x));
    if (s) take(l, s);
  }
  // 3. cùng MST / cùng tên
  for (const l of active) {
    if (byLegal.has(l.id)) continue;
    const s = stamps.find(x => free(x) && sameCompany(x.data, l));
    if (s) take(l, s);
  }
  const out = active.map((l, i) => fromLegal(l, byLegal.get(l.id) ?? null, i, logos));
  for (const s of stamps) if (free(s)) out.push(fromStamp(s, out.length));
  return out;
}

/** Map tra cứu theo cả id mới lẫn id bộ ký/dấu cũ (giấy tờ cũ lưu id cũ). */
export function entityIndex<T extends Pick<QuoteEntity, 'id' | 'stamp_id'>>(list: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const e of list) { m.set(e.id, e); if (e.stamp_id && !m.has(e.stamp_id)) m.set(e.stamp_id, e); }
  return m;
}

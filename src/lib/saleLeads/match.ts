// ============================================================================
// Bảng nháp đầu mối Sale / CTV — so khớp (file thuần, test ở saleLeads.test.ts):
//   • cột "Khu vực" chữ → mã KCN trong danh mục (Thị trường → Khu vực), "VSIP 1-2" = VSIP 1 + VSIP 2;
//   • tên đơn vị → đối thủ trong Thị trường ("TTN HR" = "TTN - HR ( Tâm Thiện Nhi )");
//   • DÒ TRÙNG SĐT với: bảng nháp, danh sách Sale / CTV, người liên hệ của khách hàng.
// ============================================================================
import { zoneKey } from '../zoneMatch';
import { fold, phoneKeysOf, type LeadDraft } from './parse';
import type { SaleLead } from './types';

export interface NamedItem {
  id: string;
  name: string;
}

// ── Khu vực / KCN ───────────────────────────────────────────────────────────
/**
 * Tách ô khu vực thành từng KCN: "KCN Mỹ Phước 3, KCN VSIP 2" → 2 mục; "KCN VSIP 1-2" → VSIP 1 + VSIP 2;
 * "VSIP 1, 2A" → VSIP 1 + VSIP 2A (số đứng riêng mượn tên của mục trước).
 */
export function splitAreaText(text: string | null | undefined): string[] {
  const parts = (text ?? '').split(/[,;\n]+|\s+(?:và|va|\+)\s+/i).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: string[] = [];
  let prefix = '';
  for (const p of parts) {
    const full = /^\d{1,2}[A-Za-z]?$/.test(p) && prefix ? `${prefix}${p}` : p;
    const range = full.match(/^(.*?\D)\s*(\d{1,2})\s*[-–&]\s*(\d{1,2})$/);
    if (range) {
      const a = Number(range[2]);
      const b = Number(range[3]);
      if (b > a && b - a <= 5) {
        const base = range[1].trimEnd();
        for (let i = a; i <= b; i++) out.push(`${base} ${i}`);
        prefix = `${base} `;
        continue;
      }
    }
    out.push(full);
    const pm = full.match(/^(.*?\D)\s*\d{1,2}[A-Za-z]?$/);
    prefix = pm ? `${pm[1].trimEnd()} ` : '';
  }
  return [...new Set(out)];
}

/** Ghép chữ khu vực với danh mục KCN (so chặt sau khi bỏ dấu + bỏ chữ "KCN"). */
export function matchAreaZones(text: string, zones: readonly NamedItem[]): { ids: string[]; unmatched: string[] } {
  const byKey = new Map<string, string>();
  for (const z of zones) {
    const k = zoneKey(z.name);
    if (k && !byKey.has(k)) byKey.set(k, z.id);
  }
  const ids: string[] = [];
  const unmatched: string[] = [];
  for (const part of splitAreaText(text)) {
    const id = byKey.get(zoneKey(part));
    if (id) { if (!ids.includes(id)) ids.push(id); } else unmatched.push(part);
  }
  return { ids, unmatched };
}

/** Phần chữ khu vực KHÔNG nằm trong các KCN đã chọn — hiện xám "chưa có trong danh mục". */
export function unmatchedAreaParts(areaText: string, zoneIds: readonly string[], zones: readonly NamedItem[]): string[] {
  const chosen = new Set(zones.filter(z => zoneIds.includes(z.id)).map(z => zoneKey(z.name)));
  return splitAreaText(areaText).filter(p => !chosen.has(zoneKey(p)));
}

// ── Đơn vị → đối thủ ────────────────────────────────────────────────────────
const GENERIC_WORDS = /\b(cong ty|cty|tnhh|mtv|co phan|cp|jsc|ltd|co ltd|hr|tuyen dung|nhan luc|nhan su|viec lam|vina|vn|group|thoi vu)\b/g;

/** Khoá so tên đơn vị: tên chính + tên trong ngoặc, bỏ chữ chung (HR, tuyển dụng, nhân lực, vina…). */
export function companyKeys(name: string | null | undefined): string[] {
  const f = fold(name).replace(/[_\-–—./]/g, ' ');
  const main = f.replace(/\(.*?\)/g, ' ');
  const inner = Array.from(f.matchAll(/\((.*?)\)/g), m => m[1]);
  return [...new Set([main, ...inner]
    .map(s => s.replace(GENERIC_WORDS, ' ').replace(/[^a-z0-9]/g, ''))
    .filter(k => k.length >= 3))];
}

/** Đơn vị trùng tên 1 đối thủ trong Thị trường → đối thủ đó (để gợi ý "Đang làm cho đối thủ"). */
export function matchCompetitor<T extends NamedItem>(company: string, competitors: readonly T[]): T | null {
  const keys = companyKeys(company);
  if (!keys.length) return null;
  return competitors.find(c => companyKeys(c.name).some(k => keys.includes(k))) ?? null;
}

// ── Dò trùng SĐT ────────────────────────────────────────────────────────────
export type PhoneOwnerKind = 'lead' | 'sale' | 'client';
export const OWNER_LABEL: Readonly<Record<PhoneOwnerKind, string>> = {
  lead: 'Đã có trong bảng nháp',
  sale: 'Đã là Sale / CTV',
  client: 'Là người liên hệ của khách',
};

export interface PhoneOwner {
  kind: PhoneOwnerKind;
  id: string;
  name: string;
  /** Đơn vị (đầu mối / Sale) hoặc công ty khách. */
  org: string;
  /** Chỉ đầu mối: trạng thái hiện tại để báo "đã gọi rồi". */
  lead?: SaleLead;
}

/** Người trong danh bạ (contacts) cần cho việc dò trùng. */
export interface ContactPhoneLite {
  id: string;
  name: string;
  phone: string | null;
  kind: 'client' | 'sale';
  org: string;
}

/** SĐT → ai đang giữ số đó (đầu mối còn sống + mọi người trong danh bạ). */
export function buildPhoneIndex(leads: readonly SaleLead[], contacts: readonly ContactPhoneLite[]): Map<string, PhoneOwner[]> {
  const idx = new Map<string, PhoneOwner[]>();
  const add = (keys: readonly string[], o: PhoneOwner) => {
    for (const k of keys) {
      const list = idx.get(k) ?? [];
      if (!list.some(x => x.kind === o.kind && x.id === o.id)) list.push(o);
      idx.set(k, list);
    }
  };
  for (const l of leads) add(l.phoneKeys.length ? l.phoneKeys : phoneKeysOf(l.phone), { kind: 'lead', id: l.id, name: l.fullName, org: l.company, lead: l });
  for (const c of contacts) add(phoneKeysOf(c.phone), { kind: c.kind, id: c.id, name: c.name, org: c.org });
  return idx;
}

const OWNER_RANK: Readonly<Record<PhoneOwnerKind, number>> = { sale: 0, lead: 1, client: 2 };

/** Những ai đang giữ 1 trong các số này (Sale / CTV trước, rồi bảng nháp, rồi khách). */
export function ownersOf(keys: readonly string[], idx: ReadonlyMap<string, PhoneOwner[]>, exceptLeadId?: string): PhoneOwner[] {
  const out: PhoneOwner[] = [];
  for (const k of keys) {
    for (const o of idx.get(k) ?? []) {
      if (o.kind === 'lead' && o.id === exceptLeadId) continue;
      if (!out.some(x => x.kind === o.kind && x.id === o.id)) out.push(o);
    }
  }
  return out.sort((a, b) => OWNER_RANK[a.kind] - OWNER_RANK[b.kind]);
}

export type DraftCheck =
  | { kind: 'new' }
  | { kind: 'no_phone' }
  | { kind: 'bad_phone' }
  | { kind: 'dup_batch'; line: string }
  | { kind: 'dup_sale' | 'dup_lead' | 'dup_client'; owner: PhoneOwner };

/**
 * Kiểm từng dòng nhập: trùng trong chính bảng dán → trùng Sale / CTV → trùng bảng nháp → trùng
 * người liên hệ của khách → mới. Dòng không có số không dò được (báo riêng).
 */
export function checkDrafts(drafts: readonly LeadDraft[], idx: ReadonlyMap<string, PhoneOwner[]>): DraftCheck[] {
  const seen = new Map<string, string>();
  return drafts.map((d): DraftCheck => {
    if (!d.phoneKeys.length) return d.phone ? { kind: 'bad_phone' } : { kind: 'no_phone' };
    const first = d.phoneKeys.map(k => seen.get(k)).find(Boolean);
    for (const k of d.phoneKeys) if (!seen.has(k)) seen.set(k, d.line);
    if (first) return { kind: 'dup_batch', line: first };
    const owner = ownersOf(d.phoneKeys, idx)[0];
    if (owner) return { kind: owner.kind === 'sale' ? 'dup_sale' : owner.kind === 'lead' ? 'dup_lead' : 'dup_client', owner };
    return { kind: 'new' };
  });
}

/**
 * Bổ sung thông tin còn thiếu của 1 đầu mối đã có từ dòng nhập lại (KHÔNG ghi đè ô đã có chữ):
 * tên / đơn vị / link trống thì điền, KCN + khu vực thêm phần chưa có, ghi chú khác thì nối thêm.
 * Không có gì mới → null.
 */
export function mergeLeadPatch(lead: SaleLead, d: LeadDraft, zoneIds: readonly string[]): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (!lead.fullName && d.fullName) patch.full_name = d.fullName;
  if (!lead.company && d.company) patch.company = d.company;
  if (!lead.channelUrl && d.channelUrl) patch.channel_url = d.channelUrl;
  if (!lead.postUrl && d.postUrl) patch.post_url = d.postUrl;
  const newZones = zoneIds.filter(z => !lead.zoneIds.includes(z));
  if (newZones.length) patch.zone_ids = [...lead.zoneIds, ...newZones];
  const have = new Set(splitAreaText(lead.areaText).map(zoneKey));
  const newParts = splitAreaText(d.areaText).filter(p => !have.has(zoneKey(p)));
  if (newParts.length) patch.area_text = [lead.areaText, newParts.join(', ')].filter(Boolean).join(', ');
  if (d.note && !fold(lead.note).includes(fold(d.note))) patch.note = [lead.note, d.note].filter(Boolean).join('\n');
  return Object.keys(patch).length ? patch : null;
}

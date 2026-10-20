// ============================================================================
// CSKH — "Xếp gợi ý": đoán hạng chăm sóc từ CHỨC VỤ (chốt 19/10/2026)
// ----------------------------------------------------------------------------
//   Người quyết định (vvip)  Giám đốc, chủ tịch, chủ doanh nghiệp
//   Người ảnh hưởng  (vip)   TP/GĐ Nhân sự, trưởng/phó phòng, trợ lý của người quyết định
//   Tác nghiệp       (partner) Nhân sự, tổng vụ, tuyển dụng — và chức vụ chưa rõ
//   Liên hệ CHÍNH của công ty đang ở Tác nghiệp → nâng lên Người ảnh hưởng.
// Chỉ gợi ý cho người: đang phụ trách, còn "Chưa chăm sóc" (không đè hạng đã chọn
// tay), gắn với ít nhất 1 khách ĐANG HỢP TÁC. Giao diện hiện bản xem trước để
// sửa từng dòng trước khi áp dụng.
// ============================================================================
import type { Client } from '../types';
import { normalizeSearch } from './search';
import type { CskhClassifiedTier, CskhContact } from './types';

const LEADER = ['gd', 'giam doc', 'tgd', 'tong giam doc', 'pgd', 'pho giam doc', 'chu tich', 'pho chu tich',
  'ceo', 'coo', 'director', 'owner', 'chu doanh nghiep', 'chu dn', 'nguoi dai dien'];
const MANAGER = ['tp', 'truong phong', 'pp', 'pho phong', 'manager', 'truong bo phan', 'quan ly', 'head'];
const HR = ['nhan su', 'hr', 'tuyen dung', 'hanh chinh', 'nhan luc'];
const ASSISTANT = ['tl', 'tro ly', 'thu ky', 'assistant', 'secretary'];
const OPERATIONS = ['tong vu', 'admin', 'ga'];

/** Có chứa cụm từ (trọn từ) không — "tp" không khớp nhầm trong "tphcm". */
const hasAny = (haystack: string, words: readonly string[]) => words.some(w => haystack.includes(` ${w} `));

export interface TierSuggestion {
  tier: CskhClassifiedTier;
  /** Vì sao — hiện cạnh từng dòng trong màn xem trước. */
  reason: string;
}

/** Đoán hạng từ chức vụ (+ có phải liên hệ chính của công ty nào không). */
export function suggestTierForRole(role: string | null | undefined, isPrimary = false): TierSuggestion {
  const r = ` ${normalizeSearch(role ?? '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  let s: TierSuggestion;
  if (r.trim() === '') s = { tier: 'partner', reason: 'Chưa rõ chức vụ' };
  else if (hasAny(r, ASSISTANT)) s = { tier: 'vip', reason: 'Trợ lý / thư ký của người quyết định' };
  else if (hasAny(r, HR) && (hasAny(r, LEADER) || hasAny(r, MANAGER))) s = { tier: 'vip', reason: 'Quản lý nhân sự' };
  else if (hasAny(r, LEADER)) s = { tier: 'vvip', reason: 'Lãnh đạo doanh nghiệp' };
  else if (hasAny(r, MANAGER)) s = { tier: 'vip', reason: 'Trưởng / phó bộ phận' };
  else if (hasAny(r, HR) || hasAny(r, OPERATIONS)) s = { tier: 'partner', reason: 'Làm việc hằng ngày' };
  else s = { tier: 'partner', reason: 'Chức vụ khác' };

  if (isPrimary && s.tier === 'partner') {
    return { tier: 'vip', reason: `${s.reason} · liên hệ chính của công ty` };
  }
  return s;
}

/** Khách đang hợp tác: đã ký, chưa ngưng, chưa lưu trữ. */
export function isCooperatingClient(c: Pick<Client, 'client_type' | 'cooperation_status' | 'archived_at'>): boolean {
  return c.client_type === 'active' && c.cooperation_status !== 'suspended' && !c.archived_at;
}

export interface SeedPlanRow extends TierSuggestion {
  contactId: string;
}

/** Danh sách gợi ý cho nút "Xếp gợi ý" — không ghi gì, chỉ tính. */
export function buildSeedPlan(
  contacts: readonly Pick<CskhContact, 'id' | 'tier' | 'isArchived' | 'clientIds' | 'primaryClientIds' | 'jobTitle'>[],
  clients: readonly Pick<Client, 'id' | 'client_type' | 'cooperation_status' | 'archived_at'>[],
): SeedPlanRow[] {
  const cooperating = new Set(clients.filter(isCooperatingClient).map(c => c.id));
  const plan: SeedPlanRow[] = [];
  for (const c of contacts) {
    if (c.isArchived || c.tier !== 'unclassified') continue;
    const atCooperating = c.clientIds.filter(id => cooperating.has(id));
    if (!atCooperating.length) continue;
    const isPrimary = c.primaryClientIds.some(id => cooperating.has(id));
    plan.push({ contactId: c.id, ...suggestTierForRole(c.jobTitle, isPrimary) });
  }
  return plan;
}

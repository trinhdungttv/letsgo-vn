// Dò trùng tên công ty khi nhập: tải tên công ty từ 3 nguồn (Khách hàng, CRM Pipeline, Thị trường) 1 lần, giữ trong bộ nhớ,
// rồi so tên đang gõ (xem lib/companyMatch.ts). Dùng chung cho mọi form "thêm công ty".
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { buildCompanyIndex, findSimilarCompanies, worstLevel, type CompanyEntry, type CompanyHit, type MatchLevel } from '../lib/companyMatch';

const PAGE = 1000;
const TTL_MS = 60_000;
let cache: { at: number; index: CompanyEntry[] } | null = null;
let pending: Promise<CompanyEntry[]> | null = null;

/** Đọc hết 1 bảng (Supabase mặc định chỉ trả 1000 dòng / lần). */
async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await supabase.from(table).select(cols).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const STAGE_LABEL: Record<string, string> = {
  'tiem-nang': 'Tiềm năng', 'dang-lh': 'Đang liên hệ', 'quan-tam': 'Quan tâm/Chờ', 'dam-phan': 'Đàm phán HĐ', 'hop-tac': 'Đang hợp tác',
  'khong-nhu-cau': 'Không hợp tác', ngung: 'Ngưng HĐ',
};

async function load(): Promise<CompanyEntry[]> {
  // 1 nguồn lỗi (vd bảng chưa có) không làm mất các nguồn còn lại
  const [clients, pipeline, leads] = await Promise.all([
    fetchAll<{ id: string; name: string; client_type?: string | null }>('clients', 'id,name,client_type').catch(() => []),
    fetchAll<{ id: string; company_name: string; client_id: string | null; stage: string | null }>('crm_pipeline', 'id,company_name,client_id,stage').catch(() => []),
    fetchAll<{ id: string; company_name: string; crm_id: string | null; status: string | null }>('market_leads', 'id,company_name,crm_id,status').catch(() => []),
  ]);
  return buildCompanyIndex({
    clients: clients.map(c => ({ id: c.id, name: c.name })),
    pipeline: pipeline.map(p => ({ id: p.id, company_name: p.company_name, client_id: p.client_id, note: p.stage ? STAGE_LABEL[p.stage] ?? p.stage : undefined })),
    leads: leads.map(l => ({ id: l.id, company_name: l.company_name, crm_id: l.crm_id, note: l.status ?? undefined })),
  });
}

function getIndex(force = false): Promise<CompanyEntry[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.index);
  pending ??= load().then(index => { cache = { at: Date.now(), index }; return index; }).finally(() => { pending = null; });
  return pending;
}

/** Báo chỉ mục đã cũ (vừa thêm / xoá công ty) — lần dò sau sẽ tải lại. */
export const invalidateCompanyIndex = () => { cache = null; };

export interface CompanyDuplicates {
  hits: CompanyHit[];
  /** Mức giống cao nhất; null = không trùng */
  level: MatchLevel | null;
  /** Đang tải danh sách công ty */
  loading: boolean;
  /** Không tải được danh sách → không dò được (không chặn người dùng) */
  failed: boolean;
  /** Người dùng đã xác nhận "đây là công ty khác" */
  ack: boolean;
  setAck: (v: boolean) => void;
  /** Nên chặn lưu: trùng tên hoặc rất giống mà chưa xác nhận */
  blocked: boolean;
}

/**
 * Dò trùng cho ô "Tên công ty". `enabled=false` (form đóng) thì không tải gì. Dò sau khi ngừng gõ ~250ms. Đổi tên → bỏ xác nhận cũ.
 */
export function useCompanyDuplicates(name: string, opts: { enabled?: boolean; ignoreIds?: string[] } = {}): CompanyDuplicates {
  const enabled = opts.enabled ?? true;
  const [index, setIndex] = useState<CompanyEntry[] | null>(cache?.index ?? null);
  const [failed, setFailed] = useState(false);
  const [debounced, setDebounced] = useState(name);
  const [ack, setAckState] = useState(false);
  const ignoreKey = (opts.ignoreIds ?? []).join(',');
  const lastName = useRef(name);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getIndex(true).then(i => { if (alive) { setIndex(i); setFailed(false); } }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [enabled]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(name), 250);
    return () => clearTimeout(t);
  }, [name]);

  useEffect(() => {
    if (lastName.current !== name) { lastName.current = name; setAckState(false); }
  }, [name]);

  const hits = useMemo(
    () => (enabled && index && debounced.trim() ? findSimilarCompanies(debounced, index, { ignoreIds: ignoreKey ? ignoreKey.split(',') : [] }) : []),
    [enabled, index, debounced, ignoreKey],
  );
  const level = worstLevel(hits);
  // Gõ xong rồi mới chặn: tránh nhấp nháy khi đang gõ dở và khi `name` đã đổi mà `debounced` chưa kịp theo
  const settled = debounced === name;
  return {
    hits, level, loading: enabled && index === null && !failed, failed, ack, setAck: setAckState,
    blocked: settled && (level === 'same' || level === 'likely') && !ack,
  };
}

// ============================================================================
// Tab "Đầu mối" (tệp Sale / CTV) — BẢNG NHÁP người mới tìm được, chưa gặp (migration 226).
// ----------------------------------------------------------------------------
//   • Nhập hàng loạt từ Google Sheets / Excel (mẫu "Đầu mối tuyển dụng": STT · Tên · SĐT · Tình trạng ·
//     Khu vực · Link kênh · Link bài đăng · Ghi chú) — giữ link, dò trùng trước khi lưu.
//   • Ô tìm = ô TRA SỐ: dán SĐT là biết ngay số đã gọi chưa / đã là Sale / là người của khách.
//   • Mỗi lần gọi / nhắn ghi lại kết quả (Chưa bắt máy, Đang trao đổi, Hẹn gặp, Từ chối) — không nhắc việc,
//     không chấm điểm, không lên Tổng quan: chưa phải chăm sóc.
//   • Gặp được rồi → "Chuyển sang Sale / CTV": mở form Thêm Sale điền sẵn, lưu xong dòng nháp thành "Đã chuyển".
// ============================================================================
import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRightCircle, FileSpreadsheet, MessageCircle, NotebookPen, Phone, Plus, UserCheck,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { usePersistedState } from '../../hooks/usePersistedState';
import { MIGRATION_178_HINT } from '../../lib/contactOps';
import { zaloUrl } from '../../lib/cskh/contactActions';
import { compareVnName } from '../../lib/vnName';
import { bulkSetLeadStatus, deleteSaleLeads, markLeadPromoted, SALE_LEADS_MIGRATION_HINT } from '../../lib/saleLeads/api';
import { matchCompetitor, ownersOf, type PhoneOwner } from '../../lib/saleLeads/match';
import { fold, formatPhoneKey, phoneKeysOf } from '../../lib/saleLeads/parse';
import {
  SALE_LEAD_STATUS_HINT, SALE_LEAD_STATUS_LABEL, SALE_LEAD_STATUSES, type LeadChannel, type SaleLead, type SaleLeadStatus,
} from '../../lib/saleLeads/types';
import { useCskh } from './context';
import { Spinner } from './components/Card';
import { FilterChip, MoreButton, PageTitle, PillSelect, Quiet, SearchField, Segmented } from './components/apple';
import { PANEL, PILL_PRIMARY, PILL_TINTED, ROUND_ADD, ROUND_ICON } from './ui';
import { LeadFormSheet } from './saleLeads/LeadFormSheet';
import { LeadImportSheet } from './saleLeads/LeadImportSheet';
import { LeadLogSheet } from './saleLeads/LeadLogSheet';
import { LeadLinks, PhoneCheckBox, StatusPill, ZoneChips } from './saleLeads/parts';
import { promotePrefill, vnDate } from './saleLeads/helpers';
import { useSaleLeads } from './saleLeads/useSaleLeads';

type StatusFilter = 'all' | SaleLeadStatus;
type SortKey = 'recent' | 'stale' | 'name' | 'company';
const SORT_LABEL: Readonly<Record<SortKey, string>> = {
  recent: 'Mới nhập trước',
  stale: 'Lâu chưa liên hệ trước',
  name: 'Tên A → Z',
  company: 'Đơn vị A → Z',
};
const PAGE = 80;

interface Derived {
  lead: SaleLead;
  /** Số này đã là Sale / CTV (dù chưa bấm Chuyển). */
  sale: PhoneOwner | undefined;
  /** Số này là người liên hệ của khách. */
  client: PhoneOwner | undefined;
  competitor: string;
  haystack: string;
  digits: string;
}

export default function CskhSaleLeads() {
  const { data, toast, openProfile, openNewContactWith } = useCskh();
  const { user } = useAuth();
  const { leads, ready, loading, phoneIndex, reload } = useSaleLeads(toast);
  const zones = useMemo(() => data?.zones ?? [], [data]);
  const competitors = useMemo(() => data?.competitors ?? [], [data]);
  const saleIds = useMemo(() => new Set((data?.contacts ?? []).map(c => c.id)), [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = usePersistedState<StatusFilter>('sale_leads_status', 'all');
  const [zone, setZone] = usePersistedState<string>('sale_leads_zone', 'all');
  const [company, setCompany] = usePersistedState<string>('sale_leads_company', 'all');
  const [sort, setSort] = usePersistedState<SortKey>('sale_leads_sort', 'recent');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ lead: SaleLead | null; phone?: string } | null>(null);
  const [logging, setLogging] = useState<{ lead: SaleLead; channel: LeadChannel } | null>(null);
  const [importing, setImporting] = useState(false);

  const derived = useMemo(() => leads.map((lead): Derived => {
    const owners = ownersOf(lead.phoneKeys, phoneIndex, lead.id);
    return {
      lead,
      sale: owners.find(o => o.kind === 'sale'),
      client: owners.find(o => o.kind === 'client'),
      competitor: lead.company ? matchCompetitor(lead.company, competitors)?.name ?? '' : '',
      haystack: fold([lead.fullName, lead.company, lead.areaText, lead.note, lead.source, ...zones.filter(z => lead.zoneIds.includes(z.id)).map(z => z.name)].join(' ')),
      digits: [lead.phone.replace(/\D/g, ''), ...lead.phoneKeys].join(' '),
    };
  }), [leads, phoneIndex, competitors, zones]);

  const byId = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads]);
  const companyKey = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');

  // ── Ô tìm = ô tra số ──
  const q = search.trim();
  const qKeys = useMemo(() => phoneKeysOf(q), [q]);
  const qOwners = useMemo(() => ownersOf(qKeys, phoneIndex), [qKeys, phoneIndex]);
  const qDigits = q.replace(/\D/g, '');
  const qText = fold(q);
  const isPhoneQuery = qDigits.length >= 4 && qDigits.length >= q.replace(/[\s.+()-]/g, '').length - 1;

  const filtered = useMemo(() => derived.filter(d => {
    const l = d.lead;
    if (status !== 'all' && l.status !== status) return false;
    if (zone === 'none' ? l.zoneIds.length > 0 : zone !== 'all' && !l.zoneIds.includes(zone)) return false;
    if (company !== 'all' && companyKey(l.company) !== company) return false;
    if (!q) return true;
    if (qKeys.length) return l.phoneKeys.some(k => qKeys.includes(k));
    if (isPhoneQuery) return d.digits.includes(qDigits.replace(/^84/, '').replace(/^0/, ''));
    return qText.split(' ').every(w => d.haystack.includes(w));
  }), [derived, status, zone, company, q, qKeys, isPhoneQuery, qDigits, qText]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'recent') arr.sort((a, b) => b.lead.createdAt.localeCompare(a.lead.createdAt));
    if (sort === 'stale') arr.sort((a, b) => (a.lead.lastContactAt ?? '').localeCompare(b.lead.lastContactAt ?? '') || b.lead.createdAt.localeCompare(a.lead.createdAt));
    if (sort === 'name') arr.sort((a, b) => compareVnName(a.lead.fullName, b.lead.fullName));
    if (sort === 'company') arr.sort((a, b) => (a.lead.company || '￿').localeCompare(b.lead.company || '￿', 'vi') || compareVnName(a.lead.fullName, b.lead.fullName));
    return arr;
  }, [filtered, sort]);
  const visible = sorted.slice(0, limit);

  const counts = useMemo(() => {
    const m: Record<StatusFilter, number> = { all: leads.length, new: 0, no_answer: 0, talking: 0, meeting: 0, declined: 0, promoted: 0 };
    for (const l of leads) m[l.status]++;
    return m;
  }, [leads]);
  const zoneOptions = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of leads) for (const id of l.zoneIds) n.set(id, (n.get(id) ?? 0) + 1);
    return zones.filter(z => n.has(z.id)).map(z => ({ ...z, n: n.get(z.id) ?? 0 }));
  }, [leads, zones]);
  const noZone = leads.filter(l => !l.zoneIds.length).length;
  const companyOptions = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const l of leads) {
      const k = companyKey(l.company);
      if (k) m.set(k, { label: m.get(k)?.label ?? l.company, n: (m.get(k)?.n ?? 0) + 1 });
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'vi'));
  }, [leads]);
  const companyNames = useMemo(() => companyOptions.map(c => c.label), [companyOptions]);

  const needMigration = () => { toast(SALE_LEADS_MIGRATION_HINT); };

  // ── Chuyển sang Sale / CTV ──
  const promote = async (d: Derived) => {
    const l = d.lead;
    if (l.status === 'promoted' && l.promotedContactId) {
      if (saleIds.has(l.promotedContactId)) openProfile(l.promotedContactId);
      else toast('Người này không còn trong danh sách Sale / CTV (đã xoá?) — đổi tình trạng đầu mối nếu muốn chuyển lại');
      return;
    }
    if (d.sale) {
      if (!confirm(`Số này đã là Sale / CTV "${d.sale.name}".\n\nĐánh dấu đầu mối "${l.fullName || l.phone}" là đã chuyển và mở hồ sơ Sale đó?`)) return;
      try {
        await markLeadPromoted(l.id, d.sale.id, user);
        await reload();
        openProfile(d.sale.id);
      } catch (e) { toast('Lỗi: ' + (e as Error).message); }
      return;
    }
    if (!data?.saleReady) { toast(MIGRATION_178_HINT); return; }
    openNewContactWith({
      prefill: promotePrefill(l, zones, competitors),
      onCreated: async contactId => {
        await markLeadPromoted(l.id, contactId, user);
        toast(`Đã chuyển "${l.fullName || l.phone}" sang Sale / CTV`);
      },
    });
  };

  // ── Chọn nhiều ──
  const toggleOne = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visibleSelected = visible.filter(d => selected.has(d.lead.id)).length;
  const toggleVisible = () => setSelected(s => {
    const n = new Set(s);
    if (visibleSelected === visible.length) visible.forEach(d => n.delete(d.lead.id));
    else visible.forEach(d => n.add(d.lead.id));
    return n;
  });
  const selIds = [...selected].filter(id => byId.has(id));

  const bulkStatus = async (s: Exclude<SaleLeadStatus, 'promoted'>) => {
    const ids = selIds.filter(id => byId.get(id)?.status !== 'promoted');
    if (!ids.length) { toast('Các dòng đã chuyển Sale / CTV giữ nguyên tình trạng'); return; }
    setBusy(true);
    try {
      await bulkSetLeadStatus(ids, s, user);
      toast(`Đã đổi ${ids.length} đầu mối sang "${SALE_LEAD_STATUS_LABEL[s]}"`);
      setSelected(new Set());
      await reload();
    } catch (e) { toast('Lỗi: ' + (e as Error).message); } finally { setBusy(false); }
  };

  const bulkDelete = async () => {
    if (!selIds.length) return;
    if (!confirm(`Xoá ${selIds.length} đầu mối khỏi bảng nháp?\n\nXoá rồi thì các số này KHÔNG còn được dò trùng (lần sau nhập lại sẽ coi là số mới). `
      + 'Người đã gọi mà không hợp tác nên đổi tình trạng "Từ chối" thay vì xoá.\n\nKhôi phục được ở trang Lịch sử (Hoàn tác).')) return;
    setBusy(true);
    try {
      await deleteSaleLeads(selIds, user);
      toast(`Đã xoá ${selIds.length} đầu mối`);
      setSelected(new Set());
      await reload();
    } catch (e) { toast('Lỗi: ' + (e as Error).message); } finally { setBusy(false); }
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (zone !== 'all') chips.push({ label: zone === 'none' ? 'Chưa ghép KCN' : `KCN: ${zones.find(z => z.id === zone)?.name ?? '?'}`, clear: () => setZone('all') });
  if (company !== 'all') chips.push({ label: `Đơn vị: ${companyOptions.find(c => c.key === company)?.label ?? '?'}`, clear: () => setCompany('all') });

  if (loading && !leads.length) return <Spinner />;

  /** Nút Gọi / Zalo: mở cuộc gọi / Zalo rồi hiện luôn form ghi kết quả. */
  const dialButtons = (l: SaleLead) => {
    const k = l.phoneKeys[0];
    if (!k) return null;
    return (
      <span className="inline-flex gap-1">
        <a href={`tel:${k}`} onClick={() => setLogging({ lead: l, channel: 'call' })} className={ROUND_ICON} title={`Gọi ${formatPhoneKey(k)}`} aria-label={`Gọi ${l.fullName}`}>
          <Phone size={14} />
        </a>
        <a href={zaloUrl(k)} target="_blank" rel="noreferrer" onClick={() => setLogging({ lead: l, channel: 'zalo' })} className={ROUND_ICON} title="Nhắn Zalo" aria-label={`Nhắn Zalo cho ${l.fullName}`}>
          <MessageCircle size={14} />
        </a>
      </span>
    );
  };

  const promoteButton = (d: Derived, compact = false) => {
    const l = d.lead;
    const done = l.status === 'promoted';
    const label = done ? 'Mở hồ sơ Sale' : d.sale ? 'Đã là Sale — gắn' : 'Chuyển sang Sale / CTV';
    return (
      <button type="button" onClick={() => void promote(d)} title={done ? 'Mở hồ sơ trong danh sách Sale / CTV' : 'Đã gặp được → đưa vào danh sách Sale / CTV để chăm sóc'}
        className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-medium whitespace-nowrap transition active:scale-[0.97] ${done ? 'bg-[#34C759]/[0.14] text-[#248A3D] hover:bg-[#34C759]/[0.22]' : 'bg-[#FF9500]/[0.14] text-[#B25000] hover:bg-[#FF9500]/[0.22]'}`}>
        {done ? <UserCheck size={14} /> : <ArrowRightCircle size={14} />}
        {compact ? (done ? 'Hồ sơ Sale' : d.sale ? 'Gắn Sale' : 'Chuyển Sale') : label}
      </button>
    );
  };

  const lastContact = (l: SaleLead) => (l.contactLog.length
    ? <span className="text-[12px] text-[#86868B] whitespace-nowrap">{l.contactLog.length} lần · {l.lastContactAt ? vnDate(l.lastContactAt) : ''}</span>
    : null);

  const badges = (d: Derived) => (
    <>
      {d.competitor && <span className="px-1.5 rounded-full text-[11px] font-medium bg-[#FF9500]/[0.14] text-[#B25000] whitespace-nowrap" title={`Trùng tên đối thủ: ${d.competitor}`}>đối thủ</span>}
      {d.sale && d.lead.status !== 'promoted' && <span className="px-1.5 rounded-full text-[11px] font-medium bg-[#34C759]/[0.14] text-[#248A3D] whitespace-nowrap" title={`Số này đã là Sale / CTV: ${d.sale.name}`}>đã là Sale</span>}
      {d.client && <span className="px-1.5 rounded-full text-[11px] font-medium bg-[#8944AB]/[0.12] text-[#8944AB] whitespace-nowrap" title={`Người liên hệ của khách: ${d.client.name}${d.client.org ? ` — ${d.client.org}` : ''}`}>người của khách</span>}
    </>
  );

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle
        eyebrow="Sale / CTV · Bảng nháp"
        title="Đầu mối"
        subtitle={<>{leads.length} đầu mối · {counts.new} chưa liên hệ · {counts.promoted} đã chuyển Sale / CTV — chưa chăm sóc, không nhắc việc</>}
        actions={(
          <>
            <button type="button" onClick={ready ? () => setImporting(true) : needMigration} className={PILL_TINTED}>
              <FileSpreadsheet size={15} strokeWidth={2.2} /> <span className="md:hidden">Nhập Sheets</span><span className="hidden md:inline">Nhập từ Sheets / Excel</span>
            </button>
            <button type="button" onClick={ready ? () => setEditing({ lead: null }) : needMigration} className={PILL_PRIMARY}>
              <Plus size={15} strokeWidth={2.4} /> Thêm đầu mối
            </button>
          </>
        )}
      />

      {!ready && (
        <div className="flex items-start gap-3 rounded-[14px] bg-[#FF9500]/[0.12] px-4 py-3 text-[13px] leading-snug text-[#7A3E00]">
          <AlertTriangle size={17} className="shrink-0 mt-px text-[#C93400]" />
          <p>
            Database chưa chạy migration <b>226 (Bảng nháp đầu mối)</b>. Mở Supabase → SQL Editor, chạy file
            {' '}<code className="text-[12px]">20261113120000_226_sale_leads.sql</code> rồi tải lại trang.
          </p>
        </div>
      )}

      {/* ── Tra số + lọc ── */}
      <div className={`${PANEL} p-3 md:p-4 space-y-3`}>
        <SearchField value={search} onChange={v => { setSearch(v); setLimit(PAGE); }}
          placeholder="Dán SĐT để kiểm tra đã gọi chưa · hoặc tìm tên, đơn vị, KCN, ghi chú (gõ không dấu được)" className="w-full" />
        {qKeys.length > 0 && (
          <PhoneCheckBox keys={qKeys} owners={qOwners}
            action={ready && (
              <button type="button" onClick={() => setEditing({ lead: null, phone: q })}
                className="h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-white bg-[#248A3D] hover:brightness-110 transition">Thêm đầu mối với số này</button>
            )} />
        )}
        <Segmented label="Tình trạng" value={status} onChange={v => { setStatus(v); setLimit(PAGE); }} keepLabels
          options={(['all', ...SALE_LEAD_STATUSES] as StatusFilter[]).map(s => ({ key: s, label: s === 'all' ? 'Tất cả' : SALE_LEAD_STATUS_LABEL[s], badge: counts[s] }))} />
        <div className="flex flex-wrap items-center gap-2">
          <PillSelect value={zone} active={zone !== 'all'} label="Lọc theo KCN" onChange={v => { setZone(v); setLimit(PAGE); }}>
            <option value="all">Mọi KCN</option>
            {zoneOptions.map(z => <option key={z.id} value={z.id}>{z.name} ({z.n})</option>)}
            {noZone > 0 && <option value="none">Chưa ghép KCN ({noZone})</option>}
          </PillSelect>
          <PillSelect value={company} active={company !== 'all'} label="Lọc theo đơn vị" onChange={v => { setCompany(v); setLimit(PAGE); }}>
            <option value="all">Mọi đơn vị</option>
            {companyOptions.map(c => <option key={c.key} value={c.key}>{c.label} ({c.n})</option>)}
          </PillSelect>
          <PillSelect value={sort} active={false} label="Sắp xếp" onChange={v => setSort(v as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </PillSelect>
          {chips.map(c => <FilterChip key={c.label} label={c.label} onClear={c.clear} />)}
          <span className="ml-auto text-[12.5px] text-[#86868B] tabular-nums">{filtered.length} / {leads.length}</span>
        </div>
        {status !== 'all' && <p className="text-[12px] text-[#86868B]">{SALE_LEAD_STATUS_HINT[status]}</p>}
      </div>

      {/* ── Thanh chọn nhiều ── */}
      {selIds.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[14px] bg-[#1D1D1F]/90 backdrop-blur-xl px-3 py-2 text-white">
          <span className="text-[13px] font-medium px-1">Đã chọn {selIds.length}</span>
          <select value="" disabled={busy} onChange={e => { if (e.target.value) void bulkStatus(e.target.value as Exclude<SaleLeadStatus, 'promoted'>); }} aria-label="Đổi tình trạng"
            className="h-8 rounded-full bg-white/15 px-3 text-[13px] font-medium outline-none">
            <option value="">Đổi tình trạng…</option>
            {SALE_LEAD_STATUSES.filter(s => s !== 'promoted').map(s => <option key={s} value={s} className="text-black">{SALE_LEAD_STATUS_LABEL[s]}</option>)}
          </select>
          <button type="button" onClick={() => void bulkDelete()} disabled={busy} className="h-8 px-3.5 rounded-full bg-[#FF3B30] text-[13px] font-medium hover:brightness-110 disabled:opacity-40">Xoá</button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto h-8 px-3 rounded-full text-[13px] text-white/80 hover:text-white">Bỏ chọn</button>
        </div>
      )}

      {/* ── Danh sách ── */}
      <div className={`${PANEL} overflow-hidden`}>
        {visible.length === 0 ? (
          <Quiet icon={<NotebookPen size={18} />}>
            {leads.length === 0
              ? <>Chưa có đầu mối nào — bấm <b>Nhập từ Sheets / Excel</b> để dán bảng «Đầu mối tuyển dụng», hoặc <b>Thêm đầu mối</b>.</>
              : qKeys.length ? 'Số này chưa có trong bảng nháp.' : 'Không có đầu mối nào khớp bộ lọc.'}
          </Quiet>
        ) : (
          <>
            {/* Máy tính: bảng giống Google Sheets */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#E5E5EA] text-[12px] text-[#86868B]">
                    <th className="pl-4 pr-2 py-2.5 w-8">
                      <input type="checkbox" className="w-4 h-4 accent-[#0071E3] align-middle" aria-label="Chọn các dòng đang hiện"
                        checked={visibleSelected === visible.length} onChange={toggleVisible} />
                    </th>
                    <th className="text-left font-medium px-2 py-2.5">Đầu mối</th>
                    <th className="text-left font-medium px-2 py-2.5">SĐT</th>
                    <th className="text-left font-medium px-2 py-2.5 hidden lg:table-cell">Khu vực</th>
                    <th className="text-left font-medium px-2 py-2.5">Link</th>
                    <th className="text-left font-medium px-2 py-2.5">Tình trạng</th>
                    <th className="text-left font-medium px-2 py-2.5 hidden xl:table-cell">Ghi chú</th>
                    <th className="pl-2 pr-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(d => {
                    const l = d.lead;
                    return (
                      <tr key={l.id} className={`border-b border-[#F0F0F2] last:border-0 align-top transition-colors ${selected.has(l.id) ? 'bg-[#0071E3]/[0.06]' : 'hover:bg-[#FAFAFC]'} ${l.status === 'declined' ? 'opacity-70' : ''}`}>
                        <td className="pl-4 pr-2 py-3">
                          <input type="checkbox" className="w-4 h-4 accent-[#0071E3]" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} aria-label={`Chọn ${l.fullName}`} />
                        </td>
                        <td className="px-2 py-2.5 min-w-[170px] max-w-[260px]">
                          <button type="button" onClick={() => setEditing({ lead: l })} className="text-left group/name" title="Sửa đầu mối">
                            <b className="block text-[14px] font-semibold text-[#1D1D1F] group-hover/name:text-[#0066CC] transition-colors">{l.fullName || <i className="font-normal text-[#86868B]">chưa ghi tên</i>}</b>
                          </button>
                          <span className="flex flex-wrap items-center gap-1 mt-0.5">
                            {l.company && <span className="text-[12.5px] text-[#6E6E73]">{l.company}</span>}
                            {badges(d)}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums text-[#1D1D1F]">
                              {l.phoneKeys.length ? l.phoneKeys.map(k => <span key={k} className="block">{formatPhoneKey(k)}</span>) : (l.phone || <span className="text-[#C7C7CC]">—</span>)}
                            </span>
                            {dialButtons(l)}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 hidden lg:table-cell max-w-[240px]"><ZoneChips zoneIds={l.zoneIds} areaText={l.areaText} zones={zones} max={4} /></td>
                        <td className="px-2 py-2.5"><LeadLinks lead={l} /></td>
                        <td className="px-2 py-2.5">
                          <StatusPill status={l.status} onClick={() => setLogging({ lead: l, channel: 'call' })} title="Ghi lần liên hệ" />
                          <span className="block mt-0.5">{lastContact(l)}</span>
                        </td>
                        <td className="px-2 py-2.5 hidden xl:table-cell max-w-[240px] text-[12.5px] text-[#6E6E73]">
                          <span className="line-clamp-2 whitespace-pre-line" title={l.note}>{l.note || <span className="text-[#C7C7CC]">—</span>}</span>
                        </td>
                        <td className="pl-2 pr-4 py-2.5">
                          <span className="flex items-center justify-end gap-1.5">
                            <button type="button" onClick={() => setLogging({ lead: l, channel: 'call' })} title="Ghi lần gọi / nhắn" aria-label={`Ghi lần liên hệ với ${l.fullName}`} className={ROUND_ADD}>
                              <Plus size={15} strokeWidth={2.4} />
                            </button>
                            {promoteButton(d, true)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Điện thoại: thẻ từng người */}
            <ul className="md:hidden divide-y divide-[#E5E5EA]">
              {visible.map(d => {
                const l = d.lead;
                return (
                  <li key={l.id} className={`px-3 py-3 ${selected.has(l.id) ? 'bg-[#0071E3]/[0.06]' : ''} ${l.status === 'declined' ? 'opacity-70' : ''}`}>
                    <div className="flex items-start gap-2.5">
                      <input type="checkbox" className="mt-1 w-4 h-4 accent-[#0071E3] shrink-0" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} aria-label={`Chọn ${l.fullName}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" onClick={() => setEditing({ lead: l })} className="text-left min-w-0">
                            <b className="block text-[15px] font-semibold text-[#1D1D1F] truncate">{l.fullName || <i className="font-normal text-[#86868B]">chưa ghi tên</i>}</b>
                          </button>
                          <StatusPill status={l.status} onClick={() => setLogging({ lead: l, channel: 'call' })} title="Ghi lần liên hệ" />
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          {l.company && <span className="text-[13px] text-[#6E6E73]">{l.company}</span>}
                          {badges(d)}
                          {lastContact(l)}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="tabular-nums text-[14px] text-[#1D1D1F]">{l.phoneKeys.length ? l.phoneKeys.map(formatPhoneKey).join(', ') : l.phone}</span>
                          {dialButtons(l)}
                        </div>
                        {(l.zoneIds.length > 0 || l.areaText) && <div className="mt-1.5"><ZoneChips zoneIds={l.zoneIds} areaText={l.areaText} zones={zones} /></div>}
                        {l.note && <p className="mt-1 text-[12.5px] text-[#6E6E73] line-clamp-2 whitespace-pre-line">{l.note}</p>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <LeadLinks lead={l} />
                          <span className="flex-1" />
                          {promoteButton(d)}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {sorted.length > limit && (
          <div className="border-t border-[#E5E5EA] px-3 py-1.5">
            <MoreButton onClick={() => setLimit(limit + PAGE)}>Hiện thêm {Math.min(PAGE, sorted.length - limit)} (còn {sorted.length - limit})</MoreButton>
          </div>
        )}
      </div>

      {editing && (
        <LeadFormSheet
          lead={editing.lead}
          initialPhone={editing.phone}
          zones={zones}
          competitors={competitors}
          companies={companyNames}
          phoneIndex={phoneIndex}
          toast={toast}
          onClose={() => setEditing(null)}
          onSaved={() => { void reload(); }}
          onOpenLead={id => { const l = byId.get(id); if (l) setEditing({ lead: l }); }}
          onOpenSale={id => { setEditing(null); if (saleIds.has(id)) openProfile(id); }}
        />
      )}
      {logging && (
        <LeadLogSheet lead={logging.lead} channel={logging.channel} toast={toast}
          onClose={() => setLogging(null)} onSaved={() => { void reload(); }} />
      )}
      {importing && (
        <LeadImportSheet zones={zones} competitors={competitors} phoneIndex={phoneIndex} toast={toast}
          onClose={() => setImporting(false)} onSaved={() => { void reload(); }} />
      )}
    </div>
  );
}

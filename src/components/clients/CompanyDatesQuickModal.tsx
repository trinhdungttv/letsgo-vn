// ============================================================================
// Nhập nhanh ngày lễ & kỷ niệm của công ty khách hàng (migration 185).
// ----------------------------------------------------------------------------
// Mở từ Khách hàng (nút "Ngày lễ KH"), hồ sơ 1 công ty (tab Hồ sơ chăm sóc) và CSKH →
// Sự kiện & Quà. Hai tab:
//   • Theo công ty — mỗi công ty 1 dòng: quốc gia người đứng đầu · ngày thành lập · các ngày
//     khác (kỷ niệm, ngày lễ riêng của công ty…). Sửa nhiều dòng rồi bấm "Lưu" 1 lần.
//   • Lễ theo quốc gia — danh mục ngày lễ mỗi nước; sửa 1 lần áp cho MỌI công ty của nước đó
//     (lưu ngay từng thao tác).
// Chỉ dòng đã sửa mới nằm trong `drafts`; dòng chưa đụng đọc thẳng dữ liệu đang có.
// ============================================================================
import { useMemo, useState } from 'react';
import { CalendarHeart, Globe2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { Client } from '../../lib/types';
import { useCompanyDates } from '../../hooks/useCompanyDates';
import { archiveNationalHoliday, saveCompanyPlans, saveNationalHoliday } from '../../lib/companyDatesApi';
import {
  COMPANY_OCCASION_LABEL, countryKey, draftFromCompany, formatDayMonthYear, isEmptyCompanyPlan,
  parseDateInput, planCompanySave, type CompanyDraft, type CompanyOccasionKind, type CompanyWritePlan,
  type ExtraDraft, type NationalHoliday,
} from '../../lib/cskh/companyDates';
import { isCooperatingClient } from '../../lib/cskh/seedTiers';

type Tab = 'company' | 'country';

interface Props {
  clients: Client[];
  /** Chỉ sửa các công ty này (mở từ hồ sơ 1 công ty). */
  onlyClientIds?: string[];
  initialTab?: Tab;
  onClose: () => void;
  toast: (msg: string) => void;
}

const EXTRA_KINDS: CompanyOccasionKind[] = ['anniversary', 'holiday', 'other'];
const EXTRA_PLACEHOLDER: Record<CompanyOccasionKind, string> = {
  founding: 'Ngày thành lập',
  anniversary: 'VD: Khánh thành nhà máy 2',
  holiday: 'VD: Ngày hội gia đình, nghỉ hè công ty',
  other: 'Tên ngày',
};
const NEW_COUNTRY = '__new__';

const INPUT = 'text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white';
const BTN_GHOST = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition';

const dmLabel = (d: { day: number; month: number; isLunar: boolean }) =>
  `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}${d.isLunar ? ' âm' : ''}`;

interface ExtraForm {
  clientId: string;
  /** Vị trí trong drafts.extras; null = thêm mới. */
  index: number | null;
  kind: CompanyOccasionKind;
  title: string;
  date: string;
  isLunar: boolean;
  error: string;
}

interface HolidayForm {
  id: string | null;
  title: string;
  localName: string;
  date: string;
  isLunar: boolean;
  tip: string;
  error: string;
}

export default function CompanyDatesQuickModal({ clients, onlyClientIds, initialTab = 'company', onClose, toast }: Props) {
  const { user } = useAuth();
  const { data, loading, error: loadError, refresh } = useCompanyDates();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState('');
  const [showSuspended, setShowSuspended] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CompanyDraft>>({});
  const [extraForm, setExtraForm] = useState<ExtraForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [extraCountries, setExtraCountries] = useState<string[]>([]);
  const [country, setCountry] = useState('');
  const [holidayForm, setHolidayForm] = useState<HolidayForm | null>(null);
  const [busyHoliday, setBusyHoliday] = useState(false);

  const single = !!onlyClientIds;
  const countryOptions = useMemo(() => {
    const seen = new Set(data.countryNames.map(countryKey));
    return [...data.countryNames, ...extraCountries.filter(c => !seen.has(countryKey(c)))];
  }, [data.countryNames, extraCountries]);

  const list = useMemo(() => {
    const only = onlyClientIds ? new Set(onlyClientIds) : null;
    const q = search.trim().toLowerCase();
    return clients
      .filter(c => (only ? only.has(c.id) : (showSuspended ? !c.archived_at : isCooperatingClient(c))))
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [clients, onlyClientIds, search, showSuspended]);

  const currentCountry = (id: string) => data.countryByClient.get(id) ?? null;
  const draftOf = (id: string): CompanyDraft => drafts[id] ?? draftFromCompany(id, currentCountry(id), data.occasions);
  const patch = (id: string, p: Partial<CompanyDraft>) => setDrafts(prev => ({
    ...prev,
    [id]: { ...(prev[id] ?? draftFromCompany(id, currentCountry(id), data.occasions)), ...p },
  }));

  // Kế hoạch ghi của các dòng đã sửa
  const plans = useMemo(() => {
    const out: { clientId: string; clientName: string; plan: CompanyWritePlan }[] = [];
    const errors = new Map<string, string>();
    for (const [id, d] of Object.entries(drafts)) {
      const plan = planCompanySave(d, data.countryByClient.get(id) ?? null, data.occasions);
      if ('error' in plan) errors.set(id, plan.error);
      else if (!isEmptyCompanyPlan(plan)) out.push({ clientId: id, clientName: clients.find(c => c.id === id)?.name ?? id, plan });
    }
    return { out, errors };
  }, [drafts, data, clients]);
  const dirty = plans.out.length > 0 || plans.errors.size > 0;

  const close = () => {
    if (dirty && !confirm('Có thay đổi chưa lưu — đóng và bỏ các thay đổi?')) return;
    onClose();
  };

  const save = async () => {
    if (plans.errors.size > 0) {
      toast('Còn ngày gõ sai — sửa các dòng báo đỏ trước khi lưu');
      return;
    }
    if (plans.out.length === 0) { onClose(); return; }
    setSaving(true);
    setSaveErrors([]);
    try {
      const { saved, errors, failedIds } = await saveCompanyPlans(plans.out, user);
      if (errors.length === 0) {
        toast(`Đã lưu ngày lễ của ${saved} công ty`);
        onClose();
        return;
      }
      // Dòng đã lưu → bỏ khỏi drafts để đọc lại dữ liệu mới (tránh thêm trùng khi lưu lại)
      const failed = new Set(failedIds);
      await refresh();
      setDrafts(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => failed.has(id))));
      setSaveErrors(errors);
      if (saved > 0) toast(`Đã lưu ${saved} công ty, ${errors.length} công ty lỗi`);
    } finally {
      setSaving(false);
    }
  };

  const pickCountry = (id: string, value: string) => {
    if (value !== NEW_COUNTRY) { patch(id, { country: value }); return; }
    const name = (prompt('Tên quốc gia của người đứng đầu (VD: Ấn Độ):') ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const known = countryOptions.find(c => countryKey(c) === countryKey(name));
    if (!known) setExtraCountries(prev => [...prev, name]);
    patch(id, { country: known ?? name });
  };

  const openExtra = (clientId: string, index: number | null) => {
    const e = index !== null ? draftOf(clientId).extras[index] : null;
    setExtraForm({
      clientId, index,
      kind: e?.kind ?? 'anniversary',
      title: e?.title ?? '',
      date: e ? formatDayMonthYear(e) : '',
      isLunar: e?.isLunar ?? false,
      error: '',
    });
  };

  const commitExtra = () => {
    if (!extraForm) return;
    const parsed = parseDateInput(extraForm.date, extraForm.isLunar);
    if (!parsed || parsed === 'invalid') {
      setExtraForm({ ...extraForm, error: parsed === null ? 'Nhập ngày (VD 15/08 hoặc 15/08/2010)' : 'Ngày không hợp lệ' });
      return;
    }
    const d = draftOf(extraForm.clientId);
    const old = extraForm.index !== null ? d.extras[extraForm.index] : undefined;
    const next: ExtraDraft = {
      id: old?.id, kind: extraForm.kind, title: extraForm.title, day: parsed.day, month: parsed.month,
      year: parsed.year, isLunar: extraForm.isLunar, note: old?.note ?? '',
    };
    const extras = [...d.extras];
    if (extraForm.index !== null) extras[extraForm.index] = next; else extras.push(next);
    patch(extraForm.clientId, { extras });
    setExtraForm(null);
  };

  const removeExtra = (clientId: string, index: number) => {
    const d = draftOf(clientId);
    patch(clientId, { extras: d.extras.filter((_, i) => i !== index) });
    if (extraForm?.clientId === clientId) setExtraForm(null);
  };

  // ── Tab Lễ theo quốc gia ──
  const holidaysOf = (name: string) => data.holidays
    .filter(h => countryKey(h.country) === countryKey(name))
    .sort((a, b) => a.month - b.month || a.day - b.day);
  const companyCount = (name: string) => clients.filter(c => isCooperatingClient(c) && countryKey(currentCountry(c.id)) === countryKey(name)).length;
  // Mặc định mở nước đang có nhiều công ty nhất
  const selectedCountry = country || [...countryOptions].sort((a, b) => companyCount(b) - companyCount(a))[0] || '';

  const editHoliday = (h: NationalHoliday | null) => setHolidayForm({
    id: h?.id ?? null, title: h?.title ?? '', localName: h?.localName ?? '',
    date: h ? `${String(h.day).padStart(2, '0')}/${String(h.month).padStart(2, '0')}` : '',
    isLunar: h?.isLunar ?? false, tip: h?.tip ?? '', error: '',
  });

  const commitHoliday = async () => {
    if (!holidayForm || !selectedCountry) return;
    const parsed = parseDateInput(holidayForm.date, holidayForm.isLunar);
    if (!holidayForm.title.trim()) { setHolidayForm({ ...holidayForm, error: 'Nhập tên ngày lễ' }); return; }
    if (!parsed || parsed === 'invalid' || parsed.year !== null) {
      setHolidayForm({ ...holidayForm, error: 'Ngày lễ lặp hằng năm — gõ ngày/tháng, VD 15/08' });
      return;
    }
    setBusyHoliday(true);
    try {
      await saveNationalHoliday({
        country: selectedCountry, title: holidayForm.title, localName: holidayForm.localName,
        day: parsed.day, month: parsed.month, isLunar: holidayForm.isLunar, tip: holidayForm.tip,
      }, holidayForm.id);
      setHolidayForm(null);
      toast(holidayForm.id ? 'Đã sửa ngày lễ' : 'Đã thêm ngày lễ');
    } catch (e) {
      setHolidayForm({ ...holidayForm, error: (e as Error).message });
    } finally {
      setBusyHoliday(false);
    }
  };

  const removeHoliday = async (h: NationalHoliday) => {
    if (!confirm(`Xoá ngày lễ "${h.title}" của ${h.country}? Mọi công ty có người đứng đầu nước này sẽ không được nhắc ngày này nữa.\n\nKhôi phục được ở trang Lịch sử.`)) return;
    setBusyHoliday(true);
    try {
      await archiveNationalHoliday(h.id);
      toast('Đã xoá ngày lễ');
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyHoliday(false);
    }
  };

  const addCountry = () => {
    const name = (prompt('Tên quốc gia mới (VD: Ấn Độ):') ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const known = countryOptions.find(c => countryKey(c) === countryKey(name));
    if (!known) setExtraCountries(prev => [...prev, name]);
    setCountry(known ?? name);
    setHolidayForm(null);
  };

  const title = single && list.length === 1 ? `Ngày lễ & kỷ niệm — ${list[0].name}` : 'Nhập nhanh ngày lễ & kỷ niệm khách hàng';
  const savedCount = list.filter(c => {
    const d = draftOf(c.id);
    return d.country || d.founding || d.extras.length > 0;
  }).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 md:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-t-2xl md:rounded-xl shadow-xl w-full md:max-w-5xl max-h-[92vh] md:max-h-[88vh] flex flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-start justify-between gap-3 px-4 md:px-5 py-3.5 border-b border-gray-200">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 truncate">{title}</h2>
            <p className="text-[11.5px] text-gray-500 mt-0.5">
              Hiện ở CSKH → Sự kiện &amp; Quà · Dashboard “Sắp tới”, popup nhắc trước 2 ngày + đúng ngày để chúc khách.
            </p>
          </div>
          <button onClick={close} aria-label="Đóng" className="p-1 hover:bg-gray-100 rounded-md shrink-0"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="flex gap-1 px-4 md:px-5 border-b border-gray-200">
          {([['company', 'Theo công ty'], ['country', 'Lễ theo quốc gia']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-2 text-[12.5px] font-medium border-b-2 -mb-px transition ${tab === k ? 'border-[#1D4ED8] text-[#1D4ED8]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {loadError && <p className="mx-4 md:mx-5 mt-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Lỗi tải dữ liệu: {loadError}</p>}
        {!loading && !loadError && !data.ready && (
          <p className="mx-4 md:mx-5 mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Chưa chạy migration 185 (company_occasions) trên Supabase — chưa lưu được ngày lễ công ty. Chạy file SQL trong SQL Editor rồi mở lại.
          </p>
        )}

        {tab === 'company' ? (
          <>
            {!single && (
              <div className="flex flex-wrap items-center gap-2 px-4 md:px-5 py-2.5 border-b border-gray-100">
                <label className="relative flex-1 min-w-[180px]">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm công ty…" className={`${INPUT} w-full pl-7`} />
                </label>
                <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-600">
                  <input type="checkbox" checked={showSuspended} onChange={e => setShowSuspended(e.target.checked)} /> Cả KH ngưng hợp tác
                </label>
                <span className="text-[11.5px] text-gray-500">{savedCount}/{list.length} công ty đã có thông tin</span>
              </div>
            )}

            <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_160px_130px_minmax(0,2fr)] gap-3 px-5 py-1.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <span>Công ty</span><span>Quốc gia người đứng đầu</span><span>Ngày thành lập</span><span>Kỷ niệm · ngày lễ riêng</span>
            </div>

            <div className="flex-1 overflow-y-auto px-4 md:px-5 divide-y divide-gray-100">
              {loading && !data.ready && <div className="text-center py-8 text-[12px] text-gray-400">Đang tải…</div>}
              {list.map(c => {
                const d = draftOf(c.id);
                const err = plans.errors.get(c.id);
                const changed = plans.out.some(p => p.clientId === c.id);
                const nat = d.country ? holidaysOf(d.country) : [];
                const formHere = extraForm?.clientId === c.id ? extraForm : null;
                return (
                  <div key={c.id} className={`py-2.5 ${changed ? 'bg-blue-50/40 -mx-4 md:-mx-5 px-4 md:px-5' : ''}`}>
                    <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1.2fr)_160px_130px_minmax(0,2fr)] gap-2 md:gap-3 items-center">
                      <div className="col-span-2 md:col-span-1 min-w-0 text-[12.5px] font-semibold text-gray-900 truncate">
                        {c.name}
                        {c.cooperation_status === 'suspended' && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">Ngưng HT</span>}
                      </div>
                      <select value={d.country} disabled={!data.ready} onChange={e => pickCountry(c.id, e.target.value)}
                        aria-label={`Quốc gia người đứng đầu ${c.name}`} className={`${INPUT} w-full ${d.country ? 'border-blue-300' : ''}`}>
                        <option value="">— Quốc gia —</option>
                        {countryOptions.map(n => <option key={n} value={n}>{n}</option>)}
                        <option value={NEW_COUNTRY}>＋ Nước khác…</option>
                      </select>
                      <input value={d.founding} disabled={!data.ready} onChange={e => patch(c.id, { founding: e.target.value })}
                        placeholder="Thành lập dd/mm/yyyy" aria-label={`Ngày thành lập ${c.name}`}
                        className={`${INPUT} w-full ${err ? 'border-red-400 bg-red-50' : d.founding ? 'border-blue-300' : ''}`} />
                      <div className="col-span-2 md:col-span-1 flex flex-wrap items-center gap-1.5">
                        {d.extras.map((e, i) => (
                          <span key={e.id ?? `new-${i}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-violet-50 text-violet-800 border border-violet-200 text-[11.5px]">
                            <button type="button" onClick={() => openExtra(c.id, i)} title="Sửa" className="hover:underline">
                              {e.title || COMPANY_OCCASION_LABEL[e.kind]} · {dmLabel(e)}
                            </button>
                            <button type="button" onClick={() => removeExtra(c.id, i)} aria-label={`Bỏ ${e.title}`} className="p-0.5 rounded-full hover:bg-violet-100"><X size={11} /></button>
                          </span>
                        ))}
                        <button type="button" disabled={!data.ready} onClick={() => openExtra(c.id, null)}
                          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full border border-dashed border-gray-300 text-[11.5px] text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          <Plus size={11} /> Thêm ngày
                        </button>
                      </div>
                    </div>
                    {nat.length > 0 && (
                      <p className="mt-1 text-[11px] text-gray-500 flex items-start gap-1">
                        <Globe2 size={11} className="mt-0.5 shrink-0" />
                        <span>Lễ {d.country} tự nhắc: {nat.map(h => `${h.title} (${dmLabel(h)})`).join(' · ')}</span>
                      </p>
                    )}
                    {d.country && nat.length === 0 && data.ready && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Chưa có ngày lễ của {d.country} —{' '}
                        <button type="button" onClick={() => { setCountry(d.country); setTab('country'); }} className="underline">thêm ở tab Lễ theo quốc gia</button>
                      </p>
                    )}
                    {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
                    {formHere && (
                      <div className="mt-2 p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex flex-wrap items-center gap-2">
                        <select value={formHere.kind} onChange={e => setExtraForm({ ...formHere, kind: e.target.value as CompanyOccasionKind })} aria-label="Loại ngày" className={INPUT}>
                          {EXTRA_KINDS.map(k => <option key={k} value={k}>{COMPANY_OCCASION_LABEL[k]}</option>)}
                        </select>
                        <input value={formHere.title} onChange={e => setExtraForm({ ...formHere, title: e.target.value })} placeholder={EXTRA_PLACEHOLDER[formHere.kind]}
                          aria-label="Tên ngày" className={`${INPUT} flex-1 min-w-[160px]`} autoFocus />
                        <input value={formHere.date} onChange={e => setExtraForm({ ...formHere, date: e.target.value, error: '' })}
                          onKeyDown={e => { if (e.key === 'Enter') commitExtra(); }}
                          placeholder="dd/mm hoặc dd/mm/yyyy" aria-label="Ngày" className={`${INPUT} w-[150px]`} />
                        <label className="inline-flex items-center gap-1 text-[12px] text-gray-600">
                          <input type="checkbox" checked={formHere.isLunar} onChange={e => setExtraForm({ ...formHere, isLunar: e.target.checked, error: '' })} /> Âm lịch
                        </label>
                        <button type="button" onClick={commitExtra} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700">
                          {formHere.index === null ? 'Thêm' : 'Xong'}
                        </button>
                        <button type="button" onClick={() => setExtraForm(null)} className="px-2 py-1.5 rounded-lg text-[12px] text-gray-600 hover:bg-gray-100">Huỷ</button>
                        {formHere.error && <span className="w-full text-[11px] text-red-600">{formHere.error}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              {!loading && list.length === 0 && <div className="text-center py-8 text-[12px] text-gray-400">Không tìm thấy công ty</div>}
            </div>

            {saveErrors.length > 0 && (
              <div className="mx-4 md:mx-5 mb-2 text-[11.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-h-24 overflow-y-auto">
                {saveErrors.map(e => <div key={e}>{e}</div>)}
              </div>
            )}
            <div className="px-4 md:px-5 py-3 border-t border-gray-200 flex items-center gap-2">
              <span className="flex-1 text-[11.5px] text-gray-500">
                {plans.out.length > 0 ? `${plans.out.length} công ty có thay đổi` : 'Chưa có thay đổi'}
                {plans.errors.size > 0 && <span className="text-red-600"> · {plans.errors.size} dòng gõ sai ngày</span>}
              </span>
              <button onClick={close} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Huỷ</button>
              <button onClick={save} disabled={saving || !data.ready || plans.out.length === 0 || plans.errors.size > 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition">
                {saving ? 'Đang lưu…' : plans.out.length > 0 ? `Lưu ${plans.out.length} công ty` : 'Lưu'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col md:flex-row min-h-0">
            <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-gray-100 p-3 flex md:flex-col gap-1.5 overflow-x-auto md:overflow-y-auto">
              {countryOptions.map(n => {
                const active = countryKey(n) === countryKey(selectedCountry);
                const cnt = companyCount(n);
                return (
                  <button key={n} type="button" onClick={() => { setCountry(n); setHolidayForm(null); }}
                    className={`shrink-0 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-[12.5px] transition ${active ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                    <span className="truncate">{n}</span>
                    <span className="text-[11px] text-gray-500 tabular-nums" title={`${holidaysOf(n).length} ngày lễ · ${cnt} công ty`}>{holidaysOf(n).length} · {cnt} KH</span>
                  </button>
                );
              })}
              <button type="button" onClick={addCountry} disabled={!data.ready} className={`${BTN_GHOST} shrink-0 justify-center disabled:opacity-50`}><Plus size={12} /> Quốc gia</button>
            </div>

            <div className="flex-1 min-w-0 p-3 md:p-5">
              {!selectedCountry ? <p className="text-[12px] text-gray-400">Chưa có quốc gia nào.</p> : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <h3 className="text-[14px] font-semibold text-gray-900">Ngày lễ {selectedCountry}</h3>
                      <p className="text-[11.5px] text-gray-500">Áp cho {companyCount(selectedCountry)} công ty đang hợp tác có người đứng đầu {selectedCountry}. Sửa ở đây là đổi cho tất cả.</p>
                    </div>
                    <button type="button" disabled={!data.ready || busyHoliday} onClick={() => editHoliday(null)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-50">
                      <Plus size={13} /> Thêm ngày lễ
                    </button>
                  </div>

                  {holidayForm && (
                    <div className="mb-3 p-3 rounded-lg bg-gray-50 border border-gray-200 grid grid-cols-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_auto] gap-2 items-center">
                      <input value={holidayForm.title} onChange={e => setHolidayForm({ ...holidayForm, title: e.target.value, error: '' })}
                        placeholder="Tên ngày lễ (tiếng Việt)" aria-label="Tên ngày lễ" className={`${INPUT} col-span-2 md:col-span-1`} autoFocus />
                      <input value={holidayForm.localName} onChange={e => setHolidayForm({ ...holidayForm, localName: e.target.value })}
                        placeholder="Tên bản địa (tuỳ chọn)" aria-label="Tên bản địa" className={INPUT} />
                      <input value={holidayForm.date} onChange={e => setHolidayForm({ ...holidayForm, date: e.target.value, error: '' })}
                        placeholder="dd/mm" aria-label="Ngày" className={INPUT} />
                      <label className="inline-flex items-center gap-1 text-[12px] text-gray-600">
                        <input type="checkbox" checked={holidayForm.isLunar} onChange={e => setHolidayForm({ ...holidayForm, isLunar: e.target.checked, error: '' })} /> Âm lịch
                      </label>
                      <input value={holidayForm.tip} onChange={e => setHolidayForm({ ...holidayForm, tip: e.target.value })}
                        placeholder="Gợi ý chăm sóc: nghỉ mấy ngày, nên tặng gì…" aria-label="Gợi ý chăm sóc" className={`${INPUT} col-span-2 md:col-span-3`} />
                      <div className="col-span-2 md:col-span-1 flex gap-1.5 justify-end">
                        <button type="button" onClick={() => setHolidayForm(null)} className="px-2.5 py-1.5 rounded-lg text-[12px] text-gray-600 hover:bg-gray-100">Huỷ</button>
                        <button type="button" disabled={busyHoliday} onClick={() => void commitHoliday()} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                          {holidayForm.id ? 'Lưu' : 'Thêm'}
                        </button>
                      </div>
                      {holidayForm.error && <span className="col-span-full text-[11px] text-red-600">{holidayForm.error}</span>}
                    </div>
                  )}

                  {holidaysOf(selectedCountry).length === 0 ? (
                    <p className="py-6 text-center text-[12px] text-gray-400">Chưa có ngày lễ nào — bấm “Thêm ngày lễ”.</p>
                  ) : (
                    <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                      {holidaysOf(selectedCountry).map(h => (
                        <div key={h.id} className="flex items-start gap-3 px-3 py-2.5">
                          <span className="w-14 shrink-0 text-center rounded-md border border-gray-200 py-1 leading-none">
                            <b className="block text-[13px] text-gray-900 tabular-nums">{String(h.day).padStart(2, '0')}/{String(h.month).padStart(2, '0')}</b>
                            <small className={`block mt-0.5 text-[10px] ${h.isLunar ? 'text-amber-700' : 'text-gray-400'}`}>{h.isLunar ? 'âm lịch' : 'dương'}</small>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-gray-900">
                              {h.title}{h.localName && <span className="font-normal text-gray-500"> · {h.localName}</span>}
                            </p>
                            {h.tip && <p className="text-[11.5px] text-gray-500 mt-0.5">{h.tip}</p>}
                          </div>
                          <button type="button" onClick={() => editHoliday(h)} disabled={busyHoliday} aria-label={`Sửa ${h.title}`} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"><Pencil size={13} /></button>
                          <button type="button" onClick={() => void removeHoliday(h)} disabled={busyHoliday} aria-label={`Xoá ${h.title}`} className="p-1.5 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-[11px] text-gray-400 flex items-start gap-1">
                    <CalendarHeart size={11} className="mt-0.5 shrink-0" />
                    Âm lịch tính theo lịch Việt Nam — trùng lịch Trung/Hàn gần như mọi năm. Lễ đổi ngày theo thứ (VD Lễ Tạ ơn Mỹ) chưa hỗ trợ.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

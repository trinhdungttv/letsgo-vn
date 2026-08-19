import { Fragment, useEffect, useMemo, useState } from 'react';
import { Eye, Plus, X, Check, Search, Trash2, Building2, ExternalLink, ChevronDown, ChevronRight, Info, Pencil, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Competitor, CompetitorClient, MarketZone, Client, MarketLead } from '../../lib/types';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { formatCurrency } from '../../lib/format';
import { fmtTr, sameZone, isNationwide } from './shared';
import { matchesSearch } from '../../hooks/useSlashSearch';
import SearchSelect from './SearchSelect';
import {
  type CompetitorClientInput, insertCompetitorClient, updateCompetitorClient,
  missingCompetitorClientColumns, workersTooltip, workersDateInput, dateInputToIso,
} from './competitorClients';

/**
 * "Đối thủ đang hoạt động tại KCN" — bảng nằm trong hồ sơ 1 KCN.
 *
 * NGUỒN DỮ LIỆU (không tạo bảng mới, không nhân đôi nguồn sự thật):
 *  1. GHI NHẬN TAY  → competitors.active_zones (mảng tên KCN). Đây chính là ô "Khu vực hoạt
 *     động" trong hồ sơ đối thủ, nên ghi nhận ở đây hiện ngay bên tab Đối thủ và ngược lại.
 *  2. TRỤ SỞ/KV CHÍNH → competitors.zone_name khớp tên KCN này.
 *  3. ĐANG CUNG ỨNG → competitor_clients.kcn khớp tên KCN này (danh sách "KH đang phục vụ"
 *     của đối thủ). Đây là bằng chứng mạnh nhất vì có tên nhà máy + số LĐ.
 *
 * Dòng nào có (2) hoặc (3) mà chưa có (1) sẽ hiện nhãn "Chưa ghi nhận" + nút ghi nhận 1 chạm,
 * để dữ liệu rải rác các nơi được gom về đúng KCN thay vì phải nhớ nhập lại bằng tay.
 */
interface Props {
  zone: MarketZone;
  competitors: Competitor[];
  clients: Client[];
  marketLeads: MarketLead[];
  onRefresh: () => Promise<void>;
  toast: (msg: string) => void;
  onOpenCompetitor: (c: Competitor) => void;
}

interface Presence {
  c: Competitor;
  recorded: boolean;      // đã có tên KCN này trong active_zones
  isHq: boolean;          // KCN này là "Trụ sở / Khu vực chính" của họ
  factories: CompetitorClient[];
  workers: number;        // tổng LĐ tại KCN này (cộng từ các nhà máy đã biết)
}

const pill = 'px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap';
const inputCls = 'text-[12px] px-2 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500';

const emptyFactoryForm = { client_name: '', worker_count: '', sale_name: '', sale_phone: '', sale_fee: '', workers_date: '' };
type FactoryForm = typeof emptyFactoryForm;

const formToInput = (f: FactoryForm, kcn: string): CompetitorClientInput => ({
  client_name: f.client_name.trim(),
  kcn,
  worker_count: parseInt(f.worker_count, 10) || 0,
  sale_name: f.sale_name.trim() || null,
  sale_phone: f.sale_phone.trim() || null,
  sale_fee: f.sale_fee ? parseFloat(f.sale_fee) : null,
  workers_updated_at: dateInputToIso(f.workers_date),
});

export default function ZoneCompetitors({ zone, competitors, clients, marketLeads, onRefresh, toast, onOpenCompetitor }: Props) {
  const { user } = useAuth();
  const [ccRows, setCcRows] = useState<CompetitorClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [savingPick, setSavingPick] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showBroad, setShowBroad] = useState(false);
  const [factoryFor, setFactoryFor] = useState<string | null>(null);
  const [factoryForm, setFactoryForm] = useState(emptyFactoryForm);
  // Dòng nhà máy đang sửa tại chỗ (id của competitor_clients).
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyFactoryForm);
  const [missingCols, setMissingCols] = useState<string[]>([]);

  useEffect(() => { missingCompetitorClientColumns().then(setMissingCols); }, []);

  // Toàn bộ "KH đang phục vụ" của mọi đối thủ — dữ liệu nhỏ (mỗi đối thủ vài chục dòng) nên
  // tải 1 lần rồi lọc trong JS bằng sameZone(), thay vì .eq('kcn', name) sẽ bỏ sót các bản
  // ghi gõ tay lệch tiền tố ("Biên Hoà 2" vs "KCN Biên Hoà 2").
  // Dùng select('*') chứ KHÔNG liệt kê tên cột: các cột thêm sau (sale_phone — migration 104…)
  // có thể chưa được chạy trên database thật, mà PostgREST hỏi 1 cột không tồn tại là hỏng
  // CẢ câu truy vấn (lỗi 42703) → bảng trống trơn dù dữ liệu vẫn nằm nguyên trong DB.
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('competitor_clients').select('*');
    if (error) toast('Lỗi tải danh sách nhà máy đối thủ: ' + error.message);
    setCcRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [zone.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const compById = useMemo(() => new Map(competitors.map(c => [c.id, c])), [competitors]);

  // Gom mọi tín hiệu hiện diện của từng đối thủ tại KCN này.
  const presences = useMemo(() => {
    const factoriesByComp = new Map<string, CompetitorClient[]>();
    for (const r of ccRows) {
      if (!sameZone(r.kcn, zone.name)) continue;
      if (!compById.has(r.competitor_id)) continue; // đối thủ đã bị xoá → bỏ qua
      const arr = factoriesByComp.get(r.competitor_id) ?? [];
      arr.push(r);
      factoriesByComp.set(r.competitor_id, arr);
    }
    const out: Presence[] = [];
    for (const c of competitors) {
      const recorded = (c.active_zones ?? []).some(z => sameZone(z, zone.name));
      const isHq = sameZone(c.zone_name, zone.name);
      const factories = factoriesByComp.get(c.id) ?? [];
      if (!recorded && !isHq && !factories.length) continue;
      out.push({
        c, recorded, isHq, factories,
        workers: factories.reduce((s, f) => s + (f.worker_count ?? 0), 0),
      });
    }
    return out.sort((a, b) =>
      Number(b.recorded) - Number(a.recorded)
      || b.workers - a.workers
      || a.c.company_name.localeCompare(b.c.company_name, 'vi'),
    );
  }, [competitors, ccRows, zone.name, compById]);

  const unrecordedCount = presences.filter(p => !p.recorded).length;
  const knownWorkers = presences.reduce((s, p) => s + p.workers, 0);
  const ourWorkers = zone.lgv_workers ?? 0;
  const totalWorkers = zone.total_workers ?? 0;
  const unknownWorkers = Math.max(0, totalWorkers - ourWorkers - knownWorkers);

  const presentIds = useMemo(() => new Set(presences.map(p => p.c.id)), [presences]);

  // Đối thủ khai "Toàn quốc" hoặc đúng tỉnh của KCN này — RẤT có thể đang hoạt động ở đây
  // nhưng chưa đủ bằng chứng để tự đưa vào bảng chính, nên để riêng ở mục gợi ý thu gọn.
  const broadSuggestions = useMemo(() => competitors.filter(c => {
    if (presentIds.has(c.id)) return false;
    const zones = [c.zone_name, ...(c.active_zones ?? [])];
    return zones.some(z => isNationwide(z) || (!!zone.location && sameZone(z, zone.location)));
  }), [competitors, presentIds, zone.location]);

  // Gợi ý trong bảng chọn: đối thủ có tín hiệu ở KCN/tỉnh này lên đầu, còn lại xếp theo tên.
  const pickerList = useMemo(() => {
    const rank = (c: Competitor) => {
      const zones = [c.zone_name, ...(c.active_zones ?? [])];
      if (zones.some(z => sameZone(z, zone.location))) return 0;
      if (zones.some(z => isNationwide(z))) return 1;
      return 2;
    };
    return competitors
      .filter(c => !(c.active_zones ?? []).some(z => sameZone(z, zone.name)))
      .filter(c => matchesSearch(pickerSearch, c.company_name, c.zone_name, (c.active_zones ?? []).join(' ')))
      .sort((a, b) => rank(a) - rank(b) || a.company_name.localeCompare(b.company_name, 'vi'));
  }, [competitors, pickerSearch, zone.name, zone.location]);

  // Ghi nhận = thêm tên KCN vào active_zones của hồ sơ đối thủ (giữ nguyên tên chính thức
  // trong market_zones.name để mọi nơi khác so khớp được).
  const recordZone = async (list: Competitor[], silent = false) => {
    const targets = list.filter(c => !(c.active_zones ?? []).some(z => sameZone(z, zone.name)));
    if (!targets.length) return;
    for (const c of targets) {
      const next = [...(c.active_zones ?? []), zone.name];
      const { error } = await supabase.from('competitors').update({ active_zones: next }).eq('id', c.id);
      if (error) { toast(`Lỗi ghi nhận "${c.company_name}": ${error.message}`); return; }
      await logActivity({
        user, action: 'update', table: 'competitors', recordId: c.id,
        description: `Ghi nhận đối thủ "${c.company_name}" đang hoạt động tại "${zone.name}"`,
        oldData: { active_zones: c.active_zones ?? [] }, newData: { active_zones: next },
      });
    }
    await onRefresh();
    if (silent) return;
    toast(targets.length === 1
      ? `Đã ghi nhận "${targets[0].company_name}" tại ${zone.name}`
      : `Đã ghi nhận ${targets.length} đối thủ tại ${zone.name}`);
  };

  const handleRecordOne = async (c: Competitor) => {
    setBusyId(c.id);
    await recordZone([c]);
    setBusyId(null);
  };

  const handleSavePicked = async () => {
    const list = competitors.filter(c => picked.has(c.id));
    if (!list.length) { toast('Chưa chọn đối thủ nào'); return; }
    setSavingPick(true);
    await recordZone(list);
    setSavingPick(false);
    setPicked(new Set());
    setShowPicker(false);
  };

  // Gỡ ghi nhận — chỉ xoá tên KCN khỏi active_zones, KHÔNG đụng tới hồ sơ đối thủ hay danh
  // sách nhà máy họ đang phục vụ. Nói rõ điều đó để không ai tưởng bấm nhầm là mất dữ liệu.
  const handleUnrecord = async (p: Presence) => {
    const evidence: string[] = [];
    if (p.isHq) evidence.push(`KCN này đang là "Trụ sở / Khu vực chính" trong hồ sơ của họ`);
    if (p.factories.length) evidence.push(`họ vẫn đang phục vụ ${p.factories.length} nhà máy trong KCN này`);
    const note = evidence.length
      ? `\n\nLưu ý: ${evidence.join(' và ')} — nên sau khi gỡ, "${p.c.company_name}" vẫn hiện trong bảng này với nhãn "Chưa ghi nhận".`
      : '';
    if (!confirm(
      `Gỡ "${p.c.company_name}" khỏi danh sách đối thủ hoạt động tại "${zone.name}"?\n\n`
      + `Chỉ xoá tên KCN này khỏi ô "Khu vực hoạt động" trong hồ sơ của họ. Hồ sơ đối thủ, `
      + `danh sách nhà máy đang phục vụ và lịch sử ghi nhận KHÔNG bị xoá.${note}`,
    )) return;
    setBusyId(p.c.id);
    const next = (p.c.active_zones ?? []).filter(z => !sameZone(z, zone.name));
    const { error } = await supabase.from('competitors').update({ active_zones: next }).eq('id', p.c.id);
    if (error) { toast('Lỗi: ' + error.message); setBusyId(null); return; }
    await logActivity({
      user, action: 'update', table: 'competitors', recordId: p.c.id,
      description: `Gỡ đối thủ "${p.c.company_name}" khỏi khu vực "${zone.name}"`,
      oldData: { active_zones: p.c.active_zones ?? [] }, newData: { active_zones: next },
    });
    await onRefresh();
    setBusyId(null);
    toast(`Đã gỡ "${p.c.company_name}" khỏi ${zone.name}`);
  };

  // Tên nhà máy gợi ý: ưu tiên công ty đã gắn đúng KCN này (Khách hàng + Công ty/Dự án),
  // sau đó tới phần còn lại. Vẫn cho gõ tự do vì nhiều nhà máy chưa có hồ sơ trong hệ thống.
  const factoryOptions = useMemo(() => {
    const inZone: string[] = [];
    const others: string[] = [];
    for (const c of clients) {
      ((c.industrial_zones ?? []).some(z => sameZone(z, zone.name)) ? inZone : others).push(c.name);
    }
    for (const l of marketLeads) {
      (sameZone(l.region, zone.name) ? inZone : others).push(l.company_name);
    }
    const ordered = [...inZone.sort((a, b) => a.localeCompare(b, 'vi')), ...others.sort((a, b) => a.localeCompare(b, 'vi'))];
    return [...new Set(ordered.filter(Boolean))].map(n => ({ value: n, label: n }));
  }, [clients, marketLeads, zone.name]);

  const handleAddFactory = async (c: Competitor) => {
    const name = factoryForm.client_name.trim();
    if (!name) { toast('Chọn hoặc nhập tên nhà máy'); return; }
    setBusyId(c.id);
    const { data, error } = await insertCompetitorClient(c.id, formToInput(factoryForm, zone.name));
    if (error) { toast('Lỗi: ' + error.message); setBusyId(null); return; }
    await logActivity({
      user, action: 'insert', table: 'competitor_clients', recordId: data.id,
      description: `Ghi nhận đối thủ "${c.company_name}" đang cung ứng cho "${name}" tại ${zone.name}`,
      newData: data,
    });
    // Nhà máy đã biết đích danh → đối thủ chắc chắn hoạt động ở đây, ghi nhận luôn cho khỏi sót.
    if (!(c.active_zones ?? []).some(z => sameZone(z, zone.name))) await recordZone([c], true);
    setFactoryForm(emptyFactoryForm);
    setFactoryFor(null);
    await load();
    setBusyId(null);
    toast(`Đã thêm nhà máy "${name}" cho ${c.company_name}`);
  };

  const startEditFactory = (row: CompetitorClient) => {
    setFactoryFor(null);
    setEditingRow(row.id);
    setEditForm({
      client_name: row.client_name,
      worker_count: String(row.worker_count ?? ''),
      sale_name: row.sale_name ?? '',
      sale_phone: row.sale_phone ?? '',
      sale_fee: row.sale_fee != null ? String(row.sale_fee) : '',
      workers_date: workersDateInput(row),
    });
  };

  const handleSaveFactory = async (row: CompetitorClient, c: Competitor) => {
    if (!editForm.client_name.trim()) { toast('Tên nhà máy không được để trống'); return; }
    setBusyId(c.id);
    const { data, error } = await updateCompetitorClient(row, formToInput(editForm, row.kcn ?? zone.name));
    if (error) { toast('Lỗi: ' + error.message); setBusyId(null); return; }
    await logActivity({
      user, action: 'update', table: 'competitor_clients', recordId: row.id,
      description: `Cập nhật nhà máy "${row.client_name}" của đối thủ "${c.company_name}" tại ${zone.name}`,
      oldData: row, newData: data,
    });
    setEditingRow(null);
    await load();
    setBusyId(null);
    toast('Đã cập nhật');
  };

  const handleDeleteFactory = async (row: CompetitorClient, c: Competitor) => {
    if (!confirm(
      `Xoá nhà máy "${row.client_name}" khỏi danh sách khách hàng của đối thủ "${c.company_name}"?\n\n`
      + `Dòng này sẽ bị XOÁ VĨNH VIỄN khỏi hồ sơ đối thủ (mục "KH đang phục vụ"), không chỉ ẩn khỏi KCN này. Không thể hoàn tác.`,
    )) return;
    setBusyId(c.id);
    const { error } = await supabase.from('competitor_clients').delete().eq('id', row.id);
    if (error) { toast('Lỗi: ' + error.message); setBusyId(null); return; }
    await logActivity({
      user, action: 'delete', table: 'competitor_clients', recordId: row.id,
      description: `Xoá nhà máy "${row.client_name}" khỏi đối thủ "${c.company_name}" (tại ${zone.name})`,
      oldData: row,
    });
    await load();
    setBusyId(null);
    toast('Đã xoá');
  };

  const toggleExpand = (id: string) => setExpanded(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div id="zone-competitors" className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden scroll-mt-4">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
        <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5">
          <Eye size={12} /> Đối thủ đang hoạt động tại KCN này
        </div>
        <span className="text-[11px] text-[#888]">
          {presences.length} đơn vị{unrecordedCount ? ` · ${unrecordedCount} chưa ghi nhận` : ''}
        </span>
        <button
          onClick={() => { setShowPicker(true); setPicked(new Set()); setPickerSearch(''); }}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF]"
        >
          <Plus size={12} /> Chọn đối thủ tại đây
        </button>
      </div>

      {missingCols.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11.5px] text-amber-800 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 flex-none" />
          <span>
            Database chưa có cột <b>{missingCols.join(', ')}</b> — các ô này sẽ không lưu được.
            Chạy migration <b>139</b> trong Supabase SQL Editor để dùng đầy đủ.
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 p-3 bg-[#FBFBF9] border-b border-[#F0EEE9]">
        <div className="px-3 py-2 bg-white rounded-lg border border-[#F0EEE9]">
          <div className="text-[10.5px] text-[#888]">Đối thủ tại đây</div>
          <div className="text-[16px] font-medium">{presences.length}</div>
          <div className="text-[10.5px] text-[#aaa]">{presences.filter(p => p.recorded).length} đã ghi nhận</div>
        </div>
        <div className="px-3 py-2 bg-white rounded-lg border border-[#F0EEE9]">
          <div className="text-[10.5px] text-[#888]">LĐ đối thủ đã nắm</div>
          <div className="text-[16px] font-medium text-red-600">{knownWorkers.toLocaleString('vi-VN')}</div>
          <div className="text-[10.5px] text-[#aaa]">Từ {presences.reduce((s, p) => s + p.factories.length, 0)} nhà máy đã biết</div>
        </div>
        <div className="px-3 py-2 bg-white rounded-lg border border-[#F0EEE9] border-l-[3px] border-l-blue-500">
          <div className="text-[10.5px] text-[#888]">LĐ của P. Kinh Doanh</div>
          <div className="text-[16px] font-medium text-blue-700">{ourWorkers.toLocaleString('vi-VN')}</div>
          <div className="text-[10.5px] text-[#aaa]">
            {knownWorkers + ourWorkers > 0 ? `${Math.round((ourWorkers / (knownWorkers + ourWorkers)) * 100)}% so với đối thủ đã nắm` : '—'}
          </div>
        </div>
        <div className="px-3 py-2 bg-white rounded-lg border border-[#F0EEE9]">
          <div className="text-[10.5px] text-[#888]">LĐ chưa rõ nguồn</div>
          <div className="text-[16px] font-medium text-amber-600">{totalWorkers ? unknownWorkers.toLocaleString('vi-VN') : '—'}</div>
          <div className="text-[10.5px] text-[#aaa]">{totalWorkers ? `Trên tổng ${totalWorkers.toLocaleString('vi-VN')} LĐ toàn KCN` : 'Chưa nhập tổng LĐ KCN'}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="border-b border-[#E8E7E2]">
            {['Đối thủ', 'Ghi nhận', 'LĐ tại KCN', 'Nhà máy đang phục vụ', 'Phí PT / TN / KTV', 'Lương trả', 'Nguồn tuyển', ''].map(h => (
              <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center py-4 text-[#aaa]">Đang tải…</td></tr>
            )}
            {!loading && !presences.length && (
              <tr><td colSpan={8} className="text-center py-5 text-[#aaa] text-[12px]">
                Chưa ghi nhận đối thủ nào tại KCN này. Bấm <span className="text-[#666] font-medium">"Chọn đối thủ tại đây"</span> để chọn từ danh sách ở tab Đối thủ.
              </td></tr>
            )}
            {!loading && presences.map(p => {
              const isOpen = expanded.has(p.c.id);
              return (
                <Fragment key={p.c.id}>
                  <tr className="border-b border-[#F0EEE9] last:border-0 hover:bg-[#FBFBF9]">
                    <td className="px-3 py-2">
                      <button onClick={() => onOpenCompetitor(p.c)} className="font-medium text-[#111] hover:text-blue-700 hover:underline text-left inline-flex items-center gap-1">
                        {p.c.company_name} <ExternalLink size={10} className="text-[#bbb]" />
                      </button>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {p.isHq && <span className={`${pill} bg-purple-50 text-purple-700`}>Trụ sở / KV chính</span>}
                        {!p.isHq && p.c.zone_name && <span className="text-[10px] text-[#aaa]">Trụ sở: {p.c.zone_name}</span>}
                        {p.c.trend && <span className={`${pill} bg-gray-100 text-gray-600`}>{p.c.trend}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {p.recorded
                        ? <span className={`${pill} bg-emerald-50 text-emerald-700 inline-flex items-center gap-1`}><Check size={10} /> Đã ghi nhận</span>
                        : (
                          <button
                            onClick={() => handleRecordOne(p.c)}
                            disabled={busyId === p.c.id}
                            title={p.isHq ? 'Đang khớp theo Trụ sở/KV chính' : 'Đang khớp theo nhà máy họ phục vụ trong KCN'}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-60"
                          >
                            <Plus size={10} /> Chưa ghi nhận
                          </button>
                        )}
                    </td>
                    <td className="px-3 py-2 text-red-600 font-medium">{p.workers ? p.workers.toLocaleString('vi-VN') : '—'}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => toggleExpand(p.c.id)} className="inline-flex items-center gap-1 text-[11.5px] text-[#555] hover:text-blue-700">
                        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        {p.factories.length ? `${p.factories.length} nhà máy` : 'Chưa biết nhà máy nào'}
                      </button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[#444]">
                      {fmtTr(p.c.fee_unskilled)} / {fmtTr(p.c.fee_skilled)} / {fmtTr(p.c.fee_tech)}
                    </td>
                    <td className="px-3 py-2 text-emerald-700">{fmtTr(p.c.wage_paid)}</td>
                    <td className="px-3 py-2 text-[#666]">{p.c.recruitment_source || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {p.recorded && (
                        <button
                          onClick={() => handleUnrecord(p)}
                          disabled={busyId === p.c.id}
                          title="Gỡ khỏi KCN này (không xoá hồ sơ đối thủ)"
                          className="p-1 rounded hover:bg-red-50 text-[#bbb] hover:text-red-600 disabled:opacity-60"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[#F0EEE9] bg-[#FBFBF9]">
                      <td colSpan={8} className="px-4 py-3">
                        {p.factories.length > 0 && (
                          <table className="w-full text-[11.5px] mb-2 bg-white border border-[#E8E7E2] rounded-lg overflow-hidden">
                            <thead><tr className="border-b border-[#F0EEE9]">
                              {['Nhà máy', 'Số LĐ', 'Sale phụ trách', 'SĐT sale', 'Phí sale/tháng', ''].map(h => (
                                <th key={h} className="text-left px-2.5 py-1.5 text-[10.5px] text-[#999] font-medium whitespace-nowrap">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {p.factories.map(f => editingRow === f.id ? (
                                <tr key={f.id} className="border-b border-[#F0EEE9] last:border-0 bg-blue-50/40">
                                  <td className="px-2.5 py-1.5"><input value={editForm.client_name} onChange={e => setEditForm(v => ({ ...v, client_name: e.target.value }))} className={`${inputCls} w-44`} /></td>
                                  <td className="px-2.5 py-1.5">
                                    <input type="number" min={0} value={editForm.worker_count} onChange={e => setEditForm(v => ({ ...v, worker_count: e.target.value }))} className={`${inputCls} w-20`} />
                                  </td>
                                  <td className="px-2.5 py-1.5"><input value={editForm.sale_name} onChange={e => setEditForm(v => ({ ...v, sale_name: e.target.value }))} placeholder="Tên sale" className={`${inputCls} w-32`} /></td>
                                  <td className="px-2.5 py-1.5"><input value={editForm.sale_phone} onChange={e => setEditForm(v => ({ ...v, sale_phone: e.target.value }))} placeholder="SĐT" className={`${inputCls} w-28`} /></td>
                                  <td className="px-2.5 py-1.5"><input type="number" min={0} value={editForm.sale_fee} onChange={e => setEditForm(v => ({ ...v, sale_fee: e.target.value }))} placeholder="₫/tháng" className={`${inputCls} w-28`} /></td>
                                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                                    <button onClick={() => handleSaveFactory(f, p.c)} disabled={busyId === p.c.id} className="px-2 py-1 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60">Lưu</button>
                                    <button onClick={() => setEditingRow(null)} className="ml-1 px-2 py-1 rounded-lg text-[11px] border border-gray-300 text-[#666]">Huỷ</button>
                                  </td>
                                </tr>
                              ) : (
                                <tr key={f.id} className="border-b border-[#F0EEE9] last:border-0">
                                  <td className="px-2.5 py-1.5 text-[#222]"><Building2 size={10} className="inline text-[#bbb] mr-1" />{f.client_name}</td>
                                  {/* Rê chuột vào con số → biết số liệu này chốt từ bao giờ. */}
                                  <td className="px-2.5 py-1.5">
                                    <span title={workersTooltip(f)} className="font-medium text-red-600 border-b border-dotted border-red-300 cursor-help">
                                      {(f.worker_count ?? 0).toLocaleString('vi-VN')}
                                    </span>
                                  </td>
                                  <td className="px-2.5 py-1.5 text-[#666]">{f.sale_name || '—'}</td>
                                  <td className="px-2.5 py-1.5 text-[#666]">{f.sale_phone || '—'}</td>
                                  <td className="px-2.5 py-1.5 text-blue-700">{f.sale_fee ? formatCurrency(f.sale_fee) : '—'}</td>
                                  <td className="px-2.5 py-1.5 whitespace-nowrap text-right">
                                    <button onClick={() => startEditFactory(f)} title="Sửa số LĐ / thông tin sale" className="p-1 rounded hover:bg-blue-50 text-[#bbb] hover:text-blue-600"><Pencil size={11} /></button>
                                    <button onClick={() => handleDeleteFactory(f, p.c)} title="Xoá nhà máy này" className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-600"><Trash2 size={11} /></button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {!p.factories.length && (
                          <div className="text-[11.5px] text-[#999] mb-2">
                            Chưa biết đối thủ này đang cung ứng cho nhà máy nào trong KCN. Thêm vào đây để tính được số LĐ họ đang giữ.
                          </div>
                        )}
                        {factoryFor === p.c.id ? (
                          <div className="flex items-end gap-2 flex-wrap bg-white border border-[#E8E7E2] rounded-lg p-2.5">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10.5px] text-[#888]">Nhà máy trong KCN</label>
                              <SearchSelect
                                value={factoryForm.client_name}
                                onChange={v => setFactoryForm(f => ({ ...f, client_name: v }))}
                                options={factoryOptions}
                                placeholder="Chọn / gõ tên nhà máy…"
                                allowAdd
                                onAdd={v => setFactoryForm(f => ({ ...f, client_name: v }))}
                                className="w-56"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10.5px] text-[#888]">Số LĐ đang cung ứng</label>
                              <input type="number" min={0} value={factoryForm.worker_count} onChange={e => setFactoryForm(f => ({ ...f, worker_count: e.target.value }))} className={`${inputCls} w-28 py-1.5`} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10.5px] text-[#888]">Sale phụ trách</label>
                              <input value={factoryForm.sale_name} onChange={e => setFactoryForm(f => ({ ...f, sale_name: e.target.value }))} className={`${inputCls} w-36 py-1.5`} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10.5px] text-[#888]">SĐT sale</label>
                              <input value={factoryForm.sale_phone} onChange={e => setFactoryForm(f => ({ ...f, sale_phone: e.target.value }))} className={`${inputCls} w-32 py-1.5`} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10.5px] text-[#888]">Phí sale/tháng (₫)</label>
                              <input type="number" min={0} value={factoryForm.sale_fee} onChange={e => setFactoryForm(f => ({ ...f, sale_fee: e.target.value }))} className={`${inputCls} w-32 py-1.5`} />
                            </div>
                            <button onClick={() => handleAddFactory(p.c)} disabled={busyId === p.c.id} className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60">
                              {busyId === p.c.id ? 'Đang lưu…' : 'Thêm nhà máy'}
                            </button>
                            <button onClick={() => { setFactoryFor(null); setFactoryForm(emptyFactoryForm); }} className="px-3 py-1.5 rounded-lg text-[11.5px] border border-gray-300 text-[#666]">Huỷ</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingRow(null); setFactoryFor(p.c.id); setFactoryForm(emptyFactoryForm); }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-white">
                            <Plus size={11} /> Thêm nhà máy họ đang phục vụ
                          </button>
                        )}
                        <div className="mt-2 text-[10.5px] text-[#aaa]">
                          Dữ liệu này dùng chung với mục "KH đang phục vụ" trong hồ sơ đối thủ — sửa ở đâu cũng hiện ở cả hai nơi.
                          Rê chuột vào số LĐ để xem số liệu chốt từ bao giờ.
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {broadSuggestions.length > 0 && (
        <div className="border-t border-[#F0EEE9] px-4 py-2.5">
          <button onClick={() => setShowBroad(v => !v)} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#666] hover:text-blue-700">
            {showBroad ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Có thể liên quan: {broadSuggestions.length} đối thủ khai hoạt động ở {zone.location || 'tỉnh này'} / toàn quốc
          </button>
          {showBroad && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {broadSuggestions.map(c => (
                <span key={c.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#F9F9F7] border border-[#E8E7E2] text-[11.5px]">
                  <button onClick={() => onOpenCompetitor(c)} className="text-[#222] hover:text-blue-700 hover:underline">{c.company_name}</button>
                  <span className="text-[10px] text-[#aaa]">{c.zone_name}</span>
                  <button onClick={() => handleRecordOne(c)} disabled={busyId === c.id} className="text-blue-600 hover:text-blue-800 disabled:opacity-60" title={`Ghi nhận tại ${zone.name}`}>
                    <Plus size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-2 bg-[#F9F9F7] text-[10.5px] text-[#999] flex items-start gap-1.5">
        <Info size={11} className="mt-0.5 flex-none" />
        <span>
          Ghi nhận ở đây = thêm "{zone.name}" vào ô <b>Khu vực hoạt động</b> trong hồ sơ đối thủ, nên tab Đối thủ và trang Báo giá đều thấy ngay.
          Dòng nhãn <b>Chưa ghi nhận</b> là hệ thống tự phát hiện qua Trụ sở/KV chính hoặc nhà máy họ đang phục vụ trong KCN.
        </span>
      </div>

      {showPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-2xl shadow-xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2]">
              <div>
                <h2 className="text-[15px] font-semibold text-[#111] flex items-center gap-1.5"><Eye size={15} /> Chọn đối thủ hoạt động tại {zone.name}</h2>
                <div className="text-[11px] text-[#888] mt-0.5">Danh sách lấy từ module Đối thủ · chọn nhiều cùng lúc</div>
              </div>
              <button onClick={() => setShowPicker(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>

            <div className="px-5 py-2.5 border-b border-[#F0EEE9]">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aaa]" />
                <input
                  autoFocus
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="Tìm tên đối thủ… (gõ không dấu cũng ra)"
                  className="w-full text-[12.5px] pl-8 pr-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-1.5">
              {!pickerList.length && (
                <div className="text-center py-6 text-[12px] text-[#aaa]">
                  {competitors.length ? 'Không tìm thấy đối thủ nào phù hợp (những đơn vị đã ghi nhận không hiện ở đây).' : 'Chưa có đối thủ nào. Thêm ở tab Đối thủ trước.'}
                </div>
              )}
              {pickerList.map(c => {
                const checked = picked.has(c.id);
                const zones = [c.zone_name, ...(c.active_zones ?? [])];
                const hint = zones.some(z => sameZone(z, zone.location)) ? `Đang hoạt động ở ${zone.location}`
                  : zones.some(z => isNationwide(z)) ? 'Khai phủ toàn quốc' : null;
                return (
                  <label key={c.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer ${checked ? 'bg-blue-50' : 'hover:bg-[#F9F9F7]'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setPicked(s => {
                        const next = new Set(s);
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        return next;
                      })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-[#111] truncate">{c.company_name}</div>
                      <div className="text-[10.5px] text-[#888] truncate">
                        Trụ sở: {c.zone_name || '—'}
                        {(c.active_zones?.length ?? 0) > 0 && ` · ${c.active_zones!.length} khu vực đang hoạt động`}
                        {c.total_workers ? ` · ${c.total_workers.toLocaleString('vi-VN')} LĐ toàn hệ thống` : ''}
                      </div>
                    </div>
                    {hint && <span className={`${pill} bg-blue-50 text-blue-700`}>{hint}</span>}
                  </label>
                );
              })}
            </div>

            <div className="flex items-center gap-2 px-5 py-3 border-t border-[#E8E7E2]">
              <span className="text-[11.5px] text-[#888] mr-auto">Đã chọn {picked.size}</span>
              <button onClick={() => setShowPicker(false)} className="px-4 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Huỷ</button>
              <button onClick={handleSavePicked} disabled={savingPick || !picked.size} className="px-4 py-1.5 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">
                {savingPick ? 'Đang lưu…' : `Ghi nhận ${picked.size || ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

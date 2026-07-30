import { useEffect, useState, useMemo, useRef } from 'react';
import { ArrowLeft, Pencil, Save, Plus, X, MapPin, ExternalLink, User, RotateCcw, Settings, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/format';
import type { Competitor, CompetitorClient, CompetitorLog, MarketZone, Client, MarketLead } from '../../lib/types';
import { useProvinces } from '../../hooks/useProvinces';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import SearchSelect from './SearchSelect';
import { type CompetitorLinkType, fetchLinkTypes, getLinkUrl, iconForLinkKey } from './competitorLinks';
import { FOCUS_PROVINCES } from './populationData';
import { type RecruitmentSource, fetchRecruitmentSources, addRecruitmentSource, deleteRecruitmentSource } from './recruitmentSources';

interface Contact { name: string; phone: string }

// Chưa nhập nhân sự nào theo danh sách mới (migration 127) — dùng tạm Giám đốc + tối đa 2 SĐT
// cũ để không mất dữ liệu đã có, cho tới khi người dùng sửa & lưu lại theo danh sách mới.
function legacyContactsOf(c: Competitor): Contact[] {
  const list: Contact[] = [];
  if (c.director || c.director_phone) list.push({ name: c.director ?? '', phone: c.director_phone ?? '' });
  if (c.director_phone2) list.push({ name: '', phone: c.director_phone2 });
  return list;
}

// Tên tỉnh cũ (trước sáp nhập 01/07/2025) của 1 tỉnh MỚI — dùng để hiện tooltip khi hover.
function oldNamesOfProvince(name: string): string[] {
  const match = FOCUS_PROVINCES.find(p => p.name === name);
  return match ? match.oldNames.map(o => o.replace(/\s*\(cũ\)\s*$/, '').trim()) : [];
}
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';

interface Props {
  competitor: Competitor;
  allCompetitors: Competitor[];
  marketZones: MarketZone[];
  clients: Client[];
  marketLeads: MarketLead[];
  onBack: () => void;
  onRefresh: () => Promise<void>;
  toast: (msg: string) => void;
}

interface LgClient { id: string; name: string; industrial_zones: string[] }

export default function CompetitorDetail({ competitor, allCompetitors, marketZones, clients, marketLeads, onBack, onRefresh, toast }: Props) {
  const { user } = useAuth();
  const [lgClients, setLgClients] = useState<LgClient[]>([]);
  const [compClients, setCompClients] = useState<CompetitorClient[]>([]);
  const [logs, setLogs] = useState<CompetitorLog[]>([]);
  const { provinces } = useProvinces();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_name: competitor.company_name,
    zone_name: competitor.zone_name,
    total_workers: competitor.total_workers ?? 0,
    recruitment_source: competitor.recruitment_source ?? '',
    strengths: competitor.strengths ?? '',
    weaknesses: competitor.weaknesses ?? '',
    image_url: competitor.image_url ?? '',
    image_pos_x: competitor.image_pos_x ?? 50,
    image_pos_y: competitor.image_pos_y ?? 50,
    image_fit: competitor.image_fit ?? 'cover',
    contacts: competitor.contacts?.length ? competitor.contacts : legacyContactsOf(competitor),
    map_link: competitor.map_link ?? '',
    website_url: competitor.website_url ?? '',
    facebook_url: competitor.facebook_url ?? '',
    tiktok_url: competitor.tiktok_url ?? '',
    social_other_url: competitor.social_other_url ?? '',
  });
  // Chốt lại snapshot ban đầu để cảnh báo F5/đóng tab khi đang sửa dở mà chưa bấm "Lưu".
  const [initialForm, setInitialForm] = useState(form);
  useBeforeUnloadWarning(JSON.stringify(form) !== JSON.stringify(initialForm));
  const [activeZones, setActiveZones] = useState<string[]>(competitor.active_zones ?? []);

  // Nút liên kết nhanh (Bản đồ/Website/Facebook/TikTok…) — cấu hình chung, quản lý ở tab
  // Đối thủ (nút cài đặt). Loại tự thêm (field null) lưu giá trị vào custom_links[key].
  const [linkTypes, setLinkTypes] = useState<CompetitorLinkType[]>([]);
  useEffect(() => { fetchLinkTypes().then(setLinkTypes); }, []);
  const [customLinkDrafts, setCustomLinkDrafts] = useState<Record<string, string>>(competitor.custom_links ?? {});

  const addContactRow = () => setForm(f => ({ ...f, contacts: [...f.contacts, { name: '', phone: '' }] }));
  const removeContactRow = (i: number) => setForm(f => ({ ...f, contacts: f.contacts.filter((_, idx) => idx !== i) }));
  const updateContactRow = (i: number, patch: Partial<Contact>) => setForm(f => ({ ...f, contacts: f.contacts.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));

  // Danh sách "Nguồn tuyển" dùng chung toàn hệ thống — thêm ở đây (kể cả gõ tự do trong ô
  // chọn) sẽ lưu lại để lần sau chỉ việc chọn, không phải gõ lại.
  const [sources, setSources] = useState<RecruitmentSource[]>([]);
  const [showSourceSettings, setShowSourceSettings] = useState(false);
  const loadSources = () => { fetchRecruitmentSources().then(setSources); };
  useEffect(() => { loadSources(); }, []);
  const sourceOptions = useMemo(() => sources.map(s => ({ value: s.label, label: s.label })), [sources]);
  const handleAddSource = async (label: string) => {
    const err = await addRecruitmentSource(label, sources);
    if (err) { toast('Lỗi thêm nguồn tuyển: ' + err); return; }
    loadSources();
  };
  const handleDeleteSource = async (s: RecruitmentSource) => {
    if (!confirm(`Xoá nguồn tuyển "${s.label}"? Đối thủ đã chọn nguồn này vẫn giữ nguyên giá trị, chỉ không còn trong danh sách gợi ý.`)) return;
    const err = await deleteRecruitmentSource(s.id);
    if (err) { toast('Lỗi xoá: ' + err); return; }
    loadSources();
  };

  // Kéo ảnh cover để chỉnh object-position — khung xem trước cùng tỷ lệ với thẻ thật (h-32)
  // nên "vừa với khung hình" đúng như hiển thị thực tế, không cần biết ảnh ngang hay dọc.
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const [draggingImg, setDraggingImg] = useState(false);
  const handleImgDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingImg(true);
    const box = imgBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const dxPct = ((ev.movementX) / rect.width) * 100;
      const dyPct = ((ev.movementY) / rect.height) * 100;
      // Kéo ảnh sang phải → lộ phần bên trái ảnh ra → object-position X giảm.
      setForm(f => ({
        ...f,
        image_pos_x: Math.min(100, Math.max(0, f.image_pos_x - dxPct)),
        image_pos_y: Math.min(100, Math.max(0, f.image_pos_y - dyPct)),
      }));
    };
    const onUp = () => {
      setDraggingImg(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const kcnNameSet = useMemo(() => new Set(marketZones.map(z => z.name)), [marketZones]);

  const zoneOptions = useMemo(() => {
    const kcnNames = marketZones.map(z => z.name);
    // `provinces` (useProvinces) là tên tỉnh CŨ đang dùng phổ biến trong dữ liệu hiện có — vẫn giữ
    // nguyên để chọn. Thêm tên tỉnh MỚI sau sáp nhập (FOCUS_PROVINCES) làm lựa chọn bổ sung.
    const focusNew = FOCUS_PROVINCES.map(p => p.name);
    const all = [...new Set([...kcnNames, ...provinces, ...focusNew])].sort((a, b) => a.localeCompare(b, 'vi'));
    return all.filter(z => !activeZones.includes(z)).map(z => ({ value: z, label: z }));
  }, [marketZones, provinces, activeZones]);

  // Nhóm các khu vực hoạt động thành cột theo tỉnh — KCN thì lấy tỉnh đã gán sẵn lúc tạo KCN
  // (marketZones.location); mục nhập kiểu "tỉnh thành" (gõ tay, không phải KCN) tự làm cột riêng.
  const groupedZones = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const z of activeZones) {
      const key = kcnNameSet.has(z) ? (marketZones.find(m => m.name === z)?.location || 'Chưa gắn tỉnh') : z;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(z);
    }
    return Array.from(map.entries())
      .map(([province, items]) => ({ province, items }))
      .sort((a, b) => a.province.localeCompare(b.province, 'vi'));
  }, [activeZones, kcnNameSet, marketZones]);

  const addActiveZone = async (zone: string) => {
    const next = [...activeZones, zone];
    setActiveZones(next);
    const { error } = await supabase.from('competitors').update({ active_zones: next }).eq('id', competitor.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    competitor.active_zones = next;
  };

  // Danh sách gợi ý cho "Trụ sở chính" — đếm số đối thủ khác đang dùng mỗi khu vực (Trụ sở chính +
  // Khu vực hoạt động của họ) để khu vực nào đang tập trung nhiều đối thủ hiện lên đầu, dễ chọn
  // nhanh hơn là phải gõ lại từ đầu. Vẫn cho gõ tự do (allowAdd) cho các trường hợp như "Toàn quốc".
  const hqOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of allCompetitors) {
      if (c.id === competitor.id) continue;
      if (c.zone_name) counts.set(c.zone_name, (counts.get(c.zone_name) ?? 0) + 1);
      for (const z of c.active_zones ?? []) counts.set(z, (counts.get(z) ?? 0) + 1);
    }
    const kcnNames = marketZones.map(z => z.name);
    const focusNew = FOCUS_PROVINCES.map(p => p.name);
    const all = new Set<string>(['Toàn quốc', ...counts.keys(), ...provinces, ...kcnNames, ...focusNew]);
    return Array.from(all)
      .sort((a, b) => {
        const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
        return diff !== 0 ? diff : a.localeCompare(b, 'vi');
      })
      .map(z => ({ value: z, label: z }));
  }, [allCompetitors, competitor.id, marketZones, provinces]);

  // Danh sách KCN/Tỉnh thành để chọn cho "KH đang phục vụ" khi công ty chưa có hồ sơ gán sẵn
  // KCN (industrial_zones/region) — tránh phải gõ tay, dữ liệu không đồng bộ được với các nơi
  // khác đang dùng đúng tên KCN chính thức.
  const kcnPickOptions = useMemo(() => {
    const kcnNames = marketZones.map(z => z.name);
    const focusNew = FOCUS_PROVINCES.map(p => p.name);
    const all = [...new Set([...kcnNames, ...provinces, ...focusNew])].sort((a, b) => a.localeCompare(b, 'vi'));
    return all.map(z => ({ value: z, label: z }));
  }, [marketZones, provinces]);

  const removeActiveZone = async (zone: string) => {
    const next = activeZones.filter(z => z !== zone);
    setActiveZones(next);
    const { error } = await supabase.from('competitors').update({ active_zones: next }).eq('id', competitor.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    competitor.active_zones = next;
  };

  const [logNote, setLogNote] = useState('');
  const [logSource, setLogSource] = useState('');
  const [clientForm, setClientForm] = useState({ client_name: '', kcn: '', worker_count: '', sale_name: '', sale_phone: '', sale_fee: '' });
  const [kcnFromProfile, setKcnFromProfile] = useState(false);

  // Danh sách gợi ý cho "Tên nhà máy" — gộp Khách hàng đang hợp tác (clients) +
  // Công ty/Dự án đang tìm hiểu (market_leads) bên tab Công ty/Dự án. Chọn tên chưa có
  // trong 2 nguồn này sẽ tạo mới 1 "Công ty/Dự án đang tìm hiểu" để đồng bộ ngược lại đó.
  const companyNameOptions = useMemo(() => {
    const names = new Set<string>([...clients.map(c => c.name), ...marketLeads.map(l => l.company_name)]);
    return [...names].sort((a, b) => a.localeCompare(b, 'vi')).map(n => ({ value: n, label: n }));
  }, [clients, marketLeads]);

  // KCN đã setup sẵn ở hồ sơ Khách hàng/Dự án ứng với tên công ty — dùng để tự nhảy về
  // đúng KCN khi chọn tên; nếu công ty đó chưa có KCN nào thì cho gõ tay và đồng bộ ngược lại.
  const zoneForCompany = (name: string): string | null => {
    const cl = clients.find(c => c.name === name);
    if (cl?.industrial_zones?.length) return cl.industrial_zones[0];
    const ld = marketLeads.find(l => l.company_name === name);
    if (ld?.region) return ld.region;
    return null;
  };

  const handlePickClientName = (name: string) => {
    const zone = zoneForCompany(name);
    setClientForm(f => ({ ...f, client_name: name, kcn: zone || '' }));
    setKcnFromProfile(!!zone);
  };

  const handleCreateLeadFromName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const { data, error } = await supabase.from('market_leads').insert({
        company_name: trimmed,
        region: competitor.zone_name || null,
        source: `Phát hiện từ đối thủ "${competitor.company_name}"`,
        status: 'Chưa LH',
        suppliers: [{ name: competitor.company_name, qty: 0, is_us: false }],
      }).select().single();
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: 'market_leads', recordId: data.id,
        description: `Thêm công ty/dự án "${trimmed}" (phát hiện từ đối thủ "${competitor.company_name}")`,
        newData: data,
      });
      if (!competitor.supplying_for?.includes(trimmed)) {
        const supplying_for = [...(competitor.supplying_for ?? []), trimmed];
        await supabase.from('competitors').update({ supplying_for }).eq('id', competitor.id);
        competitor.supplying_for = supplying_for;
      }
      await onRefresh();
      toast(`Đã thêm "${trimmed}" vào Công ty/Dự án đang tìm hiểu`);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setClientForm(f => ({ ...f, client_name: trimmed }));
  };

  const load = async () => {
    const [{ data: clientsData }, { data: ccData }, { data: logsData }] = await Promise.all([
      supabase.from('clients').select('id, name, industrial_zones').is('archived_at', null),
      supabase.from('competitor_clients').select('*').eq('competitor_id', competitor.id),
      supabase.from('competitor_logs').select('*').eq('competitor_id', competitor.id).order('created_at', { ascending: false }),
    ]);
    setLgClients(clientsData ?? []);
    setCompClients(ccData ?? []);
    setLogs(logsData ?? []);
  };

  useEffect(() => { load(); }, [competitor.id]);

  const handleSave = async () => {
    setSaving(true);
    const custom_links = Object.fromEntries(Object.entries(customLinkDrafts).filter(([, v]) => v.trim()));
    const patch = {
      company_name: form.company_name.trim(),
      zone_name: form.zone_name.trim(),
      total_workers: form.total_workers,
      recruitment_source: form.recruitment_source.trim() || null,
      strengths: form.strengths.trim() || null,
      weaknesses: form.weaknesses.trim() || null,
      image_url: form.image_url.trim() || null,
      image_pos_x: form.image_pos_x,
      image_pos_y: form.image_pos_y,
      image_fit: form.image_fit,
      contacts: form.contacts.map(c => ({ name: c.name.trim(), phone: c.phone.trim() })).filter(c => c.name || c.phone),
      map_link: form.map_link.trim() || null,
      website_url: form.website_url.trim() || null,
      facebook_url: form.facebook_url.trim() || null,
      tiktok_url: form.tiktok_url.trim() || null,
      social_other_url: form.social_other_url.trim() || null,
      custom_links,
    };
    const { error } = await supabase.from('competitors').update(patch).eq('id', competitor.id);
    setSaving(false);
    if (error) { toast('Lỗi: ' + error.message); return; }
    Object.assign(competitor, patch);
    setEditing(false);
    setInitialForm(form);
    toast('Đã lưu thông tin đối thủ');
  };

  const handleAddLog = async () => {
    if (!logNote.trim()) return;
    const { error } = await supabase.from('competitor_logs').insert({
      competitor_id: competitor.id,
      note: logNote.trim(),
      source: logSource.trim() || null,
    });
    if (error) { toast('Lỗi: ' + error.message); return; }
    setLogNote('');
    setLogSource('');
    await load();
  };

  const handleAddClient = async () => {
    const name = clientForm.client_name.trim();
    const kcn = clientForm.kcn.trim();
    if (!name) return;
    const { error } = await supabase.from('competitor_clients').insert({
      competitor_id: competitor.id,
      client_name: name,
      kcn: kcn || null,
      worker_count: clientForm.worker_count ? parseInt(clientForm.worker_count, 10) : 0,
      sale_name: clientForm.sale_name.trim() || null,
      sale_phone: clientForm.sale_phone.trim() || null,
      sale_fee: clientForm.sale_fee ? parseFloat(clientForm.sale_fee) : null,
    });
    if (error) { toast('Lỗi: ' + error.message); return; }

    // Công ty chưa có KCN nào ở hồ sơ Khách hàng/Dự án — KCN gõ tay ở đây được đồng bộ
    // ngược lại hồ sơ đó, để lần sau chọn tên sẽ tự nhảy về đúng KCN.
    if (kcn && !kcnFromProfile) {
      const cl = clients.find(c => c.name === name);
      const ld = marketLeads.find(l => l.company_name === name);
      if (cl && !cl.industrial_zones?.length) {
        await supabase.from('clients').update({ industrial_zones: [kcn] }).eq('id', cl.id);
      } else if (ld && !ld.region) {
        await supabase.from('market_leads').update({ region: kcn }).eq('id', ld.id);
      }
      await onRefresh();
    }

    setClientForm({ client_name: '', kcn: '', worker_count: '', sale_name: '', sale_phone: '', sale_fee: '' });
    setKcnFromProfile(false);
    await load();
  };

  const isSharedClient = (name: string) => {
    const n = name.trim().toLowerCase();
    if (!n) return false;
    return lgClients.some(c => {
      const cn = c.name.trim().toLowerCase();
      return cn === n || cn.includes(n) || n.includes(cn);
    });
  };

  const feeRow = (label: string, value: number | null, cls?: string) => (
    <div className="flex items-center justify-between px-3 py-2 border-b border-[#F0EEE9] last:border-0">
      <span className="text-[12px] text-[#888]">{label}</span>
      <span className={`text-[13px] font-semibold ${cls ?? 'text-[#111]'}`}>{value != null ? formatCurrency(value) : '—'}</span>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#E8E7E2] bg-white hover:bg-[#F9F9F7] transition">
          <ArrowLeft size={13} /> Quay lại
        </button>
        {competitor.image_url && (
          <div className="w-9 h-9 rounded-lg overflow-hidden border border-gray-200 shrink-0">
            <img src={competitor.image_url} alt="" className={`w-full h-full ${competitor.image_fit === 'contain' ? 'object-contain' : 'object-cover'}`} style={{ objectPosition: `${competitor.image_pos_x ?? 50}% ${competitor.image_pos_y ?? 50}%` }} />
          </div>
        )}
        <div className="text-[15px] font-semibold text-[#111]">{competitor.company_name}</div>
        <span className="px-2 py-0.5 rounded-full bg-[#F9F9F7] border border-[#E8E7E2] text-[11px] text-[#666]">{competitor.zone_name}</span>
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E8E7E2] flex items-center justify-between gap-2 flex-wrap bg-gradient-to-r from-blue-50/60 to-transparent">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0"><MapPin size={14} /></div>
            <div>
              <div className="text-[12.5px] font-semibold text-[#111]">Khu vực hoạt động</div>
              <div className="text-[10.5px] text-[#999]">{activeZones.length} khu vực đã chọn</div>
            </div>
          </div>
          <SearchSelect value="" onChange={addActiveZone} options={zoneOptions} placeholder="+ Chọn KCN / Tỉnh thành…" className="w-56" />
        </div>
        <div className="p-3.5 flex gap-4 overflow-x-auto">
          {activeZones.length ? groupedZones.map(g => {
            const oldNames = oldNamesOfProvince(g.province);
            return (
              <div key={g.province} className="flex flex-col gap-1.5 min-w-[136px] shrink-0">
                <div
                  className="text-[11px] font-semibold text-[#666] flex items-center gap-1 pb-1.5 border-b border-[#F0EEE9]"
                  title={oldNames.length ? `Tên cũ: ${oldNames.join(', ')}` : undefined}
                >
                  <MapPin size={10} className="text-[#999] shrink-0" />
                  <span className="truncate">{g.province}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {g.items.map(z => {
                    const isKcn = kcnNameSet.has(z);
                    return (
                      <span key={z} className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11.5px] font-medium border ${isKcn ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-violet-50 text-violet-700 border-violet-100'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isKcn ? 'bg-blue-500' : 'bg-violet-500'}`} />
                        <span className="truncate">{z}</span>
                        <button onClick={() => removeActiveZone(z)} className="p-1.5 sm:p-0.5 rounded-full hover:bg-black/5 transition shrink-0"><X size={10} /></button>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          }) : (
            <span className="text-[11.5px] text-[#aaa]">Chưa chọn khu vực hoạt động nào</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* CỘT TRÁI */}
        <div className="space-y-3">
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2]">
              <div className="text-[12.5px] font-semibold text-[#111]">Thông tin chung</div>
              {!editing ? (
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] bg-white hover:bg-[#F9F9F7] transition">
                  <Pencil size={11} /> Chỉnh sửa
                </button>
              ) : (
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-50 transition">
                  <Save size={11} />{saving ? 'Đang lưu...' : 'Lưu'}
                </button>
              )}
            </div>
            <div className="p-4 space-y-3">
              {editing ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Tên</label>
                      <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Trụ sở chính</label>
                      <SearchSelect value={form.zone_name} onChange={v => setForm(f => ({ ...f, zone_name: v }))} options={hqOptions} placeholder="VD: Biên Hòa - Đồng Nai" allowAdd onAdd={() => {}} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Tổng LĐ ước tính</label>
                      <input type="number" min={0} value={form.total_workers} onChange={e => setForm(f => ({ ...f, total_workers: +e.target.value }))} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-[#888]">Nguồn tuyển</label>
                        <div className="relative">
                          <button type="button" onClick={() => setShowSourceSettings(v => !v)} title="Quản lý danh sách nguồn tuyển" className={`p-0.5 rounded transition ${showSourceSettings ? 'text-blue-700' : 'text-[#999] hover:text-[#333]'}`}>
                            <Settings size={11} />
                          </button>
                          {showSourceSettings && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setShowSourceSettings(false)} />
                              <div className="absolute right-0 top-full mt-1.5 z-20 w-[240px] bg-white border border-[#E8E7E2] rounded-[12px] shadow-xl p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-[11.5px] font-semibold text-[#111]">Danh sách nguồn tuyển</div>
                                  <button onClick={() => setShowSourceSettings(false)} className="p-1 hover:bg-gray-100 rounded"><X size={12} /></button>
                                </div>
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                  {sources.map(s => (
                                    <div key={s.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-gray-200">
                                      <span className="text-[11.5px] text-[#333] flex-1 truncate">{s.label}</span>
                                      <button onClick={() => handleDeleteSource(s)} className="p-1.5 sm:p-0.5 text-[#aaa] hover:text-red-500"><Trash2 size={11} /></button>
                                    </div>
                                  ))}
                                  {sources.length === 0 && <div className="text-[10.5px] text-[#aaa] py-1">Chưa có nguồn tuyển nào.</div>}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <SearchSelect value={form.recruitment_source} onChange={v => setForm(f => ({ ...f, recruitment_source: v }))} options={sourceOptions} placeholder="Chọn hoặc gõ để thêm mới…" allowAdd onAdd={handleAddSource} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-[#888]">Nhân sự liên hệ</label>
                      <button type="button" onClick={addContactRow} className="inline-flex items-center gap-1 text-[10.5px] text-blue-600 hover:underline"><Plus size={10} /> Thêm nhân sự</button>
                    </div>
                    {form.contacts.length === 0 && <span className="text-[11px] text-[#aaa]">Chưa có nhân sự nào</span>}
                    {form.contacts.map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input value={c.name} onChange={e => updateContactRow(i, { name: e.target.value })} placeholder="Tên nhân sự / chức vụ" className="flex-1 text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                        <input value={c.phone} onChange={e => updateContactRow(i, { phone: e.target.value })} placeholder="09xx xxx xxx" className="w-32 text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                        <button type="button" onClick={() => removeContactRow(i)} className="p-1.5 sm:p-1 rounded-lg text-[#aaa] hover:text-red-500 hover:bg-red-50 transition shrink-0"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-[#888]">Ảnh cover (link)</label>
                    <input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} placeholder="Dán link ảnh…" className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    {form.image_url && (
                      <div className="mt-1">
                        <div className="flex items-center gap-1 mb-1.5">
                          <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, image_fit: 'cover' }))}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-medium border transition ${form.image_fit !== 'contain' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
                          >
                            Lấp đầy (cắt ảnh)
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, image_fit: 'contain' }))}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-medium border transition ${form.image_fit === 'contain' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
                          >
                            Tự khớp (giữ nguyên ảnh)
                          </button>
                        </div>
                        <div
                          ref={imgBoxRef}
                          onMouseDown={form.image_fit === 'contain' ? undefined : handleImgDragStart}
                          className={`h-32 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 ${form.image_fit === 'contain' ? '' : draggingImg ? 'cursor-grabbing' : 'cursor-grab'}`}
                        >
                          <img
                            src={form.image_url}
                            alt=""
                            draggable={false}
                            className={`w-full h-full pointer-events-none select-none ${form.image_fit === 'contain' ? 'object-contain' : 'object-cover'}`}
                            style={{ objectPosition: `${form.image_pos_x}% ${form.image_pos_y}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10.5px] text-[#999]">
                            {form.image_fit === 'contain' ? 'Chế độ tự khớp: hiện toàn bộ ảnh, không cắt' : 'Kéo ảnh để chỉnh vị trí hiển thị — khung này đúng tỷ lệ thẻ thật'}
                          </span>
                          {form.image_fit !== 'contain' && (
                            <button onClick={() => setForm(f => ({ ...f, image_pos_x: 50, image_pos_y: 50 }))} className="inline-flex items-center gap-1 text-[10.5px] text-blue-600 hover:underline shrink-0">
                              <RotateCcw size={10} /> Về giữa
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Bản đồ (link Google Maps)</label>
                      <input value={form.map_link} onChange={e => setForm(f => ({ ...f, map_link: e.target.value }))} placeholder="https://maps.google.com/…" className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Website</label>
                      <input value={form.website_url} onChange={e => setForm(f => ({ ...f, website_url: e.target.value }))} placeholder="https://…" className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Facebook</label>
                      <input value={form.facebook_url} onChange={e => setForm(f => ({ ...f, facebook_url: e.target.value }))} placeholder="https://facebook.com/…" className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">TikTok</label>
                      <input value={form.tiktok_url} onChange={e => setForm(f => ({ ...f, tiktok_url: e.target.value }))} placeholder="https://tiktok.com/@…" className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Mạng xã hội khác</label>
                      <input value={form.social_other_url} onChange={e => setForm(f => ({ ...f, social_other_url: e.target.value }))} placeholder="https://…" className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    {linkTypes.filter(t => !t.field).map(t => (
                      <div key={t.id} className="flex flex-col gap-1">
                        <label className="text-[11px] text-[#888]">{t.label}</label>
                        <input
                          value={customLinkDrafts[t.key] ?? ''}
                          onChange={e => setCustomLinkDrafts(d => ({ ...d, [t.key]: e.target.value }))}
                          placeholder="https://…"
                          className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-[#888]">Điểm mạnh</label>
                    <textarea value={form.strengths} onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))} rows={2} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8] resize-y leading-relaxed" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-[#888]">Điểm yếu</label>
                    <textarea value={form.weaknesses} onChange={e => setForm(f => ({ ...f, weaknesses: e.target.value }))} rows={2} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8] resize-y leading-relaxed" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-[12.5px]">
                  <div className="flex justify-between"><span className="text-[#888]">Tên</span><span className="font-medium text-[#111]">{competitor.company_name}</span></div>
                  <div className="flex justify-between"><span className="text-[#888]">Trụ sở chính</span><span className="font-medium text-[#111]">{competitor.zone_name}</span></div>
                  <div className="flex justify-between"><span className="text-[#888]">Tổng LĐ ước tính</span><span className="font-medium text-[#111]">{(competitor.total_workers ?? 0).toLocaleString('vi-VN')}</span></div>
                  <div className="flex justify-between"><span className="text-[#888]">Nguồn tuyển</span><span className="font-medium text-[#111]">{competitor.recruitment_source || '—'}</span></div>
                  <div>
                    <div className="text-[#888] mb-1 flex items-center gap-1"><User size={11} /> Nhân sự liên hệ</div>
                    {(() => {
                      const list = competitor.contacts?.length ? competitor.contacts : legacyContactsOf(competitor);
                      if (!list.length) return <span className="text-[11.5px] text-[#aaa]">Chưa có</span>;
                      return (
                        <div className="space-y-1">
                          {list.map((c, i) => (
                            <div key={i} className="flex items-center justify-between bg-[#F9F9F7] rounded-lg px-2.5 py-1.5">
                              <span className="text-[#111] font-medium">{c.name || '—'}</span>
                              {c.phone ? <a href={`tel:${c.phone}`} className="text-[#1D4ED8] font-medium hover:underline">{c.phone}</a> : <span className="text-[#aaa]">—</span>}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <div className="text-[#888] mb-1.5">Liên kết nhanh</div>
                    {(() => {
                      const activeLinks = linkTypes.map(t => ({ t, url: getLinkUrl(competitor, t) })).filter(x => x.url);
                      if (activeLinks.length === 0 && !competitor.social_other_url) return <span className="text-[11.5px] text-[#aaa]">Chưa có</span>;
                      return (
                        <div className="flex flex-wrap gap-1.5">
                          {activeLinks.map(({ t, url }) => {
                            const Icon = iconForLinkKey(t.key);
                            return (
                              <a key={t.id} href={url!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-[#F9F9F7] border border-[#E8E7E2] text-[#333] hover:bg-white hover:border-blue-300 transition">
                                <Icon size={11} /> {t.label} <ExternalLink size={9} className="text-[#999]" />
                              </a>
                            );
                          })}
                          {competitor.social_other_url && (
                            <a href={competitor.social_other_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-[#F9F9F7] border border-[#E8E7E2] text-[#333] hover:bg-white hover:border-blue-300 transition">Khác <ExternalLink size={9} className="text-[#999]" /></a>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <div className="text-[#888] mb-1">Điểm mạnh</div>
                    <div className="text-[#111] whitespace-pre-line bg-[#F9F9F7] rounded-lg px-2.5 py-1.5">{competitor.strengths || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[#888] mb-1">Điểm yếu</div>
                    <div className="text-[#111] whitespace-pre-line bg-[#F9F9F7] rounded-lg px-2.5 py-1.5">{competitor.weaknesses || '—'}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Nhật ký tình báo</div>
            <div className="p-4 space-y-3">
              <div className="space-y-2">
                <textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder="Ghi chú mới..." rows={2}
                  className="w-full text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8] resize-y leading-relaxed" />
                <div className="flex gap-2">
                  <input value={logSource} onChange={e => setLogSource(e.target.value)} placeholder="Nguồn tin..."
                    className="flex-1 text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                  <button onClick={handleAddLog} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">Ghi lại</button>
                </div>
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {logs.length === 0 && <div className="text-center text-[12px] text-[#aaa] py-4">Chưa có ghi chú nào</div>}
                {logs.map(l => (
                  <div key={l.id} className="flex gap-2.5">
                    <div className="mt-1.5 w-2 h-2 rounded-full bg-[#1D4ED8] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-[#111] whitespace-pre-line">{l.note}</div>
                      <div className="text-[10.5px] text-[#aaa] mt-0.5 flex items-center gap-1.5">
                        {l.source && <span className="px-1.5 py-0.5 rounded bg-[#F9F9F7] border border-[#E8E7E2]">{l.source}</span>}
                        <span>{l.created_at ? new Date(l.created_at).toLocaleDateString('vi-VN') : ''}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* CỘT PHẢI */}
        <div className="space-y-3">
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">KH đang phục vụ</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="border-b border-[#E8E7E2]">
                  {['Tên nhà máy', 'KCN', 'LĐ', 'Sale phụ trách', 'SĐT sale', 'Phí sale/tháng', 'Quan hệ'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {compClients.map(c => (
                    <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                      <td className="px-3 py-2 font-medium">{c.client_name}</td>
                      <td className="px-3 py-2 text-[#666]">{c.kcn || '—'}</td>
                      <td className="px-3 py-2">{(c.worker_count ?? 0).toLocaleString('vi-VN')}</td>
                      <td className="px-3 py-2 text-[#666]">{c.sale_name || '—'}</td>
                      <td className="px-3 py-2 text-[#666]">{c.sale_phone || '—'}</td>
                      <td className="px-3 py-2 text-blue-700 font-medium">{c.sale_fee ? formatCurrency(c.sale_fee) : '—'}</td>
                      <td className="px-3 py-2">
                        {isSharedClient(c.client_name)
                          ? <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[11px] font-medium">⚠ Chung LG</span>
                          : <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-medium">Tiềm năng</span>}
                      </td>
                    </tr>
                  ))}
                  {compClients.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-5 text-[#aaa]">Chưa có dữ liệu</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#E8E7E2] grid grid-cols-2 gap-2">
              <div className="col-span-2 flex flex-col gap-1">
                <SearchSelect value={clientForm.client_name} onChange={handlePickClientName}
                  options={companyNameOptions} placeholder="Chọn tên nhà máy (KH đang hợp tác / Dự án đang tìm hiểu)…"
                  allowAdd onAdd={handleCreateLeadFromName} />
                <span className="text-[10.5px] text-[#999]">Không thấy trong danh sách? Gõ tên mới → sẽ tự thêm vào "Công ty/Dự án đang tìm hiểu"</span>
              </div>
              <div className="flex flex-col gap-1">
                {kcnFromProfile ? (
                  <>
                    <input value={clientForm.kcn} readOnly
                      className="text-[12.5px] px-2.5 py-1.5 border rounded-lg outline-none bg-[#F5F4EF] border-[#E8E7E2] text-[#666]" />
                    <span className="text-[10px] text-emerald-600">✓ Tự động theo hồ sơ đã setup</span>
                  </>
                ) : (
                  <>
                    <SearchSelect value={clientForm.kcn} onChange={v => setClientForm(f => ({ ...f, kcn: v }))}
                      options={kcnPickOptions} placeholder="Chọn KCN…" allowAdd onAdd={() => {}} />
                    <span className="text-[10px] text-[#999]">Công ty chưa gán KCN — chọn sẽ tự lưu ngược lại hồ sơ</span>
                  </>
                )}
              </div>
              <input type="number" min={0} value={clientForm.worker_count} onChange={e => setClientForm(f => ({ ...f, worker_count: e.target.value }))} placeholder="Số LĐ"
                className="text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <input value={clientForm.sale_name} onChange={e => setClientForm(f => ({ ...f, sale_name: e.target.value }))} placeholder="Tên sale phụ trách"
                className="text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <input value={clientForm.sale_phone} onChange={e => setClientForm(f => ({ ...f, sale_phone: e.target.value }))} placeholder="SĐT sale"
                className="text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <input type="number" min={0} value={clientForm.sale_fee} onChange={e => setClientForm(f => ({ ...f, sale_fee: e.target.value }))} placeholder="Phí sale/tháng (₫)"
                className="col-span-2 text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <button onClick={handleAddClient} className="col-span-2 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition whitespace-nowrap">
                <Plus size={12} /> Thêm
              </button>
            </div>
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Bảng phí dịch vụ</div>
            <div>
              {feeRow('Phí PT', competitor.fee_unskilled)}
              {feeRow('Phí TN', competitor.fee_skilled, 'text-blue-700')}
              {feeRow('Phí KTV', competitor.fee_tech, 'text-emerald-700')}
              {feeRow('Lương trả LĐ', competitor.wage_paid)}
              {feeRow('Phí/công', competitor.fee_per_shift)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

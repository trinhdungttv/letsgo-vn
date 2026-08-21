import { useState, useEffect, useMemo } from 'react';
import { Radar, Settings, Phone, MapPin, Pencil, X, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { CONTACT_TYPES } from '../../lib/constants';
import { getOrCreatePipelineEntryForClient } from '../../lib/pipelineHelpers';
import { CompanyProfileModal } from './CompanyProfileModal';
import type { Client, CSKHLog, CRMPipelineEntry, CRMProduct, Contact } from '../../lib/types';
import { useBranchLookup } from '../../hooks/useBranchLookup';

type Tier = 'a' | 'b';
type Status = 'red' | 'yellow' | 'green';
type TabKey = 'all' | 'cold' | 'ok';

interface RadarItem {
  client: Client;
  type: Tier;
  tierLabel: string;
  days: number;
  lastLabel: string;
}

const THRESHOLD_KEY = 'lgvn_radar_thresholds';
const DEFAULT_THRESHOLDS: Record<Tier, number> = { a: 7, b: 14 };
const TIER_LABELS: Record<Tier, string> = { a: 'KH chiến lược', b: 'KH thường' };

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'cold', label: 'Lâu không liên hệ' },
  { key: 'ok', label: 'Đang ổn' },
];

function loadThresholds(): Record<Tier, number> {
  try {
    const raw = localStorage.getItem(THRESHOLD_KEY);
    if (raw) return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_THRESHOLDS;
}

function getStatus(it: RadarItem, thresholds: Record<Tier, number>): Status {
  const th = thresholds[it.type];
  if (it.days >= th) return 'red';
  if (it.days >= Math.round(th * 0.6)) return 'yellow';
  return 'green';
}

function getHeatPct(it: RadarItem, thresholds: Record<Tier, number>): number {
  const th = thresholds[it.type];
  return Math.min(100, Math.round((it.days / th) * 100));
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const STATUS_BADGE: Record<Status, string> = {
  red: 'bg-red-50 text-red-700',
  yellow: 'bg-amber-50 text-amber-800',
  green: 'bg-green-50 text-green-700',
};
const STATUS_AVATAR: Record<Status, string> = {
  red: 'bg-red-50 text-red-700',
  yellow: 'bg-amber-50 text-amber-800',
  green: 'bg-green-50 text-green-700',
};
const STATUS_BORDER: Record<Status, string> = {
  red: 'border-l-red-500',
  yellow: 'border-l-amber-500',
  green: 'border-l-green-500',
};
const STATUS_CHIP: Record<Status, string> = {
  red: 'bg-red-50 text-red-700',
  yellow: 'bg-amber-50 text-amber-800',
  green: 'bg-green-50 text-green-700',
};
const STATUS_FILL: Record<Status, string> = {
  red: 'bg-red-500',
  yellow: 'bg-amber-500',
  green: 'bg-green-500',
};

interface Props {
  clients: Client[];
  contacts: Contact[];
  products: CRMProduct[];
  toast: (m: string) => void;
}

export function RelationshipRadar({ clients, contacts, products, toast }: Props) {
  const { labelOf } = useBranchLookup();
  const { user } = useAuth();
  const [logs, setLogs] = useState<CSKHLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('all');
  const [showCfg, setShowCfg] = useState(false);
  const [thresholds, setThresholds] = useState<Record<Tier, number>>(loadThresholds);
  const [logModal, setLogModal] = useState<RadarItem | null>(null);
  const [logForm, setLogForm] = useState({ contact_type: 'call', content: '', followup: '' });
  const [saving, setSaving] = useState(false);
  const [profileEntry, setProfileEntry] = useState<CRMPipelineEntry | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: lg } = await supabase.from('cskh_logs').select('*').order('log_date', { ascending: false });
    if (lg) setLogs(lg as CSKHLog[]);
    setLoading(false);
  }

  function updateThreshold(tier: Tier, val: number) {
    const next = { ...thresholds, [tier]: val };
    setThresholds(next);
    localStorage.setItem(THRESHOLD_KEY, JSON.stringify(next));
  }

  const items: RadarItem[] = useMemo(() => {
    const todayMs = Date.now();
    return clients.map(c => {
      const clientLogs = logs.filter(l =>
        (l.client_id && l.client_id === c.id) ||
        (!l.client_id && l.client_name && l.client_name.toLowerCase() === c.name.toLowerCase())
      );
      const lastLog = clientLogs[0];
      let days = 999;
      let lastLabel = 'Chưa có ghi nhận';
      if (lastLog) {
        const diff = Math.floor((todayMs - new Date(lastLog.log_date).getTime()) / 86400000);
        days = Math.max(0, diff);
        const ct = CONTACT_TYPES[lastLog.contact_type]?.label || lastLog.contact_type;
        const dateLabel = new Date(lastLog.log_date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        lastLabel = `${dateLabel} — ${ct}`;
      }
      const type: Tier = (c.current_workers ?? c.min_workers ?? 0) >= 100 ? 'a' : 'b';
      return { client: c, type, tierLabel: TIER_LABELS[type], days, lastLabel };
    });
  }, [clients, logs]);

  const counts = useMemo(() => {
    const red = items.filter(it => getStatus(it, thresholds) === 'red').length;
    const cold = items.filter(it => getStatus(it, thresholds) !== 'green').length;
    const ok = items.filter(it => getStatus(it, thresholds) === 'green').length;
    return { red, cold, ok };
  }, [items, thresholds]);

  const filtered = useMemo(() => {
    let list = items;
    if (tab === 'cold') list = items.filter(it => getStatus(it, thresholds) !== 'green');
    else if (tab === 'ok') list = items.filter(it => getStatus(it, thresholds) === 'green');
    const order: Record<Status, number> = { red: 0, yellow: 1, green: 2 };
    return [...list].sort((a, b) =>
      order[getStatus(a, thresholds)] - order[getStatus(b, thresholds)] || b.days - a.days
    );
  }, [items, tab, thresholds]);

  async function openProfile(it: RadarItem) {
    setLoadingProfile(it.client.id);
    const entry = await getOrCreatePipelineEntryForClient(it.client);
    setLoadingProfile(null);
    if (!entry) { toast('Lỗi: không thể mở hồ sơ công ty'); return; }
    setProfileEntry(entry);
  }

  function openLogModal(it: RadarItem) {
    setLogModal(it);
    setLogForm({ contact_type: 'call', content: '', followup: '' });
  }

  async function saveLog() {
    if (!logModal) return;
    if (!logForm.content.trim()) { toast('Nhập nội dung'); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: logModal.client.id,
        client_name: logModal.client.name,
        contact_type: logForm.contact_type,
        content: logForm.content.trim(),
        followup: logForm.followup.trim() || null,
        followup_done: false,
        log_date: new Date().toISOString().split('T')[0],
      };
      const { data, error } = await supabase.from('cskh_logs').insert(payload).select().single();
      if (error) throw error;
      setLogs(prev => [data as CSKHLog, ...prev]);
      await logActivity({
        user, action: 'insert', table: 'cskh_logs', recordId: data.id,
        description: `Ghi nhận chăm sóc "${logModal.client.name}"`,
        newData: data,
      });
      toast('Đã ghi nhận chăm sóc');
      setLogModal(null);
    } catch (e: any) { toast('Lỗi: ' + e.message); } finally { setSaving(false); }
  }

  if (loading) {
    return <div className="text-[11px] text-[#999] p-4 text-center">Đang tải...</div>;
  }

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#E8E7E2]">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#333]">
          <Radar size={14} className="text-[#888]" />
          Relationship Radar — Chăm sóc &amp; Follow-up
        </div>
        <button
          onClick={() => setShowCfg(v => !v)}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
        >
          <Settings size={11} /> Cấu hình ngưỡng
        </button>
      </div>

      {/* Config panel */}
      {showCfg && (
        <div className="px-3.5 py-3 bg-[#fafafa] border-b border-[#E8E7E2] flex flex-col gap-2">
          <div className="text-[11px] font-medium text-[#333] mb-1">Ngưỡng cảnh báo theo loại khách hàng</div>
          {([
            { key: 'a' as Tier, label: 'Khách hàng chiến lược (A)', dot: 'bg-red-500', min: 3, max: 21 },
            { key: 'b' as Tier, label: 'Khách hàng thường (B)', dot: 'bg-amber-500', min: 7, max: 30 },
          ]).map(row => (
            <div key={row.key} className="flex items-center gap-2.5">
              <span className="text-[11px] text-[#666] w-[170px] shrink-0 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${row.dot}`} />
                {row.label}
              </span>
              <input
                type="range" min={row.min} max={row.max} step={1}
                value={thresholds[row.key]}
                onChange={e => updateThreshold(row.key, parseInt(e.target.value, 10))}
                className="flex-1"
              />
              <span className="text-[11px] font-medium text-[#333] min-w-[42px] text-right">{thresholds[row.key]} ngày</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="px-3.5 pt-2.5 flex">
        <div className="flex gap-0.5 bg-[#F4F3EF] border border-[#E8E7E2] rounded-lg p-0.5">
          {TABS.map(t => {
            const count = t.key === 'all' ? counts.red : t.key === 'cold' ? counts.cold : counts.ok;
            const badgeColor = t.key === 'all' ? 'bg-red-50 text-red-700' : t.key === 'cold' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700';
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={[
                  'px-3 py-1 rounded-md text-[11px] transition-all whitespace-nowrap',
                  tab === t.key ? 'bg-white text-[#333] font-medium border border-[#E0DFDA]' : 'text-[#888] hover:text-[#555]',
                ].join(' ')}
              >
                {t.label}
                {count > 0 && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeColor}`}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3.5 py-2 flex-wrap">
        {[
          { color: 'bg-red-500', label: 'Cần liên hệ ngay' },
          { color: 'bg-amber-500', label: 'Sắp đến ngưỡng' },
          { color: 'bg-green-500', label: 'Đang chăm sóc tốt' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${l.color}`} />
            <span className="text-[10px] text-[#999]">{l.label}</span>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="px-3.5 pb-3.5 max-h-[480px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-[#bbb]">
            <CheckCircle2 size={22} className="mx-auto mb-1.5" />
            <div className="text-[11px]">Không có mục nào trong nhóm này</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {filtered.map(it => {
              const st = getStatus(it, thresholds);
              const pct = getHeatPct(it, thresholds);
              const avatarCls = STATUS_AVATAR[st];
              const tierBadgeCls = STATUS_BADGE[st];

              return (
                <div
                  key={it.client.id}
                  onClick={() => openProfile(it)}
                  className={`flex flex-col gap-1 px-2 py-1.5 rounded-lg border border-[#E8E7E2] bg-[#fafafa] border-l-[3px] ${STATUS_BORDER[st]} hover:border-[#d8d6cf] hover:shadow-sm transition-colors cursor-pointer ${loadingProfile === it.client.id ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0 ${avatarCls}`}>
                      {initials(it.client.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] font-medium text-[#333] truncate leading-tight">{it.client.name}</div>
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded-full font-medium ${tierBadgeCls}`}>{it.tierLabel}</span>
                    </div>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_CHIP[st]}`}>{it.days >= 999 ? 'Chưa từng' : `${it.days}d`}</span>
                  </div>
                  <div className="text-[9.5px] text-[#999] truncate">
                    {it.lastLabel} · {labelOf(it.client)} · {it.client.crm_owner || it.client.manager || '—'}
                  </div>
                  <div className="h-1 rounded bg-[#eee] overflow-hidden">
                    <div className={`h-full rounded ${STATUS_FILL[st]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    {it.client.phone ? (
                      <a href={`tel:${it.client.phone}`} onClick={e => e.stopPropagation()} className="p-1 rounded-md border border-[#E8E7E2] bg-white text-[#888] hover:text-blue-600 hover:border-blue-200 transition-colors" title={it.client.phone}>
                        <Phone size={10} />
                      </a>
                    ) : (
                      <span className="p-1 rounded-md border border-[#E8E7E2] bg-white text-[#ddd]"><Phone size={10} /></span>
                    )}
                    <span className="p-1 rounded-md border border-[#E8E7E2] bg-white text-[#888]" title={labelOf(it.client)}>
                      <MapPin size={10} />
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); openLogModal(it); }}
                      className="p-1 rounded-md border border-[#E8E7E2] bg-white text-[#888] hover:text-blue-600 hover:border-blue-200 transition-colors"
                      title="Ghi nhận chăm sóc"
                    >
                      <Pencil size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick log modal */}
      {logModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[10px] border border-[#E8E7E2] w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold text-[#111]">Ghi nhận chăm sóc — {logModal.client.name}</h3>
              <button onClick={() => setLogModal(null)} className="text-[#999] hover:text-[#333]"><X size={16} /></button>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#666] font-medium">Hình thức</label>
                <select
                  value={logForm.contact_type}
                  onChange={e => setLogForm({ ...logForm, contact_type: e.target.value })}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                >
                  {Object.entries(CONTACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#666] font-medium">Nội dung *</label>
                <textarea
                  value={logForm.content}
                  onChange={e => setLogForm({ ...logForm, content: e.target.value })}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 min-h-[64px] resize-y"
                  placeholder="Gặp ai, nói gì, kết quả..."
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#666] font-medium">Follow-up tiếp theo</label>
                <input
                  value={logForm.followup}
                  onChange={e => setLogForm({ ...logForm, followup: e.target.value })}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                  placeholder="Việc cần làm tiếp theo (không bắt buộc)"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setLogModal(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={saveLog} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:bg-gray-400">{saving ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Company profile panel */}
      {profileEntry && (
        <CompanyProfileModal
          entry={profileEntry}
          contacts={contacts}
          products={products}
          onClose={() => setProfileEntry(null)}
          onUpdate={setProfileEntry}
          toast={toast}
          isAdmin={user?.role === 'admin'}
        />
      )}
    </div>
  );
}

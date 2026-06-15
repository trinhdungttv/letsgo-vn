import { useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Save, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/format';
import type { Competitor, CompetitorClient, CompetitorLog } from '../../lib/types';

interface Props {
  competitor: Competitor;
  onBack: () => void;
  toast: (msg: string) => void;
}

interface LgClient { id: string; name: string; industrial_zones: string[] }

export default function CompetitorDetail({ competitor, onBack, toast }: Props) {
  const [lgClients, setLgClients] = useState<LgClient[]>([]);
  const [compClients, setCompClients] = useState<CompetitorClient[]>([]);
  const [logs, setLogs] = useState<CompetitorLog[]>([]);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_name: competitor.company_name,
    zone_name: competitor.zone_name,
    total_workers: competitor.total_workers ?? 0,
    recruitment_source: competitor.recruitment_source ?? '',
    strengths: competitor.strengths ?? '',
    weaknesses: competitor.weaknesses ?? '',
  });

  const [logNote, setLogNote] = useState('');
  const [logSource, setLogSource] = useState('');
  const [clientForm, setClientForm] = useState({ client_name: '', kcn: '', worker_count: '' });

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
    const { error } = await supabase.from('competitors').update({
      company_name: form.company_name.trim(),
      zone_name: form.zone_name.trim(),
      total_workers: form.total_workers,
      recruitment_source: form.recruitment_source.trim() || null,
      strengths: form.strengths.trim() || null,
      weaknesses: form.weaknesses.trim() || null,
    }).eq('id', competitor.id);
    setSaving(false);
    if (error) { toast('Lỗi: ' + error.message); return; }
    Object.assign(competitor, {
      company_name: form.company_name.trim(),
      zone_name: form.zone_name.trim(),
      total_workers: form.total_workers,
      recruitment_source: form.recruitment_source.trim(),
      strengths: form.strengths.trim(),
      weaknesses: form.weaknesses.trim(),
    });
    setEditing(false);
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
    if (!clientForm.client_name.trim()) return;
    const { error } = await supabase.from('competitor_clients').insert({
      competitor_id: competitor.id,
      client_name: clientForm.client_name.trim(),
      kcn: clientForm.kcn.trim() || null,
      worker_count: clientForm.worker_count ? parseInt(clientForm.worker_count, 10) : 0,
    });
    if (error) { toast('Lỗi: ' + error.message); return; }
    setClientForm({ client_name: '', kcn: '', worker_count: '' });
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
        <div className="text-[15px] font-semibold text-[#111]">{competitor.company_name}</div>
        <span className="px-2 py-0.5 rounded-full bg-[#F9F9F7] border border-[#E8E7E2] text-[11px] text-[#666]">{competitor.zone_name}</span>
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
                      <label className="text-[11px] text-[#888]">Khu vực</label>
                      <input value={form.zone_name} onChange={e => setForm(f => ({ ...f, zone_name: e.target.value }))} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Tổng LĐ ước tính</label>
                      <input type="number" min={0} value={form.total_workers} onChange={e => setForm(f => ({ ...f, total_workers: +e.target.value }))} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[#888]">Nguồn tuyển</label>
                      <input value={form.recruitment_source} onChange={e => setForm(f => ({ ...f, recruitment_source: e.target.value }))} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-[#888]">Điểm mạnh</label>
                    <textarea value={form.strengths} onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))} rows={2} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8] resize-none" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-[#888]">Điểm yếu</label>
                    <textarea value={form.weaknesses} onChange={e => setForm(f => ({ ...f, weaknesses: e.target.value }))} rows={2} className="text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8] resize-none" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-[12.5px]">
                  <div className="flex justify-between"><span className="text-[#888]">Tên</span><span className="font-medium text-[#111]">{competitor.company_name}</span></div>
                  <div className="flex justify-between"><span className="text-[#888]">Khu vực</span><span className="font-medium text-[#111]">{competitor.zone_name}</span></div>
                  <div className="flex justify-between"><span className="text-[#888]">Tổng LĐ ước tính</span><span className="font-medium text-[#111]">{(competitor.total_workers ?? 0).toLocaleString('vi-VN')}</span></div>
                  <div className="flex justify-between"><span className="text-[#888]">Nguồn tuyển</span><span className="font-medium text-[#111]">{competitor.recruitment_source || '—'}</span></div>
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
                  className="w-full text-[13px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8] resize-none" />
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
                  {['Tên nhà máy', 'KCN', 'LĐ', 'Quan hệ'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {compClients.map(c => (
                    <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                      <td className="px-3 py-2 font-medium">{c.client_name}</td>
                      <td className="px-3 py-2 text-[#666]">{c.kcn || '—'}</td>
                      <td className="px-3 py-2">{(c.worker_count ?? 0).toLocaleString('vi-VN')}</td>
                      <td className="px-3 py-2">
                        {isSharedClient(c.client_name)
                          ? <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[11px] font-medium">⚠ Chung LG</span>
                          : <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-medium">Tiềm năng</span>}
                      </td>
                    </tr>
                  ))}
                  {compClients.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-5 text-[#aaa]">Chưa có dữ liệu</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#E8E7E2] grid grid-cols-[2fr_1fr_1fr_auto] gap-2">
              <input value={clientForm.client_name} onChange={e => setClientForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Tên nhà máy"
                className="text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <input value={clientForm.kcn} onChange={e => setClientForm(f => ({ ...f, kcn: e.target.value }))} placeholder="KCN"
                className="text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <input type="number" min={0} value={clientForm.worker_count} onChange={e => setClientForm(f => ({ ...f, worker_count: e.target.value }))} placeholder="Số LĐ"
                className="text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <button onClick={handleAddClient} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition whitespace-nowrap">
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

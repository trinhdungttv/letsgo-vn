import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { CSKHLog } from '../lib/types';
import { formatDate } from '../lib/format';
import { CONTACT_TYPES } from '../lib/constants';
import { supabase } from '../lib/supabase';

interface CSKHProps {
  logs: CSKHLog[];
  onRefresh: () => Promise<void>;
  toast: (msg: string) => void;
}

export default function CSKH({ logs, onRefresh, toast }: CSKHProps) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ client_name: '', contact_person: '', contact_type: 'call', content: '', followup: '' });
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!form.client_name || !form.content) { toast('Nhập tên công ty và nội dung'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('cskh_logs').insert({ ...form, log_date: new Date().toISOString().split('T')[0] });
      if (error) throw error;
      await onRefresh();
      setForm({ client_name: '', contact_person: '', contact_type: 'call', content: '', followup: '' });
      setShowModal(false);
      toast('Đã thêm log CSKH!');
    } catch (e: any) { toast('Lỗi: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title="CSKH" subtitle="Chăm sóc khách hàng" actions={
        <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Plus size={13} /> Thêm log</button>
      } />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E8E7E2]">
                {['Ngày', 'Công ty', 'Liên hệ', 'Hình thức', 'Nội dung', 'Follow-up'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[#aaa]">Chưa có log CSKH</td></tr>
                ) : logs.map(l => {
                  const ct = CONTACT_TYPES[l.contact_type] || { label: l.contact_type, color: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={l.id} className="border-b border-[#F0EEE9] last:border-0">
                      <td className="px-3 py-2 text-[12px] whitespace-nowrap">{formatDate(l.log_date)}</td>
                      <td className="px-3 py-2 font-semibold">{l.client_name || '—'}</td>
                      <td className="px-3 py-2 text-[12px] text-[#555]">{l.contact_person || '—'}</td>
                      <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium ${ct.color}`}>{ct.label}</span></td>
                      <td className="px-3 py-2">{l.content || '—'}</td>
                      <td className="px-3 py-2 text-[12px]">{l.followup ? <span style={{ color: l.followup_done ? '#059669' : '#D97706' }}>{l.followup}</span> : <span className="text-[#ccc]">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-[10px] border border-[#E8E7E2] w-full max-w-lg p-6">
            <h2 className="text-[15px] font-semibold text-[#111] mb-4">Thêm log CSKH</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên công ty *</label><input value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="Công ty ABC" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Người liên hệ</label><input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              </div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Hình thức</label><select value={form.contact_type} onChange={e => setForm({ ...form, contact_type: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">{Object.entries(CONTACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nội dung *</label><textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 min-h-[60px] resize-y" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Follow-up</label><input value={form.followup} onChange={e => setForm({ ...form, followup: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={handleAdd} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:bg-gray-400">{saving ? 'Đang lưu...' : 'Thêm log'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

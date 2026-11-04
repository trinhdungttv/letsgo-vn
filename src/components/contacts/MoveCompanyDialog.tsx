// ============================================================================
// "Chuyển công ty" — khách nghỉ công ty 1 sang làm công ty 2 (04/11/2026).
// Dùng chung ở hồ sơ CSKH, form đầy đủ và khối Người liên hệ của công ty. Chọn công ty mới có
// sẵn hoặc gõ tên để tạo mới (dò trùng như mọi form thêm công ty; tạo dạng KH tiềm năng), ngày
// chuyển, chức vụ mới. Ghi qua contactOps.moveContactCompany: công ty cũ đóng lại nhưng GIỮ lịch
// sử; người này giữ nguyên hạng CSKH, nhật ký, quà, ngày quan trọng.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Building2, Plus, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import type { Contact } from '../../lib/types';
import { todayVN } from '../../lib/cskh/dates';
import {
  createProspectCompany, fetchCareerHistory, linksOf, moveContactCompany,
} from '../../lib/contactOps';
import { buildCareer, companyNameMatches, moveCompanyError, periodLabel } from '../../lib/contactCareer';
import { invalidateCompanyIndex, useCompanyDuplicates } from '../../hooks/useCompanyDuplicates';
import DuplicateCompanyNotice from '../common/DuplicateCompanyNotice';
import RoleSelect from './RoleSelect';

interface ClientLite { id: string; name: string; client_type?: string | null; archived_at?: string | null }

const FIELD = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const LABEL = 'block text-xs font-semibold text-gray-700 mb-1';

export default function MoveCompanyDialog({ contact, defaultFromClientId, hint, onClose, onDone, toast }: {
  contact: Contact;
  /** Mở từ hồ sơ công ty: công ty đang rời là công ty đó. */
  defaultFromClientId?: string;
  /** Dòng nhắc thêm ở phần tóm tắt (VD: thay đổi chưa lưu ở form đang mở sẽ bỏ qua). */
  hint?: string;
  onClose: () => void;
  onDone: (c: Contact) => void;
  toast: (m: string) => void;
}) {
  const { user } = useAuth();
  const today = todayVN();
  const links = useMemo(() => linksOf(contact), [contact]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [fromId, setFromId] = useState<string>(
    defaultFromClientId && links.some(l => l.client_id === defaultFromClientId) ? defaultFromClientId : links[0]?.client_id ?? '',
  );
  const [query, setQuery] = useState('');
  const [toId, setToId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [role, setRole] = useState(contact.role || '');
  const [makePrimary, setMakePrimary] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fromStartedOn, setFromStartedOn] = useState<string | null>(null);

  // Mọi công ty (cả KH tiềm năng) — người liên hệ có thể chuyển sang công ty chưa hợp tác
  useEffect(() => {
    supabase.from('clients').select('id, name, client_type, archived_at').order('name')
      .then(({ data }) => setClients(((data || []) as ClientLite[]).filter(c => !c.archived_at)));
  }, []);

  // Làm ở công ty cũ từ ngày — tính từ quá trình công tác để chốt vào lịch sử
  useEffect(() => {
    let alive = true;
    void fetchCareerHistory(contact.id).then(history => {
      if (!alive) return;
      const career = buildCareer({
        role: contact.role, startDate: contact.start_date, history,
        links: links.map(l => ({ clientId: l.client_id, clientName: l.clients?.name || '', createdAt: l.created_at })),
      });
      setFromStartedOn(career.find(p => p.current && p.clientId === fromId)?.from ?? null);
    });
    return () => { alive = false; };
  }, [contact, links, fromId]);

  const nameOf = (id: string | null) => (id ? clients.find(c => c.id === id)?.name ?? links.find(l => l.client_id === id)?.clients?.name ?? null : null);
  const matches = useMemo(() => {
    const taken = new Set(links.map(l => l.client_id));
    return clients.filter(c => !taken.has(c.id) && companyNameMatches(c.name, query)).slice(0, 8);
  }, [clients, query, links]);
  const dup = useCompanyDuplicates(query, { enabled: creating });
  const picked = toId ? clients.find(c => c.id === toId) ?? null : null;
  const fromName = nameOf(fromId || null);
  const toName = picked?.name ?? (creating ? query.trim() : '');

  const submit = async () => {
    const err = moveCompanyError({ fromClientId: fromId || null, toClientId: toId, newCompanyName: creating ? query : '', effectiveOn }, today);
    if (err) { setError(err); return; }
    if (creating && dup.blocked) { setError('Tên công ty này có vẻ đã có — chọn công ty có sẵn, hoặc tích "Đây là công ty khác"'); return; }
    setSaving(true);
    setError('');
    try {
      let targetId = toId;
      const names = new Map(clients.map(c => [c.id, c.name]));
      for (const l of links) if (l.clients?.name) names.set(l.client_id, l.clients.name);
      if (!targetId) {
        const created = await createProspectCompany(query, user);
        invalidateCompanyIndex();
        targetId = created.id;
        names.set(created.id, created.name);
      }
      const saved = await moveContactCompany(contact, {
        fromClientId: fromId || null,
        toClientId: targetId,
        effectiveOn,
        newRole: role,
        makePrimary,
        fromStartedOn,
        note,
      }, { user, clientName: id => (id ? names.get(id) ?? null : null) });
      toast(fromName ? `Đã chuyển "${contact.name}" sang ${names.get(targetId)}` : `Đã gắn "${contact.name}" vào ${names.get(targetId)}`);
      onDone(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90] p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Chuyển công ty"
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Chuyển công ty</h2>
            <p className="text-[12px] text-gray-500 truncate">{contact.name}{contact.role ? ` · ${contact.role}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md" aria-label="Đóng"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Rời công ty */}
          <div>
            <label className={LABEL}>Rời công ty</label>
            {links.length === 0 ? (
              <p className="text-[13px] text-gray-500 italic">Chưa gắn công ty nào — chỉ gắn công ty mới.</p>
            ) : links.length === 1 ? (
              <div className="flex items-center gap-2 text-[13px] text-gray-800">
                <Building2 className="w-4 h-4 text-gray-400" /> <b>{links[0].clients?.name || 'Công ty'}</b>
                {fromStartedOn && <span className="text-gray-500">· {periodLabel({ from: fromStartedOn, to: null, current: true })}</span>}
              </div>
            ) : (
              <>
                <select value={fromId} onChange={e => setFromId(e.target.value)} className={FIELD}>
                  {links.map(l => <option key={l.client_id} value={l.client_id}>{l.clients?.name || 'Công ty'}</option>)}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">Người này kiêm {links.length} công ty — chỉ rời công ty đã chọn, các công ty khác giữ nguyên.</p>
              </>
            )}
          </div>

          {/* Sang công ty */}
          <div>
            <label className={LABEL}>Sang công ty <span className="text-red-500">*</span></label>
            {picked ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-blue-300 bg-blue-50 rounded-lg">
                <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="flex-1 text-[13px] font-medium text-blue-900 truncate">{picked.name}</span>
                {picked.client_type === 'prospect' && <span className="text-[10.5px] text-blue-700 bg-blue-100 rounded-full px-1.5">KH tiềm năng</span>}
                <button type="button" onClick={() => { setToId(null); setQuery(''); }} className="text-[12px] text-blue-700 hover:underline">Đổi</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input autoFocus value={query} onChange={e => { setQuery(e.target.value); setCreating(false); }}
                    placeholder="Gõ tên công ty mới…" className={`${FIELD} pl-9`} />
                </div>
                {!creating && (
                  <ul className="mt-1.5 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                    {matches.map(c => (
                      <li key={c.id}>
                        <button type="button" onClick={() => { setToId(c.id); setCreating(false); setError(''); }}
                          className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="flex-1 truncate">{c.name}</span>
                          {c.client_type === 'prospect' && <span className="text-[10.5px] text-gray-500">KH tiềm năng</span>}
                        </button>
                      </li>
                    ))}
                    {query.trim() && (
                      <li>
                        <button type="button" onClick={() => { setCreating(true); setError(''); }}
                          className="w-full text-left px-3 py-2 text-[13px] text-blue-700 hover:bg-blue-50 flex items-center gap-2 font-medium">
                          <Plus className="w-3.5 h-3.5 shrink-0" /> Tạo công ty mới “{query.trim()}”
                        </button>
                      </li>
                    )}
                    {!query.trim() && matches.length === 0 && <li className="px-3 py-2 text-[12px] text-gray-400">Đang tải danh sách công ty…</li>}
                  </ul>
                )}
                {creating && (
                  <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 text-[12px] text-blue-900">
                    Sẽ tạo công ty mới <b>“{query.trim()}”</b> dạng <b>KH tiềm năng</b> (không vào danh sách khách đang hợp tác).{' '}
                    <button type="button" onClick={() => setCreating(false)} className="underline">Chọn công ty có sẵn</button>
                    <DuplicateCompanyNotice dup={dup} onUseName={n => { setQuery(n); setCreating(false); }} />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Ngày chuyển</label>
              <input type="date" value={effectiveOn} max={today} onChange={e => setEffectiveOn(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Chức vụ ở công ty mới</label>
              <RoleSelect value={role} onChange={setRole} toast={toast} className={FIELD} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={makePrimary} onChange={e => setMakePrimary(e.target.checked)} className="w-4 h-4 accent-amber-500" />
            Liên hệ chính của công ty mới
          </label>
          <div>
            <label className={LABEL}>Ghi chú (không bắt buộc)</label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="VD: Lên làm trưởng phòng, lương cao hơn" className={FIELD} />
          </div>

          {/* Tóm tắt những gì sẽ xảy ra */}
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-[12px] text-gray-700 space-y-1">
            {(fromName || toName) && (
              <div className="flex items-center gap-1.5 flex-wrap font-medium text-gray-900">
                {fromName && <>{fromName} <ArrowRight className="w-3.5 h-3.5 text-gray-400" /></>}
                {toName || '…'}
              </div>
            )}
            {fromName && <p>• {fromName} được đóng lại nhưng <b>giữ lịch sử</b>: làm từ khi nào tới khi nào, chức vụ cũ{contact.role ? ` (${contact.role})` : ''}. Hồ sơ {fromName} sẽ ghi “đã chuyển sang {toName || 'công ty mới'}”.</p>}
            <p>• Giữ nguyên hạng CSKH, nhật ký, quà tặng, ngày quan trọng của người này.</p>
            {!contact.is_active && <p className="text-amber-700">• Người này đang “Đã nghỉ” — chuyển xong sẽ thành Đang phụ trách.</p>}
            {hint && <p className="text-amber-700">• {hint}</p>}
          </div>

          {error && <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex gap-2 justify-end sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Huỷ</button>
          <button onClick={() => void submit()} disabled={saving || (!toId && !creating)}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? 'Đang chuyển…' : 'Chuyển công ty'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Tab "Sơ đồ tổ chức" trong hồ sơ Khách hàng: ghi các cấp nhân sự bên khách mà mình hay làm việc cùng.
// Dùng lại nguyên trình vẽ Sơ đồ tư duy của Ghi chú nhanh (MindMapEditor, tải riêng khi mở tab) — mặc định kiểu Tổ chức
// (tên công ty trên cùng, các cấp xổ xuống), nhánh nhiều màu. Tự lưu sau mỗi lần sửa (bảng client_org_charts, migration 199).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import type { Client, Contact } from '../../lib/types';
import type { NotePalette } from '../../lib/quickNotes/colors';
import type { MindMapDoc, MindTopic } from '../../lib/quickNotes/mindmap/types';
import { addChild } from '../../lib/quickNotes/mindmap/model';
import { CLIENT_MAPS_MIGRATION_HINT, defaultOrgChart, isMissingTableError, loadOrgChart, saveOrgChart } from '../../lib/clientMaps/orgChart';
import { useAuth } from '../../lib/auth';
import { useIsMobile } from '../../hooks/useIsMobile';

const MindMapEditor = lazy(() => import('../quickNotes/mindmap/MindMapEditor'));

/** Nền trắng (Ghi chú nhanh dùng màu giấy của từng ghi chú). */
const ORG_PALETTE: NotePalette = {
  label: 'Trắng', dot: '#8E8E93', tab: '#D0D0D5', paper: '#FFFFFF', header: '#F5F5F7', strip: '#E5E5EA', ink: '#1D1D1F',
};
const SAVE_DELAY_MS = 1200;

type SaveState = { s: 'idle' } | { s: 'saving' } | { s: 'saved'; at: string } | { s: 'error'; msg: string };

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('vi-VN', today ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};

const contactText = (c: Contact) => (c.role?.trim() ? `${c.name.trim()} – ${c.role.trim()}` : c.name.trim());

function allTexts(doc: MindMapDoc): string {
  const out: string[] = [];
  const walk = (t: MindTopic) => { out.push(t.text); t.children.forEach(walk); };
  walk(doc.root);
  doc.floating.forEach(walk);
  return out.join('\n').toLocaleLowerCase('vi');
}

export default function ClientOrgChart({ client, contacts }: { client: Client; contacts: Contact[] }) {
  const { user } = useAuth();
  const mobile = useIsMobile();
  const userName = user?.full_name || user?.username || '';
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [doc, setDoc] = useState<MindMapDoc | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [save, setSave] = useState<SaveState>({ s: 'idle' });
  const [lastBy, setLastBy] = useState('');
  const [pickOpen, setPickOpen] = useState(false);

  const pending = useRef<MindMapDoc | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientId = client.id;

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const row = await loadOrgChart(clientId);
      setDoc(row.doc ?? defaultOrgChart(client.name));
      setIsNew(!row.doc);
      setLastBy(row.updatedBy);
      setSave(row.updatedAt ? { s: 'saved', at: row.updatedAt } : { s: 'idle' });
      setPhase('ready');
    } catch (e) {
      if (isMissingTableError(e as { code?: string; message?: string })) {
        setDoc(defaultOrgChart(client.name));
        setPhase('missing');
      } else {
        setLoadError((e as Error).message ?? String(e));
        setPhase('error');
      }
    }
    // tên công ty chỉ dùng cho sơ đồ mới lần đầu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (busy.current) return;
    const d = pending.current;
    if (!d) return;
    busy.current = true;
    pending.current = null;
    setSave({ s: 'saving' });
    try {
      const at = await saveOrgChart(clientId, d, userName);
      setSave({ s: 'saved', at });
      setLastBy(userName);
      setIsNew(false);
    } catch (e) {
      if (!pending.current) pending.current = d;
      const err = e as { code?: string; message?: string };
      if (isMissingTableError(err)) setPhase('missing');
      setSave({ s: 'error', msg: err.message ?? 'lỗi không rõ' });
    } finally {
      busy.current = false;
    }
    if (pending.current && !busy.current) {
      timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
    }
  }, [clientId, userName]);

  // Rời tab / đóng hồ sơ / ẩn trang: gửi nốt phần đang chờ lưu
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => { void flushRef.current(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flushRef.current();
    };
  }, []);

  const change = useCallback((next: MindMapDoc) => {
    setDoc(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [flush]);

  const used = useMemo(() => (doc ? allTexts(doc) : ''), [doc]);
  const addContact = (c: Contact) => {
    if (!doc) return;
    const { doc: next } = addChild(doc, doc.root.id, contactText(c));
    change(next);
    setPickOpen(false);
  };

  if (phase === 'loading') {
    return <div className="flex-1 flex items-center justify-center text-[12.5px] text-[#999] gap-2"><Loader2 size={16} className="animate-spin" /> Đang tải sơ đồ…</div>;
  }
  if (phase === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[13px] text-[#666] p-6 text-center">
        <AlertTriangle size={22} className="text-amber-500" />
        <div>Không tải được sơ đồ tổ chức: {loadError}</div>
        <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] hover:bg-gray-50"><RefreshCw size={13} /> Thử lại</button>
      </div>
    );
  }
  if (!doc) return null;

  const readOnly = phase === 'missing';
  const sortedContacts = [...contacts].filter(c => c.name?.trim()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 md:px-5 py-2 border-b border-[#E8E7E2] bg-white">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#111]">Sơ đồ tổ chức bên khách</div>
          {!mobile && (
            <div className="text-[11px] text-[#999]">
              Bấm đúp để sửa tên · Tab = thêm cấp dưới · Enter = thêm cùng cấp · kéo thả để đổi cấp · chuột phải để đổi màu, ghi chú
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!readOnly && sortedContacts.length > 0 && (
            <div className="relative">
              <button onClick={() => setPickOpen(o => !o)}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-gray-300 text-[12px] font-medium text-[#333] hover:bg-gray-50">
                <UserPlus size={14} /> Người liên hệ
              </button>
              {pickOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPickOpen(false)} />
                  <div className="absolute right-0 top-9 z-50 w-72 max-h-80 overflow-y-auto rounded-xl border border-[#E8E7E2] bg-white shadow-lg py-1">
                    <div className="px-3 py-1.5 text-[11px] text-[#999]">Thêm vào dưới tên công ty — kéo sang đúng cấp sau</div>
                    {sortedContacts.map(c => {
                      const inMap = used.includes(c.name.trim().toLocaleLowerCase('vi'));
                      return (
                        <button key={c.id} onClick={() => addContact(c)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[#F5F5F7]">
                          <span className="flex-1 min-w-0">
                            <span className="block text-[12.5px] text-[#111] truncate">{c.name}</span>
                            {c.role && <span className="block text-[11px] text-[#888] truncate">{c.role}</span>}
                          </span>
                          {inMap && <span className="shrink-0 text-[10.5px] text-emerald-600 inline-flex items-center gap-0.5"><Check size={11} /> đã có</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          <SaveBadge save={save} by={lastBy} isNew={isNew} readOnly={readOnly} onRetry={() => { void flush(); }} />
        </div>
      </div>
      {readOnly && (
        <div className="shrink-0 flex items-center gap-2 px-3 md:px-5 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-800">
          <AlertTriangle size={14} className="shrink-0" /> {CLIENT_MAPS_MIGRATION_HINT}. Trong lúc chờ, sơ đồ chỉ xem mẫu, chưa sửa được.
        </div>
      )}
      <div className="relative flex-1 min-h-[360px] flex flex-col">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[#999]"><Loader2 size={18} className="animate-spin" /></div>}>
          <MindMapEditor
            key={client.id}
            noteId={`client-org:${client.id}`}
            doc={doc}
            seedText=""
            palette={ORG_PALETTE}
            title={`Sơ đồ tổ chức – ${client.name}`}
            readOnly={readOnly}
            mobile={mobile}
            saveError={save.s === 'error' ? save.msg : null}
            onChange={change}
          />
        </Suspense>
      </div>
    </div>
  );
}

function SaveBadge({ save, by, isNew, readOnly, onRetry }: { save: SaveState; by: string; isNew: boolean; readOnly: boolean; onRetry: () => void }) {
  if (readOnly) return <span className="text-[11.5px] text-amber-700">Chưa lưu được</span>;
  if (save.s === 'saving') return <span className="text-[11.5px] text-[#888] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Đang lưu…</span>;
  if (save.s === 'error') {
    return (
      <button onClick={onRetry} className="text-[11.5px] text-red-600 inline-flex items-center gap-1 hover:underline" title={save.msg}>
        <AlertTriangle size={12} /> Chưa lưu — thử lại
      </button>
    );
  }
  if (save.s === 'saved') return <span className="text-[11.5px] text-[#888] inline-flex items-center gap-1"><Check size={12} className="text-emerald-600" /> Đã lưu {fmtTime(save.at)}{by ? ` · ${by}` : ''}</span>;
  return <span className="text-[11.5px] text-[#999]">{isNew ? 'Sơ đồ mẫu — sửa là tự lưu' : ''}</span>;
}

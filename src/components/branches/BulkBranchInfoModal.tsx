import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { X, ClipboardPaste, Camera, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';
import { parseLatLngFromLink, isValidVnLatLng, mapLinkStatus, MAP_LINK_STATUS_TEXT } from '../../lib/geo';
import { resizeImage, formatBytes } from '../../lib/imageResize';
import { foldVn } from '../../lib/companyMatch';
import { BranchAvatar } from './BranchAvatar';
import type { Branch, BranchStatus } from '../../lib/types';

interface Props {
  branches: Branch[];
  managerNames: string[];
  provinces: string[];
  addProvince: (name: string) => void;
  updateBranch: (id: string, fields: Partial<Omit<Branch, 'id' | 'created_at'>>) => Promise<Branch>;
  /** Tìm Trưởng CN theo tên, chưa có thì tạo mới — dùng chung với hồ sơ chi nhánh. */
  resolveManager: (name: string) => Promise<{ id: string | null; name: string | null }>;
  onClose: () => void;
  toast: (msg: string) => void;
}

type Draft = {
  name: string; short_name: string; manager_name: string; status: BranchStatus; established_date: string;
  location: string; phone: string; email: string; map_link: string; address: string; notes: string;
};
const TEXT_FIELDS = ['name', 'short_name', 'manager_name', 'established_date', 'location', 'phone', 'email', 'map_link', 'address', 'notes'] as const;
type TextField = typeof TEXT_FIELDS[number];
type ColKey = TextField | 'status';

// CN công ty (Rút gọn = LGV) không có các ô này — giống hồ sơ chi nhánh.
const COMPANY_HIDDEN: ColKey[] = ['location', 'phone', 'email', 'map_link', 'address'];
const isCompany = (b: Branch) => b.short_name === 'LGV';

// Desktop: 2 dòng / chi nhánh, xếp đúng như khối "Thông tin & Liên hệ" trong hồ sơ (12 cột mỗi dòng).
type Col = { key: ColKey; label: string; span: string; wide?: boolean; placeholder?: string };
const LINE1: Col[] = [
  { key: 'name', label: 'Tên CN', span: 'md:col-span-2', wide: true },
  { key: 'short_name', label: 'Rút gọn', span: 'md:col-span-2' },
  { key: 'manager_name', label: 'Trưởng VP - CN', span: 'md:col-span-2', placeholder: 'Chọn tên' },
  { key: 'status', label: 'Trạng thái', span: 'md:col-span-2' },
  { key: 'established_date', label: 'Thành lập', span: 'md:col-span-2' },
  { key: 'location', label: 'Địa danh', span: 'md:col-span-2' },
];
const LINE2: Col[] = [
  { key: 'phone', label: 'SĐT', span: 'md:col-span-2' },
  { key: 'email', label: 'Email', span: 'md:col-span-2' },
  { key: 'map_link', label: 'Maps', span: 'md:col-span-3', wide: true, placeholder: 'https://maps…' },
  { key: 'address', label: 'Địa chỉ VP', span: 'md:col-span-3', wide: true },
  { key: 'notes', label: 'Ghi chú', span: 'md:col-span-2', wide: true, placeholder: 'Ghi chú nội bộ…' },
];

/** Ảnh nguồn quá lớn thì canvas dễ hết bộ nhớ trên máy yếu — chặn từ đầu. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

const isMap = (u: string) => /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google|@-?\d+\.\d+,-?\d+\.\d+/i.test(u);
const isEmail = (u: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u);
const isPhone = (u: string) => /^[+\d\s.\-()]+$/.test(u) && u.replace(/\D/g, '').length >= 8 && u.replace(/\D/g, '').length <= 12;
const toIsoDate = (u: string): string | null => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(u)) return u;
  const m = u.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const keyOf = (s: string) => foldVn(s).replace(/[^a-z0-9]/g, '');
const errMsg = (e: unknown) => (e as { message?: string })?.message ?? String(e);

/** Nhập nhanh Ảnh Trưởng CN + Thông tin & Liên hệ cho mọi chi nhánh trong 1 cửa sổ.
 * Chỉ ghi ô người dùng điền; ô trống giữ nguyên dữ liệu cũ (không xoá gì). */
export default function BulkBranchInfoModal({ branches, managerNames, provinces, addProvince, updateBranch, resolveManager, onClose, toast }: Props) {
  const { user } = useAuth();
  const sorted = useMemo(() => [...branches].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [branches]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowState, setRowState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [avatarBusy, setAvatarBusy] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [closing, setClosing] = useState(false);
  const [onlyNoAvatar, setOnlyNoAvatar] = useState(false);

  // Bản sao đồng bộ (ref) để các lần lưu chạy nền luôn đọc đúng giá trị mới nhất.
  const draftsRef = useRef(drafts);
  // Bản ghi chi nhánh ĐÃ ghi trong phiên này (updateBranch trả về) — ưu tiên hơn prop vì prop chỉ đổi sau khi render lại.
  const savedRef = useRef<Record<string, Branch>>({});
  const branchesRef = useRef(branches); branchesRef.current = branches;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const avatarJobs = useRef(new Set<Promise<void>>());
  const errored = useRef(new Set<string>());
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string | null>(null);
  // Cùng 1 tên Trưởng CN mới gõ ở nhiều dòng → chỉ tạo 1 người quản lý (các dòng lưu gần như cùng lúc khi đóng cửa sổ).
  const managerCache = useRef(new Map<string, ReturnType<Props['resolveManager']>>());
  const resolveManagerOnce = (name: string) => {
    const k = name.trim().toLowerCase();
    let p = managerCache.current.get(k);
    if (!p) { p = resolveManager(name); managerCache.current.set(k, p); }
    return p;
  };

  const current = (id: string): Branch | undefined => savedRef.current[id] ?? branchesRef.current.find(b => b.id === id);
  const latest = (b: Branch): Branch => savedRef.current[b.id] ?? b;
  const origOf = (b: Branch): Draft => ({
    name: b.name ?? '', short_name: b.short_name ?? '', manager_name: b.manager_name ?? '', status: b.status || 'active',
    established_date: b.established_date ?? '', location: b.location ?? '', phone: b.phone ?? '', email: b.email ?? '',
    map_link: b.map_link ?? '', address: b.address ?? '', notes: b.notes ?? '',
  });
  const val = (b: Branch): Draft => drafts[b.id] ?? origOf(latest(b));

  // Ô trống không xoá dữ liệu cũ → chỉ tính là thay đổi khi có nội dung mới khác bản đã lưu.
  // final = false (lưu tự động lúc đang gõ) thì chưa lưu Trưởng CN: tên gõ dở "Mr Tu…" sẽ bị tạo thành người quản lý mới.
  const buildUpdates = (b: Branch, d: Draft | undefined, final: boolean): Partial<Branch> => {
    if (!d) return {};
    const o = origOf(b); const updates: Record<string, string> = {};
    for (const k of TEXT_FIELDS) {
      if (k === 'manager_name' && !final) continue;
      if (isCompany(b) && COMPANY_HIDDEN.includes(k)) continue;
      const v = d[k].trim(); if (v && v !== o[k]) updates[k] = v;
    }
    if (d.status !== o.status) updates.status = d.status;
    return updates as Partial<Branch>;
  };
  const hasDiff = (b: Branch) => Object.keys(buildUpdates(latest(b), drafts[b.id], true)).length > 0;
  const changed = sorted.filter(hasDiff);
  const busy = Object.values(rowState).includes('saving') || Object.values(avatarBusy).some(Boolean);
  useBeforeUnloadWarning(changed.length > 0 || busy);

  const persist = async (id: string, fields: Partial<Branch>) => {
    const updated = await updateBranch(id, fields);
    savedRef.current = { ...savedRef.current, [id]: updated };
    return updated;
  };

  const updateDraft = (b: Branch, fn: (d: Draft) => Draft, schedule = true) => {
    const cur = draftsRef.current[b.id] ?? origOf(latest(b));
    draftsRef.current = { ...draftsRef.current, [b.id]: fn(cur) };
    setDrafts(draftsRef.current);
    if (schedule) scheduleSave(b.id);
  };
  const setField = (b: Branch, k: keyof Draft, v: string) => updateDraft(b, d => ({ ...d, [k]: v }));

  // TỰ LƯU: ngừng gõ ~0,8 giây là ghi ngay; rời khỏi ô (blur) hoặc đóng cửa sổ thì ghi tức thì (kèm Trưởng CN).
  const scheduleSave = (id: string) => {
    const t = timers.current.get(id); if (t) clearTimeout(t);
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); void saveRow(id, false); }, 800));
  };
  const flushRow = (id: string) => {
    const t = timers.current.get(id); if (t) { clearTimeout(t); timers.current.delete(id); }
    void saveRow(id, true);
  };

  const saveRow = async (id: string, final: boolean): Promise<void> => {
    const prev = inflight.current.get(id);
    const run = (async () => {
      if (prev) await prev.catch(() => {});             // lần lưu trước xong rồi mới tính lại phần thay đổi
      const b = current(id); if (!b) return;
      const updates = buildUpdates(b, draftsRef.current[id], final);
      if (!Object.keys(updates).length) return;
      setRowState(r => ({ ...r, [id]: 'saving' }));
      try {
        const fields: Partial<Branch> = { ...updates };
        const typedManager = updates.manager_name;
        if (typedManager) {
          const mgr = await resolveManagerOnce(typedManager);
          fields.manager_id = mgr.id; fields.manager_name = mgr.name;
        }
        // Dán link Google Maps → tự sinh toạ độ (giống nút Lưu trong hồ sơ chi nhánh)
        const mapPos = updates.map_link ? parseLatLngFromLink(updates.map_link) : null;
        if (isValidVnLatLng(mapPos)) Object.assign(fields, { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() });
        const updated = await persist(id, fields);
        // Tên Trưởng CN gõ khác hoa/thường với người đã có → đổi ô về đúng tên đã lưu, để dòng không bị coi là "còn thay đổi".
        const d = draftsRef.current[id];
        if (typedManager && d && d.manager_name.trim() === typedManager) {
          draftsRef.current = { ...draftsRef.current, [id]: { ...d, manager_name: updated.manager_name ?? '' } };
          setDrafts(draftsRef.current);
        }
        errored.current.delete(id);
        setRowState(r => ({ ...r, [id]: 'saved' }));
        await logActivity({
          user, action: 'update', table: 'branches', recordId: id,
          description: `Nhập nhanh thông tin chi nhánh "${b.name}"`,
          oldData: b, newData: updated,
        });
      } catch (e) {
        errored.current.add(id);
        setRowState(r => ({ ...r, [id]: 'error' }));
        toast(`Không lưu được "${b.name}": ${errMsg(e)}`);
      }
    })();
    inflight.current.set(id, run);
    await run;
    if (inflight.current.get(id) === run) inflight.current.delete(id);
  };

  // Ảnh Trưởng CN: cắt vuông, hạ về 256 px trên trình duyệt rồi mới tải lên (cùng thư mục với hồ sơ chi nhánh).
  const uploadAvatar = (b: Branch, file: File) => {
    if (!file.type.startsWith('image/')) { toast('File không phải ảnh'); return; }
    if (file.size > MAX_SOURCE_BYTES) { toast(`Ảnh gốc quá lớn (${formatBytes(file.size)}) — chọn ảnh dưới 15 MB`); return; }
    if (avatarBusy[b.id]) return;
    setAvatarBusy(s => ({ ...s, [b.id]: true }));
    const job = (async () => {
      try {
        const resized = await resizeImage(file, { max: 256, quality: 0.85, square: true });
        const path = `branch-managers/${b.id}-${Date.now()}.${resized.ext}`;
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, resized.blob, { upsert: true, contentType: resized.blob.type });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        const before = current(b.id) ?? b;
        const updated = await persist(b.id, { manager_avatar_url: data.publicUrl });
        setRowState(r => ({ ...r, [b.id]: r[b.id] === 'saving' || r[b.id] === 'error' ? r[b.id] : 'saved' }));
        await logActivity({
          user, action: 'update', table: 'branches', recordId: b.id,
          description: `Nhập nhanh ảnh đại diện chi nhánh "${b.name}"`,
          oldData: before, newData: updated,
        });
      } catch (e) {
        toast(`Lỗi tải ảnh "${b.name}": ${errMsg(e)}`);
      } finally {
        setAvatarBusy(s => ({ ...s, [b.id]: false }));
      }
    })();
    avatarJobs.current.add(job);
    void job.finally(() => avatarJobs.current.delete(job));
  };

  const removeAvatar = async (b: Branch) => {
    if (!confirm(`Gỡ ảnh đại diện của "${b.name}"?`)) return;
    try {
      const before = current(b.id) ?? b;
      const updated = await persist(b.id, { manager_avatar_url: null });
      setRowState(r => ({ ...r, [b.id]: r[b.id] === 'saving' || r[b.id] === 'error' ? r[b.id] : 'saved' }));
      await logActivity({
        user, action: 'update', table: 'branches', recordId: b.id,
        description: `Gỡ ảnh đại diện chi nhánh "${b.name}"`,
        oldData: before, newData: updated,
      });
    } catch (e) {
      toast(`Không gỡ được ảnh "${b.name}": ${errMsg(e)}`);
    }
  };

  // Copy 1 ảnh (từ web, Zalo, ảnh chụp màn hình…) rồi bấm vào 1 ô bất kỳ của dòng và Cmd/Ctrl+V → thành ảnh đại diện.
  const onRowPaste = (b: Branch, e: ClipboardEvent) => {
    const img = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
    if (!img) return;
    e.preventDefault();
    uploadAvatar(b, img);
  };

  // Kéo-thả file ảnh vào bất kỳ chỗ nào của 1 dòng → thành ảnh của chi nhánh đó. Kéo chữ thì để trình duyệt xử lý như thường.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onRowDrop = (b: Branch, e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); setDragOver(null);
    const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/'));
    if (f) uploadAvatar(b, f); else toast('Kéo thả 1 file ảnh vào đây');
  };

  // Đóng cửa sổ: ghi nốt mọi thứ còn chờ (kể cả ảnh đang tải) rồi mới đóng — bấm nhầm nút đóng cũng không mất dữ liệu.
  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    timers.current.forEach(t => clearTimeout(t)); timers.current.clear();
    await Promise.all([...Object.keys(draftsRef.current).map(id => saveRow(id, true)), ...avatarJobs.current]);
    if (errored.current.size && !confirm(`Còn ${errored.current.size} chi nhánh CHƯA lưu được (ô viền đỏ). Vẫn đóng và bỏ phần chưa lưu?`)) {
      setClosing(false); return;
    }
    onClose();
  };

  const noAvatarCount = sorted.filter(b => !latest(b).manager_avatar_url).length;
  const shown = onlyNoAvatar ? sorted.filter(b => !latest(b).manager_avatar_url) : sorted;

  // Dán từ Excel: "Tên CN (hoặc Rút gọn) ⇥ cột…" — link Maps, email, SĐT, ngày (dd/mm/yyyy) và tỉnh/thành được nhận
  // tự động; chữ còn lại lần lượt là Trưởng VP - CN → Địa chỉ VP → Ghi chú.
  const applyPaste = () => {
    const byKey = new Map<string, Branch>();
    sorted.forEach(b => { if (b.short_name) byKey.set(keyOf(b.short_name), b); });
    sorted.forEach(b => byKey.set(keyOf(b.name), b));  // trùng thì tên đầy đủ thắng
    const provByKey = new Map(provinces.map(p => [keyOf(p), p]));
    let ok = 0; const miss: string[] = [];
    paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
      const [name, ...rest] = line.split('\t').map(x => x.trim());
      const b = byKey.get(keyOf(name));
      if (!b) { miss.push(name); return; }
      updateDraft(b, cur => {
        const upd = { ...cur };
        const texts: string[] = [];
        rest.filter(Boolean).forEach(v => {
          const date = toIsoDate(v);
          if (isMap(v)) upd.map_link = v;
          else if (isEmail(v)) upd.email = v;
          else if (date) upd.established_date = date;
          else if (isPhone(v)) upd.phone = v;
          else if (provByKey.has(keyOf(v))) upd.location = provByKey.get(keyOf(v))!;
          else texts.push(v);
        });
        if (texts[0]) upd.manager_name = texts[0];
        if (texts[1]) upd.address = texts[1];
        if (texts[2]) upd.notes = texts[2];
        return upd;
      }, false);
      void saveRow(b.id, true);
      ok++;
    });
    toast(`Điền ${ok} dòng${miss.length ? ` — không khớp chi nhánh nào: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}` : ''}. Đang tự lưu.`);
    if (!miss.length) setPaste('');
  };

  const inp = 'w-full text-[11.5px] px-2 py-1 border border-[#E5E3DD] rounded bg-[#FAFAF8] text-[#333] focus:outline-none focus:border-blue-400 focus:bg-white transition-colors';
  const inpErr = 'w-full text-[11.5px] px-2 py-1 border border-red-300 bg-red-50/40 rounded text-[#333] focus:outline-none focus:border-red-500';
  const colsCls = 'grid-cols-2 md:grid-cols-[60px_repeat(12,minmax(0,1fr))] gap-x-2 gap-y-1.5';

  const renderCell = (b: Branch, c: Col, d: Draft, rs: string | undefined) => {
    const cls = rs === 'error' ? inpErr : inp;
    const blur = () => flushRow(b.id);
    const wrap = `min-w-0 ${c.wide ? 'col-span-2' : ''} ${c.span}`;
    if (isCompany(b) && COMPANY_HIDDEN.includes(c.key)) {
      return <div key={c.key} className={`hidden md:block ${wrap} text-[11px] text-[#ccc] px-2 py-1`} title="CN công ty không dùng ô này">—</div>;
    }
    let field: ReactNode;
    if (c.key === 'status') {
      field = (
        <select value={d.status} onChange={e => { setField(b, 'status', e.target.value); }} onBlur={blur} className={cls}>
          <option value="active">Hoạt động</option>
          <option value="paused">Tạm dừng</option>
        </select>
      );
    } else if (c.key === 'location') {
      field = (
        <select value={d.location} onBlur={blur} className={cls} onChange={e => {
          if (e.target.value === '__new__') {
            const v = prompt('Nhập tên Tỉnh/Thành phố mới:');
            if (v && v.trim()) { addProvince(v.trim()); setField(b, 'location', v.trim()); }
            return;
          }
          setField(b, 'location', e.target.value);
        }}>
          <option value="">--</option>
          {d.location && !provinces.includes(d.location) && <option value={d.location}>{d.location}</option>}
          {provinces.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="__new__">+ Thêm…</option>
        </select>
      );
    } else if (c.key === 'established_date') {
      field = <input type="date" value={d.established_date} onChange={e => setField(b, 'established_date', e.target.value)} onBlur={blur} className={cls} />;
    } else {
      const k = c.key;
      field = <input value={d[k]} onChange={e => setField(b, k, e.target.value)} onBlur={blur} placeholder={c.placeholder}
        list={k === 'manager_name' ? 'bulk-branch-manager-options' : undefined} className={cls} />;
    }
    const st = c.key === 'map_link' ? mapLinkStatus(d.map_link) : null;
    return (
      <div key={c.key} className={wrap}>
        <div className="md:hidden text-[9.5px] font-semibold text-[#888] uppercase tracking-wide mb-0.5">{c.label}</div>
        {field}
        {st && <div className={`text-[10px] mt-0.5 truncate ${MAP_LINK_STATUS_TEXT[st].cls}`} title={MAP_LINK_STATUS_TEXT[st].text}>{MAP_LINK_STATUS_TEXT[st].text}</div>}
      </div>
    );
  };

  return (
    // Chỉ đóng khi bấm đúng vào nền mờ. fileRef.click() cũng sinh 1 cú click nổi bọt lên đây — trước đây
    // ô chọn file nằm ngoài khung nên bấm vào ảnh là cửa sổ đóng luôn, ảnh chọn xong không còn chỗ nhận để lưu.
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-0 md:p-4" onClick={e => { if (e.target === e.currentTarget) void handleClose(); }}
      // Thả nhầm ảnh ra ngoài dòng: chặn trình duyệt mở file ảnh (rời trang, mất phần đang gõ)
      onDragOver={e => { if (hasFiles(e)) e.preventDefault(); }} onDrop={e => { if (hasFiles(e)) e.preventDefault(); }}>
      <div className="bg-white md:rounded-[14px] shadow-2xl w-full max-w-[1180px] h-full md:h-auto md:max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <datalist id="bulk-branch-manager-options">
          {managerNames.map(m => <option key={m} value={m} />)}
        </datalist>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
          const f = e.target.files?.[0]; const b = sorted.find(x => x.id === pickFor.current);
          if (f && b) uploadAvatar(b, f);
          e.target.value = '';
        }} />
        <div className="flex items-start justify-between gap-3 px-4 md:px-5 py-3.5 border-b border-[#E8E7E2]">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#111]">Nhập nhanh Ảnh & Thông tin — Chi nhánh</div>
            <div className="text-[11px] text-[#999]">TỰ ĐỘNG LƯU ngay khi bạn gõ xong — không cần bấm Lưu. Ô trống giữ nguyên dữ liệu cũ, không xoá gì.</div>
            <div className="text-[11px] text-[#0F6E56] mt-0.5 flex items-center gap-1 flex-wrap">
              <Camera size={11} /> Ảnh: bấm vào ảnh để chọn file, kéo-thả ảnh vào dòng đó, hoặc copy 1 ảnh rồi bấm vào ô bất kỳ của dòng đó và nhấn ⌘V / Ctrl+V.
            </div>
          </div>
          <button onClick={handleClose} disabled={closing} className="p-1.5 hover:bg-gray-100 rounded shrink-0"><X size={15} /></button>
        </div>
        <div className="px-4 md:px-5 py-3 border-b border-[#F0EFEA] space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#666] flex-wrap">
            <ClipboardPaste size={12} /> Dán nhiều dòng từ Excel: <span className="font-mono text-[10.5px] bg-gray-100 px-1 rounded">Tên CN ⇥ Trưởng VP - CN ⇥ SĐT ⇥ Email ⇥ Địa chỉ VP ⇥ Link Maps ⇥ …</span>
            (link Maps, email, SĐT, ngày thành lập, tỉnh/thành tự nhận; chữ còn lại lần lượt là Trưởng VP - CN → Địa chỉ VP → Ghi chú).
          </div>
          <div className="flex gap-2">
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2} placeholder="Dán vào đây…"
              className="flex-1 text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-none font-mono" />
            <button onClick={applyPaste} disabled={!paste.trim()}
              className="self-end px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#E8E7E2] text-[#444] hover:bg-[#F9F9F7] disabled:opacity-40">Điền vào bảng</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-3 md:px-5 pb-2">
          {/* Tiêu đề cột (desktop): 2 dòng, khớp đúng 2 dòng ô nhập của mỗi chi nhánh */}
          <div className={`hidden md:grid ${colsCls} sticky top-0 bg-white z-10 px-2 pt-2 pb-1.5 border-b border-[#E8E7E2] text-[10px] font-semibold text-[#888] uppercase tracking-wide`}>
            <div className="row-span-2 self-center">Ảnh</div>
            {LINE1.map(c => <div key={c.key} className={c.span}>{c.label}</div>)}
            {LINE2.map(c => <div key={c.key} className={c.span}>{c.label}</div>)}
          </div>
          {shown.map(b => {
            const lb = latest(b);
            const d = val(b);
            const rs = rowState[b.id];
            const pending = hasDiff(b);
            const upBusy = !!avatarBusy[b.id];
            return (
              <div key={b.id} onPaste={e => onRowPaste(b, e)}
                onDragOver={e => { if (!hasFiles(e)) return; e.preventDefault(); if (dragOver !== b.id) setDragOver(b.id); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null); }}
                onDrop={e => onRowDrop(b, e)}
                className={`grid ${colsCls} px-2 py-2 border-b border-[#F0EFEA] ${dragOver === b.id ? 'bg-emerald-50 outline outline-2 outline-[#0F6E56]/40 -outline-offset-2 rounded' : pending ? 'bg-blue-50/50' : ''}`}>
                <div className="col-span-2 md:col-span-1 md:row-span-2 flex md:flex-col items-center gap-2 md:gap-1 md:pt-0.5">
                  <div className="relative group shrink-0">
                    <button type="button" disabled={upBusy} onClick={() => { pickFor.current = b.id; fileRef.current?.click(); }}
                      title="Bấm để chọn ảnh — hoặc kéo-thả ảnh vào đây"
                      className={`relative block rounded-full ${dragOver === b.id ? 'ring-2 ring-[#0F6E56] ring-offset-1' : ''}`}>
                      <BranchAvatar branch={lb} size={40} />
                      <span className={`absolute inset-0 rounded-full flex items-center justify-center transition-colors ${upBusy ? 'bg-black/40' : 'bg-black/0 group-hover:bg-black/40'}`}>
                        {upBusy ? <Loader2 size={14} className="text-white animate-spin" /> : <Camera size={13} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />}
                      </span>
                    </button>
                    {lb.manager_avatar_url && !upBusy && (
                      <button type="button" onClick={() => removeAvatar(b)} title="Gỡ ảnh"
                        className="absolute -top-1 -right-1 w-[16px] h-[16px] rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                        <X size={9} />
                      </button>
                    )}
                  </div>
                  <div className="md:hidden flex-1 min-w-0 text-[13px] font-semibold text-[#111] truncate">{lb.name}</div>
                  <div className="text-[10px] leading-none whitespace-nowrap">
                    {upBusy && <span className="text-blue-600">Tải ảnh…</span>}
                    {!upBusy && pending && rs !== 'saving' && <span title="Sắp tự lưu…" className="text-[#999]">…</span>}
                    {!upBusy && rs === 'saving' && <span className="text-blue-600">Đang lưu</span>}
                    {!upBusy && rs === 'saved' && !pending && <span title="Đã lưu" className="text-emerald-600 font-medium">✓ Đã lưu</span>}
                    {!upBusy && rs === 'error' && <span title="Lưu thất bại — kiểm tra lại nội dung rồi gõ lại" className="text-red-600 font-medium">⚠ Lỗi</span>}
                  </div>
                </div>
                {LINE1.map(c => renderCell(b, c, d, rs))}
                {LINE2.map(c => renderCell(b, c, d, rs))}
              </div>
            );
          })}
          {!shown.length && <div className="py-8 text-center text-[12px] text-[#999]">{onlyNoAvatar ? 'Chi nhánh nào cũng đã có ảnh.' : 'Chưa có chi nhánh nào.'}</div>}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 md:px-5 py-3 border-t border-[#E8E7E2]">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className={`text-[11.5px] ${errored.current.size ? 'text-red-600' : busy || changed.length ? 'text-blue-600' : 'text-emerald-600'}`}>
              {errored.current.size ? `⚠ ${errored.current.size} chi nhánh chưa lưu được` : busy || changed.length ? 'Đang tự lưu…' : '✓ Mọi thay đổi đã được lưu'}
            </span>
            <button onClick={() => setOnlyNoAvatar(v => !v)} className={`text-[11.5px] px-2 py-1 rounded-lg border ${onlyNoAvatar ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
              {onlyNoAvatar ? 'Hiện tất cả' : `Chỉ hiện CN chưa có ảnh (${noAvatarCount})`}
            </button>
          </div>
          <button onClick={handleClose} disabled={closing}
            className="shrink-0 px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 disabled:opacity-50">
            {closing ? 'Đang lưu nốt…' : 'Xong'}
          </button>
        </div>
      </div>
    </div>
  );
}

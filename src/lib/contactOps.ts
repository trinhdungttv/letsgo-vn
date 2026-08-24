// ============================================================================
// contactOps — toàn bộ quy tắc nghiệp vụ của "người liên hệ" nằm ở đây.
// ----------------------------------------------------------------------------
// Bảng `contacts` là NGUỒN DUY NHẤT. Hai màn hình cùng ghi vào đó:
//   • CRM → CSKH → Danh sách liên hệ  (nhập tự do, có thể chưa gắn công ty)
//   • Khách hàng → Hồ sơ chăm sóc → Người liên hệ (công ty gắn sẵn)
// Mọi thao tác thêm/sửa/gắn công ty/ngưng/xoá đều phải đi qua file này để 2 bên
// hành xử giống hệt nhau.
//
// Từ migration 145: một người phụ trách được NHIỀU CÔNG TY, các công ty NGANG
// HÀNG nhau. Quan hệ nằm ở bảng nối `contact_clients`; cột `contacts.client_id`
// chỉ còn là cột soi do trigger tự ghi — KHÔNG đọc, KHÔNG ghi thẳng vào nó.
// ============================================================================
import { supabase } from './supabase';
import { logActivity } from './audit';
import type { AppUser, Contact, ContactClientLink } from './types';

/** Các cột cần nạp kèm mỗi khi đọc liên hệ — luôn có đủ danh sách công ty. */
export const CONTACT_SELECT = '*, clients(name), contact_clients(client_id, is_primary, created_at, clients(name))';

// ── Chạy được cả khi DB chưa có bảng nối ────────────────────────────────────
// Migration 145 do người dùng tự chạy trên Supabase. Nếu code lên trước SQL thì
// mọi truy vấn kèm `contact_clients` sẽ lỗi và cả trang CSKH lẫn Hồ sơ chăm sóc
// trắng bảng. Nên phần ĐỌC tự lùi về cột cũ (mỗi người 1 công ty) để app vẫn
// dùng được; chỉ phần GHI mới báo là cần chạy migration.
const CONTACT_SELECT_LEGACY = '*, clients(name)';

/** null = chưa dò; true/false = DB đã/chưa có bảng nối. Dò một lần rồi nhớ. */
let junctionReady: boolean | null = null;
/** Nhiều màn hình mở cùng lúc thì chỉ dò MỘT lần, các nơi khác chờ chung kết quả. */
let junctionProbe: Promise<boolean> | null = null;

/** DB đã có bảng nối chưa. An toàn khi gọi song song từ nhiều chỗ. */
async function hasJunction(): Promise<boolean> {
  if (junctionReady !== null) return junctionReady;
  if (!junctionProbe) {
    junctionProbe = (async () => {
      const { error } = await supabase.from('contact_clients').select('contact_id').limit(1);
      junctionReady = !error;
      junctionProbe = null;
      return junctionReady;
    })();
  }
  return junctionProbe;
}

const isMissingJunction = (err: { message?: string; code?: string } | null) =>
  !!err && /contact_clients/i.test(err.message || '') &&
  /(relationship|schema cache|does not exist|42P01)/i.test(`${err.message} ${err.code}`);

export const MIGRATION_145_HINT =
  'Tính năng "một người nhiều công ty" cần migration 145 (contact_clients). ' +
  'Mở Supabase → SQL Editor, chạy file 20260823100000_145_contact_multi_client.sql rồi thử lại.';

/** Ném lỗi đọc được nếu thao tác ghi chạm vào bảng nối chưa tồn tại. */
function throwWriteError(err: { message?: string; code?: string } | null): never {
  throw new Error(isMissingJunction(err) ? MIGRATION_145_HINT : (err?.message || 'Lỗi không rõ'));
}

/** Dựng contact_clients giả lập từ cột cũ, để phần còn lại của app không phải biết. */
const withFallbackLinks = (rows: Contact[]): Contact[] => rows.map(c => ({
  ...c,
  contact_clients: c.client_id
    ? [{ client_id: c.client_id, is_primary: !!c.is_primary, clients: c.clients ?? null }]
    : [],
}));

/**
 * Đọc bảng `contacts` kèm đủ danh sách công ty. `apply` nhận query builder để
 * gắn thêm .eq/.in/.order — dùng hàm này thay vì tự gọi supabase, có vậy màn
 * hình nào cũng được lớp lùi-về-cột-cũ bảo vệ.
 */
export async function selectContacts(apply: (q: any) => any = q => q): Promise<Contact[]> {
  if (await hasJunction()) {
    const { data, error } = await apply(supabase.from('contacts').select(CONTACT_SELECT));
    if (!error) return (data || []) as Contact[];
    if (!isMissingJunction(error)) throw error;
    junctionReady = false;   // bảng vừa biến mất giữa chừng — lùi về cột cũ
  }
  const { data, error } = await apply(supabase.from('contacts').select(CONTACT_SELECT_LEGACY));
  if (error) throw error;
  return withFallbackLinks((data || []) as Contact[]);
}

/**
 * Người liên hệ của MỘT công ty, kèm đủ các công ty khác họ kiêm nhiệm.
 * Hỏi bảng nối trước; DB chưa có bảng nối thì lọc thẳng cột cũ như trước đây.
 */
export async function fetchContactsOfClient(
  clientId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<Contact[]> {
  const order = (q: any) => {
    const withActive = opts.activeOnly ? q.eq('is_active', true) : q.order('is_active', { ascending: false });
    return withActive.order('created_at', { ascending: false });
  };

  if (await hasJunction()) {
    const { data: links, error } = await supabase
      .from('contact_clients').select('contact_id').eq('client_id', clientId);
    if (error) throw error;
    const ids = (links || []).map(l => (l as { contact_id: string }).contact_id);
    if (!ids.length) return [];
    const rows = await selectContacts(q => order(q.in('id', ids)));
    return rows.sort((a, b) => Number(isPrimaryAt(b, clientId)) - Number(isPrimaryAt(a, clientId)));
  }
  const rows = await selectContacts(q => order(q.eq('client_id', clientId)));
  return rows.sort((a, b) => Number(isPrimaryAt(b, clientId)) - Number(isPrimaryAt(a, clientId)));
}

/** Danh sách công ty của một liên hệ, đã xếp theo tên. */
export function linksOf(c: Contact | null | undefined): ContactClientLink[] {
  return [...(c?.contact_clients || [])].sort(
    (a, b) => (a.clients?.name || '').localeCompare(b.clients?.name || '', 'vi')
  );
}

/** Các id công ty người này phụ trách. */
export const clientIdsOf = (c: Contact | null | undefined): string[] => linksOf(c).map(l => l.client_id);

/** Người này có phải liên hệ chính của công ty `clientId` không. */
export function isPrimaryAt(c: Contact | null | undefined, clientId: string): boolean {
  return !!c?.contact_clients?.some(l => l.client_id === clientId && l.is_primary);
}

/** Các công ty người này đang làm liên hệ chính. */
export const primaryClientIdsOf = (c: Contact | null | undefined): string[] =>
  linksOf(c).filter(l => l.is_primary).map(l => l.client_id);

/** Các trường người dùng nhập được — dùng chung cho cả 2 form. */
export interface ContactFormValues {
  name: string;
  phone: string;
  email: string;
  role: string;
  /** Các công ty người này phụ trách — ngang hàng. Rỗng = chưa gắn công ty nào. */
  client_ids: string[];
  /** Tập con của `client_ids`: những công ty người này làm liên hệ chính. */
  primary_client_ids: string[];
  start_date: string;         // '' = chưa rõ
  is_active: boolean;
  notes: string;
  address: string;
  birthday: string;
  hobbies: string[];
  channel: string;
  social_link: string;
  rich_notes: string;
  /** Link Google Maps của địa chỉ nhà riêng. */
  map_link: string;
  /** URL ảnh đại diện trong bucket `avatars`. */
  avatar_url: string;
}

export const CONTACT_CHANNELS = ['Zalo', 'Facebook', 'Giới thiệu', 'Gặp trực tiếp'];

export const emptyContactForm = (clientId = ''): ContactFormValues => ({
  name: '', phone: '', email: '', role: 'HR Manager',
  client_ids: clientId ? [clientId] : [],
  primary_client_ids: [],
  start_date: new Date().toISOString().slice(0, 10),
  is_active: true,
  notes: '', address: '', birthday: '',
  hobbies: [], channel: '', social_link: '', rich_notes: '',
  map_link: '', avatar_url: '',
});

/** Đọc sở thích: cột `hobbies` là TEXT chứa JSON array, dữ liệu cũ có thể là chuỗi thường. */
export function parseHobbies(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
}

export const contactToForm = (c: Contact): ContactFormValues => ({
  name: c.name || '',
  phone: c.phone || '',
  email: c.email || '',
  role: c.role || 'Khác',
  client_ids: clientIdsOf(c),
  primary_client_ids: primaryClientIdsOf(c),
  start_date: c.start_date || '',
  is_active: c.is_active,
  notes: c.notes || '',
  address: c.address || '',
  birthday: c.birthday || '',
  hobbies: parseHobbies(c.hobbies),
  channel: c.channel || '',
  social_link: c.social_link || '',
  rich_notes: c.rich_notes || '',
  map_link: c.map_link || '',
  avatar_url: c.avatar_url || '',
});

// ── Trùng số điện thoại ─────────────────────────────────────────────────────
/**
 * Tìm liên hệ đã có cùng SĐT (bỏ qua khoảng trắng/dấu chấm/gạch).
 * Chỉ để CẢNH BÁO, không chặn lưu — thực tế nhiều người dùng chung số tổng đài.
 */
export async function findPhoneDuplicates(phone: string, excludeId?: string): Promise<Contact[]> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return [];
  const data = await selectContacts(q => q.not('phone', 'is', null));
  return data.filter(
    c => c.id !== excludeId && (c.phone || '').replace(/\D/g, '') === digits
  );
}

// ── Ghi lịch sử chuyển công ty ──────────────────────────────────────────────
async function recordClientChange(opts: {
  contactId: string;
  contactName: string;
  fromClientId: string | null;
  toClientId: string | null;
  clientName: (id: string | null) => string | null;
  user: AppUser | null;
  note?: string;
}) {
  const fromName = opts.clientName(opts.fromClientId);
  const toName = opts.clientName(opts.toClientId);
  await supabase.from('contact_client_history').insert({
    contact_id: opts.contactId,
    from_client_id: opts.fromClientId,
    to_client_id: opts.toClientId,
    from_client_name: fromName,
    to_client_name: toName,
    changed_by: opts.user?.full_name || null,
    note: opts.note || null,
  });
  const label = !opts.fromClientId
    ? `Gắn liên hệ "${opts.contactName}" vào công ty "${toName}"`
    : !opts.toClientId
      ? `Gỡ liên hệ "${opts.contactName}" khỏi công ty "${fromName}"`
      : `Chuyển liên hệ "${opts.contactName}": "${fromName}" → "${toName}"`;
  await logActivity({
    user: opts.user, action: 'update', table: 'contacts', recordId: opts.contactId,
    description: label,
    oldData: { client_id: opts.fromClientId }, newData: { client_id: opts.toClientId },
  });
}

/** Bỏ cờ liên hệ chính của những người khác trong cùng công ty (DB có unique index). */
async function clearPrimaryElsewhere(clientId: string, keepId?: string) {
  let q = supabase
    .from('contact_clients')
    .update({ is_primary: false })
    .eq('client_id', clientId)
    .eq('is_primary', true);
  // Khi thêm mới thì chưa có id để loại trừ — `.neq(...,'')` sẽ làm Postgres
  // lỗi ép kiểu uuid, nên chỉ gắn điều kiện khi thực sự có id.
  if (keepId) q = q.neq('contact_id', keepId);
  const { error } = await q;
  if (error) throwWriteError(error);
}

// ── Đồng bộ danh sách công ty của một liên hệ ───────────────────────────────
/**
 * Đưa bảng nối về đúng `clientIds` mong muốn: thêm dòng còn thiếu, xoá dòng thừa,
 * chỉnh cờ liên hệ chính. Ghi lịch sử cho từng công ty được gắn thêm / gỡ ra.
 *
 * Thứ tự thao tác quan trọng: NHẢ cờ liên hệ chính của người khác TRƯỚC khi ghi
 * cờ cho người này, nếu không unique index "1 liên hệ chính / công ty" sẽ chặn.
 */
async function syncContactClients(opts: {
  contactId: string;
  contactName: string;
  before: ContactClientLink[];
  clientIds: string[];
  primaryIds: string[];
  ctx: SaveContactCtx;
  note?: string;
}): Promise<void> {
  const want = [...new Set(opts.clientIds)];
  const wantPrimary = new Set(opts.primaryIds.filter(id => want.includes(id)));
  const beforeIds = opts.before.map(l => l.client_id);

  const added = want.filter(id => !beforeIds.includes(id));
  const removed = beforeIds.filter(id => !want.includes(id));

  if (removed.length) {
    const { error } = await supabase.from('contact_clients')
      .delete().eq('contact_id', opts.contactId).in('client_id', removed);
    if (error) throwWriteError(error);
  }

  for (const id of want) {
    if (wantPrimary.has(id)) await clearPrimaryElsewhere(id, opts.contactId);
  }

  if (want.length) {
    const rows = want.map(id => ({
      contact_id: opts.contactId,
      client_id: id,
      is_primary: wantPrimary.has(id),
    }));
    const { error } = await supabase.from('contact_clients')
      .upsert(rows, { onConflict: 'contact_id,client_id' });
    if (error) throwWriteError(error);
  }

  // Mỗi công ty gắn thêm / gỡ ra là một mốc lịch sử riêng, đọc được về sau.
  for (const id of added) {
    await recordClientChange({
      contactId: opts.contactId, contactName: opts.contactName,
      fromClientId: null, toClientId: id,
      clientName: opts.ctx.clientName, user: opts.ctx.user, note: opts.note,
    });
  }
  for (const id of removed) {
    await recordClientChange({
      contactId: opts.contactId, contactName: opts.contactName,
      fromClientId: id, toClientId: null,
      clientName: opts.ctx.clientName, user: opts.ctx.user, note: opts.note,
    });
  }
}

/** Đọc lại một liên hệ kèm đủ danh sách công ty — dùng sau mỗi lần ghi. */
async function refetchContact(id: string): Promise<Contact> {
  const rows = await selectContacts(q => q.eq('id', id));
  if (!rows.length) throw new Error('Không đọc lại được liên hệ vừa lưu');
  return rows[0];
}

// ── Cột mới cần migration 143 ───────────────────────────────────────────────
// DB chưa chạy migration 143 thì `map_link` / `avatar_url` chưa tồn tại và mọi
// thao tác lưu liên hệ sẽ hỏng. Thay vì để app chết, bỏ 2 cột đó ra rồi thử lại
// — người dùng vẫn lưu được, chỉ là chưa có ảnh và link bản đồ.
const OPTIONAL_COLUMNS = ['map_link', 'avatar_url'] as const;

const isMissingColumnError = (err: { message?: string; code?: string } | null) =>
  !!err && (err.code === '42703' || /column .* does not exist|could not find the .* column/i.test(err.message || ''));

function withoutOptionalColumns<T extends Record<string, any>>(payload: T): T {
  const copy = { ...payload };
  for (const col of OPTIONAL_COLUMNS) delete copy[col];
  return copy;
}

// ── Lưu (thêm / sửa) ────────────────────────────────────────────────────────
export interface SaveContactCtx {
  user: AppUser | null;
  /** Tra tên công ty theo id — để ghi lịch sử đọc được kể cả khi công ty đổi tên sau này. */
  clientName: (id: string | null) => string | null;
}

/**
 * Thêm mới hoặc cập nhật một liên hệ.
 * Xử lý sẵn các quy tắc:
 *   • Gắn thêm / gỡ bớt công ty → ghi contact_client_history + audit_logs.
 *   • Rời công ty → cờ "liên hệ chính" ở công ty đó mất theo dòng nối.
 *   • Chưa gắn công ty → không thể là liên hệ chính.
 *   • Đặt liên hệ chính → tự bỏ cờ của người khác trong cùng công ty.
 *   • Đánh dấu đã nghỉ → tự điền end_date; hoạt động lại → xoá end_date.
 */
export async function saveContact(
  form: ContactFormValues,
  existing: Contact | null,
  ctx: SaveContactCtx
): Promise<Contact> {
  const name = form.name.trim();
  if (!name) throw new Error('Vui lòng nhập họ tên');

  const clientIds = [...new Set(form.client_ids)];
  // Liên hệ tự do không thuộc công ty nào thì không có khái niệm "liên hệ chính".
  const primaryIds = form.is_active ? form.primary_client_ids.filter(id => clientIds.includes(id)) : [];
  const today = new Date().toISOString().slice(0, 10);

  // `client_id` / `is_primary` KHÔNG nằm trong payload: trigger của bảng nối tự
  // ghi 2 cột soi đó. Ghi thẳng ở đây sẽ đá nhau với trigger.
  const payload = {
    name,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    role: form.role || null,
    start_date: form.start_date || null,
    end_date: form.is_active ? null : (existing?.end_date || today),
    is_active: form.is_active,
    notes: form.notes.trim() || null,
    address: form.address.trim() || null,
    birthday: form.birthday || null,
    hobbies: form.hobbies.length ? JSON.stringify(form.hobbies) : null,
    channel: form.channel || null,
    social_link: form.social_link.trim() || null,
    rich_notes: form.rich_notes || null,
    map_link: form.map_link.trim() || null,
    avatar_url: form.avatar_url.trim() || null,
    updated_at: new Date().toISOString(),
  };

  let savedId: string;
  if (existing) {
    const runUpdate = (body: typeof payload) => supabase
      .from('contacts').update(body).eq('id', existing.id).select('id').single();
    let { data, error } = await runUpdate(payload);
    if (isMissingColumnError(error)) ({ data, error } = await runUpdate(withoutOptionalColumns(payload)));
    if (error) throw error;
    savedId = (data as { id: string }).id;

    await syncContactClients({
      contactId: savedId, contactName: name,
      before: linksOf(existing), clientIds, primaryIds, ctx,
    });
    const saved = await refetchContact(savedId);
    await logActivity({
      user: ctx.user, action: 'update', table: 'contacts', recordId: savedId,
      description: `Cập nhật liên hệ "${name}"`,
      oldData: existing, newData: saved,
    });
    return saved;
  }

  const body = { ...payload, created_at: new Date().toISOString() };
  const runInsert = (b: typeof body) => supabase
    .from('contacts').insert(b).select('id').single();
  let { data, error } = await runInsert(body);
  if (isMissingColumnError(error)) ({ data, error } = await runInsert(withoutOptionalColumns(body)));
  if (error) throw error;
  savedId = (data as { id: string }).id;

  await syncContactClients({
    contactId: savedId, contactName: name,
    before: [], clientIds, primaryIds, ctx, note: 'Tạo mới liên hệ',
  });
  const saved = await refetchContact(savedId);
  await logActivity({
    user: ctx.user, action: 'insert', table: 'contacts', recordId: savedId,
    description: `Thêm liên hệ "${name}"${clientIds.length
      ? ` — ${clientIds.map(id => ctx.clientName(id)).filter(Boolean).join(', ')}`
      : ' (chưa gắn công ty)'}`,
    newData: saved,
  });
  return saved;
}

// ── Gắn / gỡ công ty nhanh (không mở form) ──────────────────────────────────
/** Đặt lại TOÀN BỘ danh sách công ty của một liên hệ. */
export async function setContactClients(
  contact: Contact,
  clientIds: string[],
  ctx: SaveContactCtx
): Promise<Contact> {
  const before = linksOf(contact);
  const want = [...new Set(clientIds)];
  const same = before.length === want.length && before.every(l => want.includes(l.client_id));
  if (same) return contact;
  await syncContactClients({
    contactId: contact.id, contactName: contact.name,
    before, clientIds: want,
    // Giữ nguyên cờ liên hệ chính ở những công ty vẫn còn trong danh sách.
    primaryIds: before.filter(l => l.is_primary && want.includes(l.client_id)).map(l => l.client_id),
    ctx,
  });
  return refetchContact(contact.id);
}

/** Gắn thêm MỘT công ty, giữ nguyên các công ty đang có. */
export const addContactClient = (contact: Contact, clientId: string, ctx: SaveContactCtx) =>
  setContactClients(contact, [...clientIdsOf(contact), clientId], ctx);

/** Gỡ MỘT công ty khỏi liên hệ, các công ty còn lại giữ nguyên. */
export const removeContactClient = (contact: Contact, clientId: string, ctx: SaveContactCtx) =>
  setContactClients(contact, clientIdsOf(contact).filter(id => id !== clientId), ctx);

// ── Đặt liên hệ chính (theo TỪNG công ty) ───────────────────────────────────
export async function setPrimaryContact(contact: Contact, clientId: string, ctx: SaveContactCtx): Promise<void> {
  if (!clientIdsOf(contact).includes(clientId)) {
    throw new Error('Liên hệ chưa gắn công ty này nên không thể đặt làm liên hệ chính');
  }
  await clearPrimaryElsewhere(clientId, contact.id);
  const { error } = await supabase
    .from('contact_clients').update({ is_primary: true })
    .eq('contact_id', contact.id).eq('client_id', clientId);
  if (error) throwWriteError(error);
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Đặt "${contact.name}" làm liên hệ chính của "${ctx.clientName(clientId)}"`,
    oldData: contact, newData: { ...contact, primary_at: clientId },
  });
}

export async function unsetPrimaryContact(contact: Contact, clientId: string, ctx: SaveContactCtx): Promise<void> {
  const { error } = await supabase
    .from('contact_clients').update({ is_primary: false })
    .eq('contact_id', contact.id).eq('client_id', clientId);
  if (error) throwWriteError(error);
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Bỏ cờ liên hệ chính của "${contact.name}" tại "${ctx.clientName(clientId)}"`,
    oldData: contact, newData: { ...contact, unprimary_at: clientId },
  });
}

// ── Ngưng / mở lại (xoá mềm) ────────────────────────────────────────────────
/** Đánh dấu đã nghỉ: giữ nguyên bản ghi + toàn bộ lịch sử, chỉ đóng mốc thời gian. */
export async function deactivateContact(contact: Contact, ctx: SaveContactCtx): Promise<Contact> {
  const endDate = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('contacts')
    .update({ is_active: false, end_date: endDate, updated_at: new Date().toISOString() })
    .eq('id', contact.id);
  if (error) throw error;
  // Người đã nghỉ thì không còn là liên hệ chính ở BẤT KỲ công ty nào — nhưng
  // vẫn giữ nguyên các dòng nối để biết trước đây phụ trách những đâu.
  const { error: linkErr } = await supabase
    .from('contact_clients').update({ is_primary: false }).eq('contact_id', contact.id);
  if (linkErr) throwWriteError(linkErr);
  const data = await refetchContact(contact.id);
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Đánh dấu liên hệ "${contact.name}" đã nghỉ (${endDate})`,
    oldData: contact, newData: data,
  });
  return data;
}

export async function reactivateContact(contact: Contact, ctx: SaveContactCtx): Promise<Contact> {
  const { error } = await supabase
    .from('contacts')
    .update({ is_active: true, end_date: null, updated_at: new Date().toISOString() })
    .eq('id', contact.id);
  if (error) throw error;
  const data = await refetchContact(contact.id);
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Mở lại liên hệ "${contact.name}" (đang phụ trách)`,
    oldData: contact, newData: data,
  });
  return data;
}

// ── Xoá vĩnh viễn ───────────────────────────────────────────────────────────
export interface ContactUsage {
  pipeline: number;   // crm_pipeline.contact_id
  deals: number;      // crm_deals.contact_id
  crmGifts: number;   // crm_gifts.recipient_contact_id
  clientGifts: number;// client_gifts.recipient_contact_id
  /** Số công ty người này đang là liên hệ chính — xoá đi là các công ty đó trống chỗ. */
  primaryCount: number;
  total: number;
}

/**
 * Đếm những nơi đang trỏ tới liên hệ này, để cảnh báo TRƯỚC khi xoá.
 * Tất cả FK đều ON DELETE SET NULL ⇒ xoá không mất deal/quà tặng,
 * nhưng các bản ghi đó sẽ mất tên người liên hệ/người nhận.
 */
export async function getContactUsage(contact: Contact): Promise<ContactUsage> {
  const count = async (table: string, column: string) => {
    const { count: n } = await supabase
      .from(table).select('id', { count: 'exact', head: true }).eq(column, contact.id);
    return n || 0;
  };
  const [pipeline, deals, crmGifts, clientGifts] = await Promise.all([
    count('crm_pipeline', 'contact_id'),
    count('crm_deals', 'contact_id'),
    count('crm_gifts', 'recipient_contact_id'),
    count('client_gifts', 'recipient_contact_id'),
  ]);
  return {
    pipeline, deals, crmGifts, clientGifts,
    primaryCount: primaryClientIdsOf(contact).length,
    total: pipeline + deals + crmGifts + clientGifts,
  };
}

/**
 * Xoá vĩnh viễn khỏi bảng contacts.
 * Vẫn khôi phục được: bản ghi cũ nằm trong audit_logs (nút Hoàn tác ở trang
 * Lịch sử) và trong data_history (cỗ máy thời gian).
 */
export async function deleteContact(contact: Contact, ctx: SaveContactCtx): Promise<void> {
  const names = clientIdsOf(contact).map(id => ctx.clientName(id)).filter(Boolean).join(', ');
  const { error } = await supabase.from('contacts').delete().eq('id', contact.id);
  if (error) throw error;
  await logActivity({
    user: ctx.user, action: 'delete', table: 'contacts', recordId: contact.id,
    description: `Xoá vĩnh viễn liên hệ "${contact.name}"${names ? ` — ${names}` : ''}`,
    oldData: contact,
  });
}

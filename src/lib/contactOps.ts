// ============================================================================
// contactOps — toàn bộ quy tắc nghiệp vụ của "người liên hệ" nằm ở đây.
// ----------------------------------------------------------------------------
// Bảng `contacts` là NGUỒN DUY NHẤT. Hai màn hình cùng ghi vào đó:
//   • CRM → CSKH → Danh sách liên hệ  (nhập tự do, client_id có thể NULL)
//   • Khách hàng → Hồ sơ chăm sóc → Người liên hệ (client_id gắn sẵn)
// Mọi thao tác thêm/sửa/gắn công ty/ngưng/xoá đều phải đi qua file này để 2 bên
// hành xử giống hệt nhau.
// ============================================================================
import { supabase } from './supabase';
import { logActivity } from './audit';
import type { AppUser, Contact } from './types';

/** Các trường người dùng nhập được — dùng chung cho cả 2 form. */
export interface ContactFormValues {
  name: string;
  phone: string;
  email: string;
  role: string;
  client_id: string;          // '' = chưa gắn công ty
  start_date: string;         // '' = chưa rõ
  is_active: boolean;
  is_primary: boolean;        // chỉ có nghĩa khi đã gắn công ty
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
  client_id: clientId,
  start_date: new Date().toISOString().slice(0, 10),
  is_active: true, is_primary: false,
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
  client_id: c.client_id || '',
  start_date: c.start_date || '',
  is_active: c.is_active,
  is_primary: c.is_primary,
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
  const { data } = await supabase
    .from('contacts')
    .select('id, name, phone, role, client_id, is_active, clients(name)')
    .not('phone', 'is', null);
  return ((data || []) as unknown as Contact[]).filter(
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
    .from('contacts')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('is_primary', true);
  // Khi thêm mới thì chưa có id để loại trừ — `.neq('id', '')` sẽ làm Postgres
  // lỗi ép kiểu uuid, nên chỉ gắn điều kiện khi thực sự có id.
  if (keepId) q = q.neq('id', keepId);
  await q;
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
 *   • Đổi/gỡ/gắn công ty → ghi contact_client_history + audit_logs.
 *   • Rời công ty cũ → tự bỏ cờ "liên hệ chính" ở công ty cũ.
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

  const clientId = form.client_id || null;
  // Liên hệ tự do không thuộc công ty nào thì không có khái niệm "liên hệ chính".
  const isPrimary = clientId ? form.is_primary : false;
  const today = new Date().toISOString().slice(0, 10);

  const payload = {
    name,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    role: form.role || null,
    client_id: clientId,
    start_date: form.start_date || null,
    end_date: form.is_active ? null : (existing?.end_date || today),
    is_active: form.is_active,
    is_primary: isPrimary,
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

  // Nhả cờ liên hệ chính TRƯỚC khi ghi, nếu không unique index sẽ chặn.
  if (isPrimary && clientId) await clearPrimaryElsewhere(clientId, existing?.id);

  let saved: Contact;
  if (existing) {
    const oldClientId = existing.client_id || null;
    const runUpdate = (body: typeof payload) => supabase
      .from('contacts')
      .update(body)
      .eq('id', existing.id)
      .select('*, clients(name)')
      .single();
    let { data, error } = await runUpdate(payload);
    if (isMissingColumnError(error)) ({ data, error } = await runUpdate(withoutOptionalColumns(payload)));
    if (error) throw error;
    saved = data as Contact;

    if (oldClientId !== clientId) {
      await recordClientChange({
        contactId: saved.id, contactName: name,
        fromClientId: oldClientId, toClientId: clientId,
        clientName: ctx.clientName, user: ctx.user,
      });
    }
    await logActivity({
      user: ctx.user, action: 'update', table: 'contacts', recordId: saved.id,
      description: `Cập nhật liên hệ "${name}"`,
      oldData: existing, newData: saved,
    });
  } else {
    const body = { ...payload, created_at: new Date().toISOString() };
    const runInsert = (b: typeof body) => supabase
      .from('contacts')
      .insert(b)
      .select('*, clients(name)')
      .single();
    let { data, error } = await runInsert(body);
    if (isMissingColumnError(error)) ({ data, error } = await runInsert(withoutOptionalColumns(body)));
    if (error) throw error;
    saved = data as Contact;

    if (clientId) {
      await recordClientChange({
        contactId: saved.id, contactName: name,
        fromClientId: null, toClientId: clientId,
        clientName: ctx.clientName, user: ctx.user, note: 'Tạo mới liên hệ',
      });
    }
    await logActivity({
      user: ctx.user, action: 'insert', table: 'contacts', recordId: saved.id,
      description: `Thêm liên hệ "${name}"${clientId ? ` — ${ctx.clientName(clientId)}` : ' (chưa gắn công ty)'}`,
      newData: saved,
    });
  }
  return saved;
}

// ── Gắn / đổi công ty nhanh (không mở form) ─────────────────────────────────
export async function linkContactToClient(
  contact: Contact,
  clientId: string | null,
  ctx: SaveContactCtx
): Promise<Contact> {
  const oldClientId = contact.client_id || null;
  if (oldClientId === clientId) return contact;
  const { data, error } = await supabase
    .from('contacts')
    // Chuyển công ty thì bỏ cờ liên hệ chính — cờ đó thuộc về công ty cũ.
    .update({ client_id: clientId, is_primary: false, updated_at: new Date().toISOString() })
    .eq('id', contact.id)
    .select('*, clients(name)')
    .single();
  if (error) throw error;
  await recordClientChange({
    contactId: contact.id, contactName: contact.name,
    fromClientId: oldClientId, toClientId: clientId,
    clientName: ctx.clientName, user: ctx.user,
  });
  return data as Contact;
}

// ── Đặt liên hệ chính ───────────────────────────────────────────────────────
export async function setPrimaryContact(contact: Contact, ctx: SaveContactCtx): Promise<void> {
  if (!contact.client_id) throw new Error('Liên hệ chưa gắn công ty nên không thể đặt làm liên hệ chính');
  await clearPrimaryElsewhere(contact.client_id, contact.id);
  const { error } = await supabase
    .from('contacts')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', contact.id);
  if (error) throw error;
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Đặt "${contact.name}" làm liên hệ chính của "${ctx.clientName(contact.client_id)}"`,
    oldData: contact, newData: { ...contact, is_primary: true },
  });
}

export async function unsetPrimaryContact(contact: Contact, ctx: SaveContactCtx): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('id', contact.id);
  if (error) throw error;
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Bỏ cờ liên hệ chính của "${contact.name}"`,
    oldData: contact, newData: { ...contact, is_primary: false },
  });
}

// ── Ngưng / mở lại (xoá mềm) ────────────────────────────────────────────────
/** Đánh dấu đã nghỉ: giữ nguyên bản ghi + toàn bộ lịch sử, chỉ đóng mốc thời gian. */
export async function deactivateContact(contact: Contact, ctx: SaveContactCtx): Promise<Contact> {
  const endDate = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('contacts')
    .update({ is_active: false, is_primary: false, end_date: endDate, updated_at: new Date().toISOString() })
    .eq('id', contact.id)
    .select('*, clients(name)')
    .single();
  if (error) throw error;
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Đánh dấu liên hệ "${contact.name}" đã nghỉ (${endDate})`,
    oldData: contact, newData: data,
  });
  return data as Contact;
}

export async function reactivateContact(contact: Contact, ctx: SaveContactCtx): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts')
    .update({ is_active: true, end_date: null, updated_at: new Date().toISOString() })
    .eq('id', contact.id)
    .select('*, clients(name)')
    .single();
  if (error) throw error;
  await logActivity({
    user: ctx.user, action: 'update', table: 'contacts', recordId: contact.id,
    description: `Mở lại liên hệ "${contact.name}" (đang phụ trách)`,
    oldData: contact, newData: data,
  });
  return data as Contact;
}

// ── Xoá vĩnh viễn ───────────────────────────────────────────────────────────
export interface ContactUsage {
  pipeline: number;   // crm_pipeline.contact_id
  deals: number;      // crm_deals.contact_id
  crmGifts: number;   // crm_gifts.recipient_contact_id
  clientGifts: number;// client_gifts.recipient_contact_id
  isPrimary: boolean;
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
    isPrimary: contact.is_primary,
    total: pipeline + deals + crmGifts + clientGifts,
  };
}

/**
 * Xoá vĩnh viễn khỏi bảng contacts.
 * Vẫn khôi phục được: bản ghi cũ nằm trong audit_logs (nút Hoàn tác ở trang
 * Lịch sử) và trong data_history (cỗ máy thời gian).
 */
export async function deleteContact(contact: Contact, ctx: SaveContactCtx): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', contact.id);
  if (error) throw error;
  await logActivity({
    user: ctx.user, action: 'delete', table: 'contacts', recordId: contact.id,
    description: `Xoá vĩnh viễn liên hệ "${contact.name}"${contact.client_id ? ` — ${ctx.clientName(contact.client_id)}` : ''}`,
    oldData: contact,
  });
}

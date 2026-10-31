// ============================================================================
// Ngày lễ & kỷ niệm của công ty khách hàng — đọc / ghi Supabase (migration 185).
// Logic thuần ở lib/cskh/companyDates.ts. Ghi xong gọi emitCskhDataChanged() để
// CSKH, hồ sơ Khách hàng và popup tự tải lại.
// DB chưa chạy 185 → ready = false, mọi nơi hiện lời nhắc chạy migration, không vỡ trang.
// ============================================================================
import { supabase } from './supabase';
import type { AppUser, Client } from './types';
import { isCooperatingClient } from './cskh/seedTiers';
import { emitCskhDataChanged } from './cskh/events';
import {
  buildCompanyAlerts, mapCompanyOccasionRow, mapNationalHolidayRow, mergeCountryNames,
  type CompanyAlert, type CompanyOccasion, type CompanyOccasionRow, type CompanyWritePlan,
  type NationalHoliday, type NationalHolidayRow, type OccasionFieldsWrite,
} from './cskh/companyDates';

export const MIGRATION_185_HINT =
  'Chưa lưu được ngày lễ công ty — cần chạy migration 185 (company_occasions) trên Supabase (SQL Editor).';

type DbError = { message?: string; code?: string } | null;

const isMissingSchema = (err: DbError) =>
  !!err && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205' ||
    /could not find the .* (table|column)|does not exist|schema cache/i.test(err.message || ''));

const writeError = (err: DbError) => new Error(isMissingSchema(err) ? MIGRATION_185_HINT : (err?.message || 'Lỗi không rõ'));

export interface CompanyDatesData {
  /** false = DB chưa chạy migration 185. */
  ready: boolean;
  occasions: CompanyOccasion[];
  holidays: NationalHoliday[];
  /** clients.leader_country theo id công ty (đọc thẳng DB — không phụ thuộc danh sách khách đã tải ở App). */
  countryByClient: Map<string, string | null>;
  /** Quốc gia để chọn: bảng countries (FDI) + nước đã có ngày lễ + nước đang được chọn. */
  countryNames: string[];
}

export const EMPTY_COMPANY_DATES: CompanyDatesData = {
  ready: false, occasions: [], holidays: [], countryByClient: new Map(), countryNames: [],
};

export async function loadCompanyDates(): Promise<CompanyDatesData> {
  const [occRes, holRes, clientRes, countryRes] = await Promise.all([
    supabase.from('client_occasions').select('*').eq('is_archived', false),
    supabase.from('national_holidays').select('*').eq('is_archived', false).order('country').order('month').order('day'),
    supabase.from('clients').select('id, leader_country'),
    supabase.from('countries').select('name'),
  ]);
  for (const r of [occRes, holRes, clientRes]) {
    if (r.error && !isMissingSchema(r.error)) throw r.error;
  }
  const ready = !occRes.error && !holRes.error && !clientRes.error;
  if (!ready) {
    const names = mergeCountryNames(((countryRes.data ?? []) as { name: string }[]).map(c => c.name));
    return { ...EMPTY_COMPANY_DATES, countryNames: names };
  }
  const occasions = ((occRes.data ?? []) as CompanyOccasionRow[]).map(mapCompanyOccasionRow);
  const holidays = ((holRes.data ?? []) as NationalHolidayRow[]).map(mapNationalHolidayRow);
  const clientRows = (clientRes.data ?? []) as { id: string; leader_country: string | null }[];
  const countryByClient = new Map(clientRows.map(r => [r.id, r.leader_country]));
  const countryNames = mergeCountryNames(
    ((countryRes.data ?? []) as { name: string }[]).map(c => c.name),
    holidays.map(h => h.country),
    clientRows.map(r => r.leader_country),
  );
  return { ready, occasions, holidays, countryByClient, countryNames };
}

const toRow = (f: OccasionFieldsWrite) => ({
  kind: f.kind, title: f.title, day: f.day, month: f.month, year: f.year, is_lunar: f.isLunar, note: f.note,
});

/** Ghi kế hoạch của 1 công ty (quốc gia + thêm/sửa/xoá mềm ngày). */
export async function saveCompanyPlan(clientId: string, plan: CompanyWritePlan, user: AppUser | null): Promise<void> {
  if (plan.country !== undefined) {
    const { error } = await supabase.from('clients').update({ leader_country: plan.country }).eq('id', clientId);
    if (error) throw writeError(error);
  }
  if (plan.archives.length > 0) {
    const { error } = await supabase.from('client_occasions').update({ is_archived: true }).in('id', plan.archives);
    if (error) throw writeError(error);
  }
  for (const u of plan.updates) {
    const { error } = await supabase.from('client_occasions').update(toRow(u.fields)).eq('id', u.id);
    if (error) throw writeError(error);
  }
  if (plan.inserts.length > 0) {
    const { error } = await supabase.from('client_occasions')
      .insert(plan.inserts.map(f => ({ ...toRow(f), client_id: clientId, created_by: user?.id ?? null })));
    if (error) throw writeError(error);
  }
}

/** Ghi nhiều công ty; công ty lỗi không chặn công ty khác. Trả về lỗi ("Tên công ty: lỗi") + id công ty lỗi. */
export async function saveCompanyPlans(
  items: readonly { clientId: string; clientName: string; plan: CompanyWritePlan }[],
  user: AppUser | null,
): Promise<{ saved: number; errors: string[]; failedIds: string[] }> {
  let saved = 0;
  const errors: string[] = [];
  const failedIds: string[] = [];
  for (const it of items) {
    try {
      await saveCompanyPlan(it.clientId, it.plan, user);
      saved += 1;
    } catch (e) {
      errors.push(`${it.clientName}: ${(e as Error).message}`);
      failedIds.push(it.clientId);
    }
  }
  if (saved > 0) emitCskhDataChanged();
  return { saved, errors, failedIds };
}

export type HolidayInput = Pick<NationalHoliday, 'country' | 'title' | 'localName' | 'day' | 'month' | 'isLunar' | 'tip'>;

export async function saveNationalHoliday(input: HolidayInput, existingId: string | null): Promise<void> {
  const row = {
    country: input.country.replace(/\s+/g, ' ').trim(),
    title: input.title.replace(/\s+/g, ' ').trim(),
    local_name: input.localName.trim(),
    day: input.day,
    month: input.month,
    is_lunar: input.isLunar,
    tip: input.tip.trim(),
  };
  const { error } = existingId
    ? await supabase.from('national_holidays').update(row).eq('id', existingId)
    : await supabase.from('national_holidays').insert(row);
  if (error) {
    if (error.code === '23505') throw new Error(`${row.country} đã có ngày lễ "${row.title}"`);
    throw writeError(error);
  }
  emitCskhDataChanged();
}

/** Xoá mềm 1 ngày lễ quốc gia (khôi phục được ở Lịch sử). */
export async function archiveNationalHoliday(id: string): Promise<void> {
  const { error } = await supabase.from('national_holidays').update({ is_archived: true }).eq('id', id);
  if (error) throw writeError(error);
  emitCskhDataChanged();
}

/** Popup khi mở app: mốc ngày công ty / ngày lễ quốc gia cần báo hôm nay. null = chưa chạy 185. */
export async function fetchCompanyAlerts(today: string): Promise<CompanyAlert[] | null> {
  const [occRes, holRes, clientRes] = await Promise.all([
    supabase.from('client_occasions').select('*').eq('is_archived', false),
    supabase.from('national_holidays').select('*').eq('is_archived', false),
    supabase.from('clients').select('id, name, leader_country, archived_at, cooperation_status, client_type'),
  ]);
  if (occRes.error || holRes.error || clientRes.error) return null;
  type Row = Pick<Client, 'id' | 'name' | 'archived_at' | 'cooperation_status' | 'client_type'> & { leader_country: string | null };
  const clients = ((clientRes.data ?? []) as Row[])
    .filter(isCooperatingClient)
    .map(c => ({ id: c.id, name: c.name, leaderCountry: c.leader_country }));
  return buildCompanyAlerts({
    clients,
    occasions: ((occRes.data ?? []) as CompanyOccasionRow[]).map(mapCompanyOccasionRow),
    holidays: ((holRes.data ?? []) as NationalHolidayRow[]).map(mapNationalHolidayRow),
    today,
  });
}

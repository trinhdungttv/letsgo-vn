// CRUD + import/export cho dữ liệu mật độ dân số cấp Xã/Phường (bảng population_communes).
// Mô hình hành chính 2 cấp từ 01/07/2025 — không còn cấp Quận/Huyện.

import { supabase } from '../../lib/supabase';

export interface CommuneRow {
  id: string;
  province_new: string;
  province_old: string | null;
  commune_name: string;
  population: number;
  area_km2: number;
  lat: number | null;
  lng: number | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  source_note: string | null;
  created_at: string;
  updated_at: string;
}

export type CommuneInput = Pick<CommuneRow, 'province_new' | 'commune_name' | 'population' | 'area_km2'> &
  Partial<Pick<CommuneRow, 'province_old' | 'lat' | 'lng' | 'source_note'>>;

// 3 tỉnh/thành sau sáp nhập 01/07/2025 đang ưu tiên nhập liệu, kèm các tỉnh cũ hợp thành
// để chọn nhanh khi nhập tay hoặc đối chiếu khi import.
export const FOCUS_PROVINCES: { name: string; oldNames: string[] }[] = [
  { name: 'TP. Hồ Chí Minh', oldNames: ['TP. Hồ Chí Minh (cũ)', 'Bình Dương (cũ)', 'Bà Rịa - Vũng Tàu (cũ)'] },
  { name: 'Tỉnh Đồng Nai', oldNames: ['Đồng Nai (cũ)', 'Bình Phước (cũ)'] },
  { name: 'Tỉnh Tây Ninh', oldNames: ['Tây Ninh (cũ)', 'Long An (cũ)'] },
];

export function densityOfRow(r: Pick<CommuneRow, 'population' | 'area_km2'>): number {
  return r.area_km2 > 0 ? r.population / r.area_km2 : 0;
}

export async function fetchCommunes(): Promise<CommuneRow[]> {
  const { data, error } = await supabase
    .from('population_communes')
    .select('*')
    .order('province_new', { ascending: true })
    .order('commune_name', { ascending: true });
  if (error) throw error;
  return (data as CommuneRow[]) ?? [];
}

export async function addCommune(input: CommuneInput, sourceNote: string): Promise<void> {
  const { error } = await supabase.from('population_communes').insert({ ...input, source_note: sourceNote });
  if (error) throw error;
}

export async function updateCommune(id: string, patch: Partial<CommuneInput>): Promise<void> {
  const { error } = await supabase.from('population_communes').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCommune(id: string): Promise<void> {
  const { error } = await supabase.from('population_communes').delete().eq('id', id);
  if (error) throw error;
}

export async function setCommuneCoords(id: string, lat: number, lng: number): Promise<void> {
  const { error } = await supabase.from('population_communes').update({ lat, lng }).eq('id', id);
  if (error) throw error;
}

export async function setCommuneGeo(
  id: string,
  lat: number,
  lng: number,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
): Promise<void> {
  const { error } = await supabase.from('population_communes').update({ lat, lng, geometry }).eq('id', id);
  if (error) throw error;
}

export async function deleteCommunesByProvince(province_new: string): Promise<void> {
  const { error } = await supabase.from('population_communes').delete().eq('province_new', province_new);
  if (error) throw error;
}

export async function bulkInsertCommunes(rows: CommuneInput[], sourceNote: string): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map(r => ({ ...r, source_note: sourceNote }));
  // Insert theo lô 200 dòng để tránh vượt giới hạn payload của Supabase.
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from('population_communes').insert(payload.slice(i, i + 200));
    if (error) throw error;
  }
}

/**
 * Import kiểu CẬP NHẬT: xã/phường đã có (khớp tỉnh + tên) thì chỉ cập nhật dân số/diện tích,
 * GIỮ NGUYÊN lat/lng + ranh giới (geometry) đã sinh; chưa có thì thêm mới.
 */
export async function mergeCommunes(
  rows: CommuneInput[],
  sourceNote: string,
): Promise<{ inserted: number; updated: number }> {
  const { data, error } = await supabase.from('population_communes').select('id, province_new, commune_name');
  if (error) throw error;
  const keyOf = (p: string, c: string) => `${p.trim().toLowerCase()}||${c.trim().toLowerCase()}`;
  const existing = new Map((data ?? []).map(r => [keyOf(r.province_new, r.commune_name), r.id as string]));
  const toInsert: CommuneInput[] = [];
  let updated = 0;
  for (const r of rows) {
    const id = existing.get(keyOf(r.province_new, r.commune_name));
    if (id) {
      const patch: Record<string, unknown> = {
        population: r.population, area_km2: r.area_km2, source_note: sourceNote,
      };
      if (r.province_old != null) patch.province_old = r.province_old;
      const { error: e } = await supabase.from('population_communes').update(patch).eq('id', id);
      if (e) throw e;
      updated++;
    } else {
      toInsert.push(r);
    }
  }
  await bulkInsertCommunes(toInsert, sourceNote);
  return { inserted: toInsert.length, updated };
}

// ── Import: chấp nhận JSON (mảng object) hoặc CSV (header đúng tên cột) ──

const REQUIRED_FIELDS = ['province_new', 'commune_name', 'population', 'area_km2'] as const;
const OPTIONAL_FIELDS = ['province_old', 'lat', 'lng'] as const;

export interface ParseResult {
  rows: CommuneInput[];
  errors: string[];
}

export function parseImportText(text: string, filename: string): ParseResult {
  const isJson = filename.toLowerCase().endsWith('.json') || text.trim().startsWith('[');
  return isJson ? parseJsonImport(text) : parseCsvImport(text);
}

function parseJsonImport(text: string): ParseResult {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rows: [], errors: ['File JSON không hợp lệ — không parse được.'] };
  }
  if (!Array.isArray(data)) return { rows: [], errors: ['File JSON phải là một mảng (array) các xã/phường.'] };
  const rows: CommuneInput[] = [];
  data.forEach((raw, i) => {
    const row = validateRow(raw as Record<string, unknown>, i + 1);
    if (row.error) errors.push(row.error); else rows.push(row.value!);
  });
  return { rows, errors };
}

function parseCsvImport(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ['File CSV cần ít nhất 1 dòng tiêu đề + 1 dòng dữ liệu.'] };
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const errors: string[] = [];
  const rows: CommuneInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const raw: Record<string, unknown> = {};
    headers.forEach((h, idx) => { raw[h] = cells[idx]; });
    const row = validateRow(raw, i + 1);
    if (row.error) errors.push(row.error); else rows.push(row.value!);
  }
  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function validateRow(raw: Record<string, unknown>, lineNo: number): { value?: CommuneInput; error?: string } {
  for (const f of REQUIRED_FIELDS) {
    if (raw[f] == null || String(raw[f]).trim() === '') {
      return { error: `Dòng ${lineNo}: thiếu cột bắt buộc "${f}"` };
    }
  }
  const population = Number(raw.population);
  const area_km2 = Number(raw.area_km2);
  if (!Number.isFinite(population) || population < 0) {
    return { error: `Dòng ${lineNo}: "population" phải là số >= 0` };
  }
  if (!Number.isFinite(area_km2) || area_km2 <= 0) {
    return { error: `Dòng ${lineNo}: "area_km2" phải là số > 0` };
  }
  const value: CommuneInput = {
    province_new: String(raw.province_new).trim(),
    commune_name: String(raw.commune_name).trim(),
    population: Math.round(population),
    area_km2,
  };
  if (raw.province_old != null && String(raw.province_old).trim() !== '') value.province_old = String(raw.province_old).trim();
  for (const f of ['lat', 'lng'] as const) {
    if (raw[f] != null && String(raw[f]).trim() !== '') {
      const n = Number(raw[f]);
      if (Number.isFinite(n)) value[f] = n;
    }
  }
  return { value };
}

/** File mẫu (CSV) — dùng để tự nhập tay hoặc đưa AI tổng hợp đúng cấu trúc. */
export function templateCsv(): string {
  const header = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].join(',');
  const example = 'TP. Hồ Chí Minh,Phường Bến Nghé,12345,3.21,TP. Hồ Chí Minh (cũ),10.7769,106.7009';
  return `${header}\n${example}\n`;
}

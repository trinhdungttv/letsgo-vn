// 4 preset cấu trúc giờ làm/tháng (SPEC §5.1) — bấm 1 nút ra ngay sản lượng thường gặp, thay vì
// gõ tay 13 ô. Preset phụ thuộc số ngày công nên là HÀM, không phải hằng số.
import type { VolumeProfile, WageCode } from './types';

export interface VolumePreset {
  id: string;
  name: string;
  hint: string;
  build: (workdaysPerMonth: number) => Partial<Record<WageCode, number>>;
}

export const VOLUME_PRESETS: VolumePreset[] = [
  {
    id: 'office_no_ot',
    name: 'Hành chính, không OT',
    hint: 'Chỉ ca ngày 8h, không tăng ca',
    build: wd => ({ day_wage_8h: wd }),
  },
  {
    id: 'day_plus_2h_ot',
    name: 'Ca 8h + 2h OT (phổ biến)',
    hint: '26 ca ngày · 52h OT thường · 8h OT Chủ nhật',
    build: wd => ({ day_wage_8h: wd, ot_day_weekday: wd * 2, ot_day_sunday: 8 }),
  },
  {
    id: 'night_plus_2h_ot',
    name: 'Ca đêm 8h + 2h OT',
    hint: '26 ca đêm · 52h OT đêm',
    build: wd => ({ night_wage_8h: wd, ot_night_weekday: wd * 2 }),
  },
  {
    id: 'shift12_rotating',
    name: 'Ca 12h luân phiên 4/4',
    hint: 'Chia đôi ngày/đêm',
    build: wd => ({ shift12_day: Math.floor(wd / 2), shift12_night: Math.ceil(wd / 2) }),
  },
];

export const presetById = (id: string): VolumePreset | undefined =>
  VOLUME_PRESETS.find(p => p.id === id);

export function applyPreset(id: string, workdaysPerMonth: number): VolumeProfile {
  const p = presetById(id);
  return {
    id,
    name: p?.name ?? 'Tuỳ chỉnh',
    quantities: p ? p.build(workdaysPerMonth) : {},
  };
}

/** Preset mặc định khi migrate nháp v1 (§8) — v1 không có khối sản lượng nào cả. */
export const DEFAULT_VOLUME_PRESET_ID = 'office_no_ot';

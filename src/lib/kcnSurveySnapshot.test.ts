import { describe, it, expect } from 'vitest'
import {
  addCompetitorEntry, buildInitialCompetitorEntries, buildWageSnapshot, cleanWageEntries, competitorPresence,
  competitorSnapshotToText, competitorsToRecord, foldSnapshotIntoNote, formatWageRange, isMissingSnapshotColumnError,
  newManualWageEntry, parseCompetitorSnapshot, parseWageSnapshot, pickableCompetitors, removeCompetitorEntry,
  setCompetitorEntryNote, setWageEntryField, trInputToVnd, vndToTrInput, wageSnapshotToText,
  type SurveyCompetitorEntry,
} from './kcnSurveySnapshot'

const comp = (id: string, company_name: string, zone_name: string | null = null, active_zones: string[] | null = null) =>
  ({ id, company_name, zone_name, active_zones })

const ZONE = 'KCN Tân Bình'
const competitors = [
  comp('a', 'Đồng Hưng', 'KCN Tân Bình'),                          // chỉ là trụ sở (ví dụ của user)
  comp('b', 'Alpha', 'Hà Nội', ['Tân Bình', 'KCN Long Bình']),      // đã ghi nhận, tên gõ lệch tiền tố
  comp('c', 'Beta', 'Bình Dương'),                                  // không liên quan KCN này
  comp('d', 'Gamma', null, null),                                   // chỉ có nhà máy trong KCN
  comp('e', 'Zeta', 'Toàn quốc', ['KCN Tân Phú Trung']),            // "Tân Phú Trung" ≠ "Tân Bình"
]
const supply = [
  { competitor_id: 'd', kcn: 'KCN TÂN BÌNH', worker_count: 120 },
  { competitor_id: 'd', kcn: 'Tân Bình', worker_count: 30 },
  { competitor_id: 'c', kcn: 'KCN Sóng Thần', worker_count: 500 },
  { competitor_id: 'b', kcn: '', zones: ['KCN Tân Bình', 'KCN Khác'], worker_count: 10 }, // dòng suy ra từ thẻ công ty
]

describe('đối thủ tại KCN — cùng 3 tín hiệu với trang Thị trường', () => {
  it('nhận ra ghi nhận / trụ sở / đang cung ứng, so khớp tên KCN chặt', () => {
    expect(competitorPresence(ZONE, competitors[0], supply)).toEqual({ signals: ['hq'], workers: 0 })
    expect(competitorPresence(ZONE, competitors[1], supply)).toEqual({ signals: ['recorded', 'supplying'], workers: 10 })
    expect(competitorPresence(ZONE, competitors[3], supply)).toEqual({ signals: ['supplying'], workers: 150 })
    expect(competitorPresence(ZONE, competitors[2], supply).signals).toEqual([])
    expect(competitorPresence(ZONE, competitors[4], supply).signals).toEqual([])
  })

  it('danh sách mặc định: đã ghi nhận trước, rồi nhiều LĐ, rồi theo tên; bỏ đối thủ không liên quan', () => {
    const list = buildInitialCompetitorEntries(ZONE, competitors, supply)
    expect(list.map(e => e.name)).toEqual(['Alpha', 'Gamma', 'Đồng Hưng'])
    expect(list.every(e => e.note === '')).toBe(true)
  })

  it('KCN không có đối thủ nào → danh sách rỗng', () => {
    expect(buildInitialCompetitorEntries('KCN Lạ', competitors, supply)).toEqual([])
  })

  it('bỏ chọn / thêm đối thủ khác / sửa ghi chú, không trùng', () => {
    let list = buildInitialCompetitorEntries(ZONE, competitors, supply)
    list = removeCompetitorEntry(list, 'a')
    expect(list.map(e => e.id)).toEqual(['b', 'd'])
    list = addCompetitorEntry(list, competitors[2], ZONE, supply)   // Beta: chưa có tín hiệu ở KCN này
    expect(list[list.length - 1]).toMatchObject({ id: 'c', signals: ['added'], workers: 0 })
    expect(addCompetitorEntry(list, competitors[2], ZONE, supply)).toBe(list)   // thêm lần 2 không đổi
    list = addCompetitorEntry(list, competitors[0], ZONE, supply)   // thêm lại Đồng Hưng → có lại tín hiệu thật
    expect(list[list.length - 1].signals).toEqual(['hq'])
    list = setCompetitorEntryNote(list, 'c', 'tuyển gấp 200 LĐ')
    expect(list.find(e => e.id === 'c')?.note).toBe('tuyển gấp 200 LĐ')
    expect(list.find(e => e.id === 'b')?.note).toBe('')
  })

  it('hộp chọn: ẩn đối thủ đã có, lọc không dấu, đối thủ có mặt ở KCN (vừa bỏ chọn) lên đầu', () => {
    const list = removeCompetitorEntry(buildInitialCompetitorEntries(ZONE, competitors, supply), 'a')
    expect(pickableCompetitors(competitors, list, ZONE, '').map(c => c.id)).toEqual(['a', 'c', 'e'])
    expect(pickableCompetitors(competitors, list, ZONE, 'dong hung').map(c => c.id)).toEqual(['a'])
    expect(pickableCompetitors(competitors, list, ZONE, 'ZETA').map(c => c.id)).toEqual(['e'])
    expect(pickableCompetitors(competitors, list, ZONE, 'không có').length).toBe(0)
  })

  it('ghi ngược Thị trường: chỉ đối thủ CHƯA có tên KCN, và chỉ thêm — không bao giờ bớt active_zones', () => {
    const list = buildInitialCompetitorEntries(ZONE, competitors, supply)
    const todo = competitorsToRecord(list, competitors, ZONE)
    expect(todo.map(t => t.id).sort()).toEqual(['a', 'd'])   // 'b' đã ghi nhận
    for (const t of todo) {
      const c = competitors.find(x => x.id === t.id)!
      expect(t.nextZones).toEqual([...(c.active_zones ?? []), ZONE])
    }
    // bỏ chọn trong báo cáo không đụng tới active_zones của ai
    expect(competitorsToRecord(removeCompetitorEntry(list, 'b'), competitors, ZONE).map(t => t.id).sort()).toEqual(['a', 'd'])
    // hồ sơ đối thủ đã bị xoá → bỏ qua
    expect(competitorsToRecord(list, competitors.filter(c => c.id !== 'a'), ZONE).map(t => t.id)).toEqual(['d'])
  })

  it('đọc / ghi snapshot: null = báo cáo cũ, [] = đi khảo sát không thấy đối thủ; rác bị bỏ', () => {
    expect(parseCompetitorSnapshot(null)).toBeNull()
    expect(parseCompetitorSnapshot(undefined)).toBeNull()
    expect(parseCompetitorSnapshot('chữ')).toBeNull()
    expect(parseCompetitorSnapshot([])).toEqual([])
    const entries: SurveyCompetitorEntry[] = [{ id: 'a', name: 'Đồng Hưng', note: 'x', signals: ['hq'], workers: 0 }]
    expect(parseCompetitorSnapshot(JSON.parse(JSON.stringify(entries)))).toEqual(entries)
    expect(parseCompetitorSnapshot([{ id: 1 }, null, { id: 'z', name: 'Z', signals: ['lạ'], workers: -5 }]))
      .toEqual([{ id: 'z', name: 'Z', note: '', signals: ['added'], workers: 0 }])
  })

  it('ảnh chụp là bản sao: đổi dữ liệu Thị trường về sau không làm đổi báo cáo đã lưu', () => {
    const stored = JSON.parse(JSON.stringify(buildInitialCompetitorEntries(ZONE, competitors, supply)))
    const later = competitors.filter(c => c.id === 'b')   // tháng sau chỉ còn 1 đối thủ
    expect(buildInitialCompetitorEntries(ZONE, later, supply).length).toBe(1)
    expect(parseCompetitorSnapshot(stored)?.map(e => e.name)).toEqual(['Alpha', 'Gamma', 'Đồng Hưng'])
  })

  it('xuất chữ cho từng đối thủ', () => {
    const txt = competitorSnapshotToText([
      { id: 'a', name: 'Đồng Hưng', note: '', signals: ['hq'], workers: 0 },
      { id: 'd', name: 'Gamma', note: 'tuyển gấp', signals: ['recorded', 'supplying'], workers: 150 },
      { id: 'c', name: 'Beta', note: '', signals: ['added'], workers: 0 },
    ])
    expect(txt).toBe('• Đồng Hưng (trụ sở / KV chính, chưa ghi nhận ở Thị trường)\n• Gamma (150 LĐ tại KCN) — tuyển gấp\n• Beta')
  })
})

const survey = (zone_name: string, industry: string | null, survey_date: string, over: Record<string, unknown> = {}) => ({
  zone_name, industry, survey_date, labor_availability: 'Dồi dào',
  wage_unskilled_min: 6_000_000, wage_unskilled_max: 7_000_000,
  wage_seasonal_min: null, wage_seasonal_max: null,
  wage_skilled_min: 8_500_000, wage_skilled_max: null, ...over,
})

describe('Lương TT của KCN', () => {
  it('lấy đúng KCN (khớp bỏ tiền tố), mỗi ngành bản mới nhất, xếp theo tên ngành', () => {
    const rows = buildWageSnapshot('KCN Tân Bình', [
      survey('Tân Bình', 'Điện tử', '2026-01-10', { wage_unskilled_min: 5_500_000 }),
      survey('KCN Tân Bình', 'Điện tử', '2026-09-01'),
      survey('KCN Tân Bình', 'Dệt may', '2026-03-05', { labor_availability: 'Khan hiếm' }),
      survey('KCN Tân Phú Trung', 'Điện tử', '2026-09-02'),
    ])
    expect(rows.map(r => r.industry)).toEqual(['Dệt may', 'Điện tử'])
    expect(rows[1]).toMatchObject({ unskilled_min: 6_000_000, survey_date: '2026-09-01', source: 'market' })
    expect(rows[0].labor_availability).toBe('Khan hiếm')
  })

  it('KCN chưa có dữ liệu lương → rỗng (UI báo "Chưa có dữ liệu lương")', () => {
    expect(buildWageSnapshot('KCN Tân Bình', [survey('KCN Khác', 'Điện tử', '2026-01-01')])).toEqual([])
    expect(buildWageSnapshot('KCN Tân Bình', [])).toEqual([])
  })

  it('đổi đơn vị triệu ↔ đồng', () => {
    expect(trInputToVnd('7.5')).toBe(7_500_000)
    expect(trInputToVnd(' 7,5 ')).toBe(7_500_000)
    expect(trInputToVnd('7.35')).toBe(7_350_000)
    expect(trInputToVnd('')).toBeNull()
    expect(trInputToVnd('abc')).toBeNull()
    expect(trInputToVnd('-3')).toBeNull()
    expect(vndToTrInput(7_500_000)).toBe('7.5')
    expect(vndToTrInput(6_000_000)).toBe('6')
    expect(vndToTrInput(null)).toBe('')
    expect(formatWageRange(6_000_000, 7_200_000)).toBe('6 – 7.2tr')
    expect(formatWageRange(6_000_000, 6_000_000)).toBe('6tr')
    expect(formatWageRange(null, 7_000_000)).toBe('7tr')
    expect(formatWageRange(null, null)).toBe('—')
  })

  it('sửa số trong báo cáo: đánh dấu đã chỉnh, không đụng bản gốc; dòng nhập tay thêm / dọn dòng trống', () => {
    const base = buildWageSnapshot('KCN Tân Bình', [survey('KCN Tân Bình', 'Điện tử', '2026-09-01')])
    const next = setWageEntryField(base, 0, { unskilled_max: 7_200_000 })
    expect(next[0]).toMatchObject({ unskilled_max: 7_200_000, edited: true })
    expect(base[0].unskilled_max).toBe(7_000_000)
    expect(base[0].edited).toBeUndefined()
    const withManual = [...next, newManualWageEntry('Cơ khí'), newManualWageEntry('   '), { ...newManualWageEntry(''), seasonal_min: 5_000_000 }]
    expect(cleanWageEntries(withManual).map(e => e.industry)).toEqual(['Điện tử', 'Cơ khí', ''])
    expect(setWageEntryField([newManualWageEntry('Cơ khí')], 0, { skilled_min: 9_000_000 })[0].edited).toBeUndefined()
  })

  it('đọc snapshot lương cũ/rác an toàn', () => {
    expect(parseWageSnapshot(null)).toBeNull()
    const rows = buildWageSnapshot('KCN Tân Bình', [survey('KCN Tân Bình', 'Điện tử', '2026-09-01')])
    expect(parseWageSnapshot(JSON.parse(JSON.stringify(rows)))).toEqual(rows)
    expect(parseWageSnapshot([{ industry: 5, unskilled_min: 'x', source: 'manual' }]))
      .toEqual([{ ...newManualWageEntry(''), industry: '' }])
  })

  it('xuất chữ', () => {
    const rows = buildWageSnapshot('KCN Tân Bình', [survey('KCN Tân Bình', 'Điện tử', '2026-09-01')])
    expect(wageSnapshotToText(rows)).toBe('• Điện tử: PT 6 – 7tr · TV — · CT 8.5tr · nguồn LĐ Dồi dào')
  })
})

describe('chạy được khi chưa có migration 176', () => {
  it('nhận ra lỗi thiếu cột snapshot, không nhầm với lỗi khác', () => {
    expect(isMissingSnapshotColumnError({ code: 'PGRST204', message: "Could not find the 'wage_snapshot' column of 'kcn_visits' in the schema cache" })).toBe(true)
    expect(isMissingSnapshotColumnError({ code: '42703', message: 'column "competitors_snapshot" of relation "kcn_visits" does not exist' })).toBe(true)
    expect(isMissingSnapshotColumnError({ code: '23503', message: 'violates foreign key constraint' })).toBe(false)
    expect(isMissingSnapshotColumnError({ code: '42703', message: 'column "foo" does not exist' })).toBe(false)
    expect(isMissingSnapshotColumnError(null)).toBe(false)
  })

  it('gộp chữ vào ghi chú, giữ nguyên ghi chú cũ', () => {
    expect(foldSnapshotIntoNote('', 'Đối thủ', '• A')).toBe('— Đối thủ —\n• A')
    expect(foldSnapshotIntoNote('Ghi chú tay', 'Đối thủ', '• A')).toBe('Ghi chú tay\n\n— Đối thủ —\n• A')
    expect(foldSnapshotIntoNote('Ghi chú tay', 'Đối thủ', '  ')).toBe('Ghi chú tay')
  })
})

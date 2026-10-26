import { describe, it, expect } from 'vitest'
import {
  addCompetitorEntry, addIndustryEntry, assignIndustryEntry, buildInitialCompetitorEntries, buildWageSnapshot,
  cleanWageEntries, competitorPresence, competitorSnapshotToText, competitorsToRecord, emptyWageEntry,
  foldSnapshotIntoNote, formatDong, formatDongRange, formatWageRange, hasLegacyUnskilled, industryKey,
  isMissingBase8hColumnError, isMissingSnapshotColumnError, isSyncableWageEntry, matchIndustry, parseCompetitorSnapshot, parseDongInput, planWageSync, parseWageSnapshot, pickableCompetitors, pickableIndustries, removeCompetitorEntry,
  setCompetitorEntryNote, setWageEntryField, trInputToVnd, vndToTrInput, wageSnapshotToText, withoutBase8h,
  type IndustryOption, type SurveyCompetitorEntry,
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
  wage_seasonal_min: 6_500_000, wage_seasonal_max: 7_500_000,
  wage_skilled_min: 8_500_000, wage_skilled_max: null, ...over,
})

describe('Lương TT của KCN', () => {
  it('lấy đúng KCN (khớp bỏ tiền tố), mỗi ngành bản mới nhất, xếp theo tên ngành', () => {
    const rows = buildWageSnapshot('KCN Tân Bình', [
      survey('Tân Bình', 'Điện tử', '2026-01-10', { wage_seasonal_min: 5_500_000 }),
      survey('KCN Tân Bình', 'Điện tử', '2026-09-01'),
      survey('KCN Tân Bình', 'Dệt may', '2026-03-05', { labor_availability: 'Khan hiếm' }),
      survey('KCN Tân Phú Trung', 'Điện tử', '2026-09-02'),
    ])
    expect(rows.map(r => r.industry)).toEqual(['Dệt may', 'Điện tử'])
    expect(rows[1]).toMatchObject({ seasonal_min: 6_500_000, seasonal_max: 7_500_000, skilled_min: 8_500_000, survey_date: '2026-09-01', source: 'market' })
    // Thị trường chưa có cột lương cơ bản 8h → để trống; lương phổ thông không đưa vào dòng mới
    expect(rows[1]).toMatchObject({ base_wage_8h_min: null, base_wage_8h_max: null, unskilled_min: null, unskilled_max: null })
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
    const next = setWageEntryField(base, 0, { seasonal_max: 7_200_000, base_wage_8h_min: 260_000, base_wage_8h_max: 280_000 })
    expect(next[0]).toMatchObject({ seasonal_max: 7_200_000, base_wage_8h_min: 260_000, base_wage_8h_max: 280_000, edited: true })
    expect(base[0].seasonal_max).toBe(7_500_000)
    expect(base[0].base_wage_8h_min).toBeNull()
    expect(base[0].edited).toBeUndefined()
    const manual = emptyWageEntry({ id: 'i-ck', name: 'Cơ khí & Chế tạo' })
    const withManual = [...next, manual, { ...emptyWageEntry({ id: null, name: '   ' }) }, { ...emptyWageEntry({ id: null, name: '' }), seasonal_min: 5_000_000 }]
    expect(cleanWageEntries(withManual).map(e => e.industry)).toEqual(['Điện tử', 'Cơ khí & Chế tạo', ''])
    expect(setWageEntryField([manual], 0, { skilled_min: 9_000_000 })[0].edited).toBeUndefined()
  })

  it('đọc snapshot lương cũ/rác an toàn', () => {
    expect(parseWageSnapshot(null)).toBeNull()
    const rows = buildWageSnapshot('KCN Tân Bình', [survey('KCN Tân Bình', 'Điện tử', '2026-09-01')])
    expect(parseWageSnapshot(JSON.parse(JSON.stringify(rows)))).toEqual(rows)
    expect(parseWageSnapshot([{ industry: 5, unskilled_min: 'x', source: 'manual' }]))
      .toEqual([{ ...emptyWageEntry({ id: null, name: '' }) }])
  })

  it('xuất chữ', () => {
    const rows = buildWageSnapshot('KCN Tân Bình', [survey('KCN Tân Bình', 'Điện tử', '2026-09-01')])
    expect(wageSnapshotToText(rows)).toBe('• Điện tử: lương cơ bản 8h — · thực nhận TB thời vụ 6.5 – 7.5tr · chính thức 8.5tr · nguồn LĐ Dồi dào')
    expect(wageSnapshotToText(setWageEntryField(rows, 0, { base_wage_8h_min: 260_000, base_wage_8h_max: 280_000, skilled_min: null, skilled_max: null }))).toBe('• Điện tử: lương cơ bản 8h 260.000 – 280.000đ/ngày · thực nhận TB thời vụ 6.5 – 7.5tr · nguồn LĐ Dồi dào')
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

const INDUSTRIES: IndustryOption[] = [
  { id: 'i-dt', name: 'Lắp ráp linh kiện điện tử' },
  { id: 'i-mm', name: 'May mặc & Giày da' },
  { id: 'i-ck', name: 'Cơ khí & Chế tạo' },
  { id: 'i-dp', name: 'Dược phẩm' },
]
const ZONE_TB = 'KCN Tân Bình'
const wsurveys = [
  survey('Tân Bình', 'lắp ráp  linh kiện điện tử', '2026-01-10', { wage_seasonal_min: 5_500_000 }),   // lệch hoa/thường + khoảng trắng
  survey('KCN Tân Bình', 'Lắp ráp linh kiện điện tử', '2026-09-01'),
  survey('KCN Tân Bình', 'May mặc & Giày da', '2026-03-05', { labor_availability: 'Khan hiếm' }),
  survey('KCN Tân Bình', 'Ngành gõ tay lạ', '2026-04-01'),                                              // không có trong Ngành Nghề
  survey('KCN Khác', 'Cơ khí & Chế tạo', '2026-09-02'),                                                  // KCN khác
]

describe('chọn ngành từ Ngành Nghề + Lương TT đúng KCN và ngành', () => {
  it('so khớp ngành: bỏ dấu, hoa/thường, khoảng trắng; tên rỗng không khớp gì', () => {
    expect(industryKey('  MAY  mặc & Giày da ')).toBe('may mac & giay da')
    expect(matchIndustry('may mặc & giày DA', INDUSTRIES)?.id).toBe('i-mm')
    expect(matchIndustry('Đóng gói', INDUSTRIES)).toBeNull()
    expect(matchIndustry('', INDUSTRIES)).toBeNull()
    expect(matchIndustry(null, [{ id: 'x', name: '' }])).toBeNull()
  })

  it('dòng tự điền lúc mở form được gắn id ngành; ngành lạ giữ nguyên tên với id null', () => {
    const rows = buildWageSnapshot(ZONE_TB, wsurveys, INDUSTRIES)
    expect(rows.map(r => [r.industry, r.industry_id])).toEqual([
      ['Lắp ráp linh kiện điện tử', 'i-dt'],   // tên chuẩn lấy theo Ngành Nghề, bản mới nhất
      ['May mặc & Giày da', 'i-mm'],
      ['Ngành gõ tay lạ', null],
    ])
    expect(rows[0]).toMatchObject({ survey_date: '2026-09-01', seasonal_min: 6_500_000, source: 'market' })
  })

  it('hộp chọn ngành: ẩn ngành đã có trong báo cáo, tìm không dấu, xếp theo tên', () => {
    const rows = buildWageSnapshot(ZONE_TB, wsurveys, INDUSTRIES)
    expect(pickableIndustries(INDUSTRIES, rows, '').map(i => i.id)).toEqual(['i-ck', 'i-dp'])
    expect(pickableIndustries(INDUSTRIES, [], 'duoc pham').map(i => i.id)).toEqual(['i-dp'])
    expect(pickableIndustries(INDUSTRIES, [], 'xyz')).toEqual([])
  })

  it('thêm ngành: tự điền Lương TT của ĐÚNG KCN + ngành; không có số cho cặp này → dòng trống nhập tay', () => {
    const withData = addIndustryEntry([], INDUSTRIES[1], ZONE_TB, wsurveys)
    expect(withData[0]).toMatchObject({ industry_id: 'i-mm', industry: 'May mặc & Giày da', source: 'market', labor_availability: 'Khan hiếm', seasonal_min: 6_500_000 })

    // Cơ khí chỉ có số ở KCN khác → KHÔNG mượn số của KCN khác
    const noData = addIndustryEntry([], INDUSTRIES[2], ZONE_TB, wsurveys)
    expect(noData[0]).toEqual(emptyWageEntry(INDUSTRIES[2]))
    expect(noData[0]).toMatchObject({ source: 'manual', base_wage_8h_min: null, base_wage_8h_max: null, seasonal_min: null })
    // Dược phẩm: không có ở đâu cả
    expect(addIndustryEntry([], INDUSTRIES[3], ZONE_TB, wsurveys)[0].source).toBe('manual')
  })

  it('không cho trùng ngành trong cùng báo cáo (theo id hoặc theo tên của dòng chưa có id)', () => {
    const once = addIndustryEntry([], INDUSTRIES[1], ZONE_TB, wsurveys)
    expect(addIndustryEntry(once, INDUSTRIES[1], ZONE_TB, wsurveys)).toBe(once)
    const legacy = [{ ...emptyWageEntry({ id: null, name: 'may mac & giay da' }) }]   // dòng cũ chưa có id, tên khớp
    expect(addIndustryEntry(legacy, INDUSTRIES[1], ZONE_TB, wsurveys)).toBe(legacy)
  })

  it('gắn lại ngành cho dòng chưa khớp: giữ số đã có, dòng trống thì tự điền; không trùng dòng khác', () => {
    const rows = buildWageSnapshot(ZONE_TB, wsurveys, INDUSTRIES)               // [điện tử, may mặc, ngành lạ(id null)]
    const re = assignIndustryEntry(rows, 2, INDUSTRIES[2], ZONE_TB, wsurveys)   // gắn "Ngành gõ tay lạ" → Cơ khí
    expect(re[2]).toMatchObject({ industry_id: 'i-ck', industry: 'Cơ khí & Chế tạo', seasonal_min: 6_500_000, source: 'market' })   // số lương cũ của dòng được giữ
    expect(assignIndustryEntry(rows, 2, INDUSTRIES[0], ZONE_TB, wsurveys)).toBe(rows)   // điện tử đã có ở dòng 0
    // dòng trống → điền theo Lương TT của ngành mới
    const empty = [emptyWageEntry({ id: null, name: 'Chưa rõ' })]
    expect(assignIndustryEntry(empty, 0, INDUSTRIES[1], ZONE_TB, wsurveys)[0]).toMatchObject({ industry_id: 'i-mm', source: 'market', seasonal_min: 6_500_000 })
    // chỉ số không tồn tại → không đổi
    expect(assignIndustryEntry(rows, 9, INDUSTRIES[3], ZONE_TB, wsurveys)).toBe(rows)
  })

  it('bản lưu giữ id + tên ngành lúc đó: ngành đổi tên về sau báo cáo vẫn đọc đúng; bản cũ chỉ có tên chữ vẫn hiện', () => {
    const stored = JSON.parse(JSON.stringify(addIndustryEntry([], INDUSTRIES[1], ZONE_TB, wsurveys)))
    const renamed = INDUSTRIES.map(i => (i.id === 'i-mm' ? { ...i, name: 'May mặc, Giày da, Túi xách' } : i))
    expect(matchIndustry('May mặc & Giày da', renamed)).toBeNull()           // tên cũ không còn khớp tên mới…
    expect(parseWageSnapshot(stored)?.[0]).toMatchObject({ industry_id: 'i-mm', industry: 'May mặc & Giày da' })   // …nhưng báo cáo vẫn giữ id + tên cũ

    const oldFormat = [{ industry: 'Điện tử', unskilled_min: 6_000_000, source: 'market' }]   // bản lưu trước khi có id
    expect(parseWageSnapshot(oldFormat)?.[0]).toMatchObject({ industry_id: null, industry: 'Điện tử', unskilled_min: 6_000_000 })
    expect(wageSnapshotToText(parseWageSnapshot(oldFormat)!)).toContain('• Điện tử:')
  })
})

describe('lương cơ bản 8h + bỏ lương phổ thông', () => {
  it('8h là khoảng ĐỒNG/ngày có cấu trúc, lưu và đọc lại đúng (số, không phải chữ)', () => {
    const rows = setWageEntryField(addIndustryEntry([], INDUSTRIES[0], ZONE_TB, wsurveys), 0, {
      base_wage_8h_min: parseDongInput('260.000'), base_wage_8h_max: parseDongInput('280.000'),
    })
    expect(rows[0]).toMatchObject({ base_wage_8h_min: 260_000, base_wage_8h_max: 280_000 })
    const stored = JSON.parse(JSON.stringify(rows))
    expect(stored[0].base_wage_8h_min).toBe(260_000)
    expect(stored[0].base_wage_8h_max).toBe(280_000)
    expect(parseWageSnapshot(stored)?.[0]).toMatchObject({ base_wage_8h_min: 260_000, base_wage_8h_max: 280_000 })
    expect(parseWageSnapshot([{ industry: 'X', base_wage_8h_min: '260.000', base_wage_8h_max: null }])?.[0]).toMatchObject({ base_wage_8h_min: null, base_wage_8h_max: null })   // chữ rác → null
  })

  it('ô nhập đồng: nhận 260.000 / 260,000 / 260000 / 260 (= 260 nghìn); rỗng, 0, chữ → null', () => {
    for (const t of ['260.000', '260,000', '260000', ' 260 000 ', '260']) expect(parseDongInput(t), t).toBe(260_000)
    expect(parseDongInput('260,5')).toBe(260_500)
    expect(parseDongInput('1.250.000')).toBe(1_250_000)
    for (const t of ['', '   ', '0', 'abc', '-']) expect(parseDongInput(t), t).toBeNull()
  })

  it('định dạng đồng có dấu chấm ngăn nghìn; khoảng 1 đầu / 2 đầu / trống', () => {
    expect(formatDong(260_000)).toBe('260.000')
    expect(formatDong(1_250_000)).toBe('1.250.000')
    expect(formatDong(950)).toBe('950')
    expect(formatDong(null)).toBe('')
    expect(parseDongInput(formatDong(1_250_000))).toBe(1_250_000)   // định dạng rồi đọc lại không đổi số
    expect(formatDongRange(260_000, 280_000)).toBe('260.000 – 280.000đ')
    expect(formatDongRange(260_000, 260_000)).toBe('260.000đ')
    expect(formatDongRange(null, 280_000)).toBe('280.000đ')
    expect(formatDongRange(null, null)).toBe('—')
  })

  it('dòng mới (từ Lương TT hoặc nhập tay) không còn mang lương phổ thông', () => {
    const fromMarket = addIndustryEntry([], INDUSTRIES[1], ZONE_TB, wsurveys)[0]
    const manual = emptyWageEntry(INDUSTRIES[3])
    for (const e of [fromMarket, manual]) {
      expect(e.unskilled_min).toBeNull()
      expect(e.unskilled_max).toBeNull()
    }
    expect(hasLegacyUnskilled(fromMarket)).toBe(false)
  })

  it('báo cáo cũ có Phổ thông vẫn đọc nguyên vẹn, không mất dữ liệu và vẫn lưu lại được', () => {
    const old = [{
      industry: 'Sản xuất nội thất', industry_id: 'i-nt', unskilled_min: 6_000_000, unskilled_max: 7_000_000,
      seasonal_min: 7_000_000, seasonal_max: 8_000_000, skilled_min: 9_000_000, skilled_max: 10_000_000,
      labor_availability: 'Dồi dào', survey_date: '2026-09-01', source: 'market',
    }]
    const parsed = parseWageSnapshot(old)!
    expect(parsed[0]).toMatchObject({ unskilled_min: 6_000_000, unskilled_max: 7_000_000, seasonal_min: 7_000_000, skilled_max: 10_000_000, base_wage_8h_min: null, base_wage_8h_max: null })
    expect(hasLegacyUnskilled(parsed[0])).toBe(true)
    expect(wageSnapshotToText(parsed)).toContain('phổ thông 6 – 7tr')
    expect(cleanWageEntries(parsed)[0].unskilled_max).toBe(7_000_000)                  // lưu lại không làm rơi trường cũ
    expect(parseWageSnapshot(JSON.parse(JSON.stringify(cleanWageEntries(parsed))))).toEqual(parsed)
  })

  it('gắn lại ngành: dòng chỉ có 8h/thời vụ do người dùng nhập thì giữ số, không bị Lương TT đè', () => {
    const typed = setWageEntryField([emptyWageEntry({ id: null, name: 'Chưa rõ' })], 0, { base_wage_8h_min: 260_000, base_wage_8h_max: 280_000 })
    const re = assignIndustryEntry(typed, 0, INDUSTRIES[1], ZONE_TB, wsurveys)
    expect(re[0]).toMatchObject({ industry_id: 'i-mm', base_wage_8h_min: 260_000, base_wage_8h_max: 280_000, source: 'manual', seasonal_min: null })
  })
})

describe('ghi lương của báo cáo sang Lương TT', () => {
  const noiThat: IndustryOption = { id: 'i-nt', name: 'Sản xuất nội thất' }
  // đúng như báo cáo thật của KCN Tân Bình: nhập tay, 8h 240–270k, thời vụ 9–11tr, khan hiếm
  const typed = setWageEntryField([emptyWageEntry(noiThat)], 0, {
    base_wage_8h_min: 240_000, base_wage_8h_max: 270_000, seasonal_min: 9_000_000, seasonal_max: 11_000_000,
  }).map(e => ({ ...e, labor_availability: 'Khan hiếm' }))
  const NOTE = 'Từ báo cáo khảo sát KCN ngày 16/10/2026'

  it('dòng nhập tay có số → thêm 1 dòng Lương TT đúng KCN + ngành + ngày đi, đúng đơn vị', () => {
    const plan = planWageSync(typed, [], ZONE_TB, '2026-10-16', NOTE)
    expect(plan.updates).toEqual([])
    expect(plan.inserts).toEqual([{
      zone_name: ZONE_TB, industry: 'Sản xuất nội thất', survey_date: '2026-10-16', labor_availability: 'Khan hiếm', notes: NOTE,
      wage_seasonal_min: 9_000_000, wage_seasonal_max: 11_000_000, wage_skilled_min: null, wage_skilled_max: null,
      wage_base_8h_min: 240_000, wage_base_8h_max: 270_000,
    }])
  })

  it('chỉ ghi dòng người dùng nhập / chỉnh: dòng lấy nguyên từ Lương TT hoặc dòng trống thì bỏ qua', () => {
    const fromMarket = addIndustryEntry([], INDUSTRIES[1], ZONE_TB, wsurveys)                       // lấy nguyên từ Lương TT
    const empty = [emptyWageEntry(INDUSTRIES[3])]                                                   // chọn ngành nhưng chưa nhập số
    expect(planWageSync([...fromMarket, ...empty], [], ZONE_TB, '2026-10-16', NOTE)).toEqual({ inserts: [], updates: [] })
    expect(isSyncableWageEntry(fromMarket[0])).toBe(false)
    expect(isSyncableWageEntry(empty[0])).toBe(false)
    const edited = setWageEntryField(fromMarket, 0, { base_wage_8h_min: 250_000 })                   // lấy từ Lương TT rồi thêm số 8h
    expect(isSyncableWageEntry(edited[0])).toBe(true)
    expect(planWageSync(edited, [], ZONE_TB, '2026-10-16', NOTE).inserts[0]).toMatchObject({
      industry: 'May mặc & Giày da', wage_base_8h_min: 250_000, wage_seasonal_min: 6_500_000,        // giữ cả số thời vụ lấy từ Lương TT
    })
  })

  it('ghi lần 2 (hoặc báo cáo khác cùng ngày) → cập nhật đúng dòng cũ, không sinh dòng trùng; dòng ngày khác / KCN khác không đụng', () => {
    const existing = [
      { id: 'r-same', zone_name: 'KCN Tân Bình', industry: 'sản xuất  NỘI THẤT', survey_date: '2026-10-16' },   // lệch hoa thường, khoảng trắng
      { id: 'r-other-day', zone_name: 'KCN Tân Bình', industry: 'Sản xuất nội thất', survey_date: '2026-09-01' },
      { id: 'r-other-zone', zone_name: 'KCN Khác', industry: 'Sản xuất nội thất', survey_date: '2026-10-16' },
    ]
    const plan = planWageSync(typed, existing, ZONE_TB, '2026-10-16', NOTE)
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].id).toBe('r-same')
  })

  it('cập nhật chỉ ghi ô báo cáo có số — số trống không xoá số đã có trên dòng Lương TT', () => {
    const only8h = setWageEntryField([emptyWageEntry(noiThat)], 0, { base_wage_8h_min: 260_000, base_wage_8h_max: 280_000 })
    const plan = planWageSync(only8h, [{ id: 'r1', zone_name: ZONE_TB, industry: 'Sản xuất nội thất', survey_date: '2026-10-16' }], ZONE_TB, '2026-10-16', NOTE)
    expect(plan.updates[0].patch).toEqual({ wage_base_8h_min: 260_000, wage_base_8h_max: 280_000, labor_availability: 'Trung bình' })
    expect(plan.updates[0].patch).not.toHaveProperty('wage_seasonal_min')
  })

  it('không ghi lương phổ thông; 2 dòng cùng ngành chỉ ghi 1 dòng', () => {
    const legacy = [{ ...typed[0], unskilled_min: 6_000_000, unskilled_max: 7_000_000 }, { ...typed[0], industry: 'sản xuất nội thất' }]
    const plan = planWageSync(legacy, [], ZONE_TB, '2026-10-16', NOTE)
    expect(plan.inserts).toHaveLength(1)
    expect(Object.keys(plan.inserts[0]).some(k => k.includes('unskilled'))).toBe(false)
  })

  it('chưa chạy migration 177: nhận ra lỗi thiếu cột 8h và bỏ 2 cột đó khỏi dữ liệu ghi', () => {
    expect(isMissingBase8hColumnError({ code: '42703', message: 'column "wage_base_8h_min" of relation "market_surveys" does not exist' })).toBe(true)
    expect(isMissingBase8hColumnError({ code: 'PGRST204', message: "Could not find the 'wage_base_8h_max' column of 'market_surveys' in the schema cache" })).toBe(true)
    expect(isMissingBase8hColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingBase8hColumnError(null)).toBe(false)
    const row = planWageSync(typed, [], ZONE_TB, '2026-10-16', NOTE).inserts[0]
    const stripped = withoutBase8h(row)
    expect(stripped).not.toHaveProperty('wage_base_8h_min')
    expect(stripped).not.toHaveProperty('wage_base_8h_max')
    expect(stripped).toMatchObject({ industry: 'Sản xuất nội thất', wage_seasonal_min: 9_000_000 })
  })
})

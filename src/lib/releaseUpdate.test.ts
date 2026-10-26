import { describe, it, expect } from 'vitest';
import {
  cleanNotes, parseVersionInfo, isNewBuild, notesNewerThan, olderBaseline, shouldPrompt, planBootNotice,
  collectFeatures, formatReleaseDate, formatBuiltAt, parseDismissed, serializeDismissed, REMIND_AFTER_MS, UNKNOWN_BASELINE_NOTES,
  type ReleaseNote, type VersionInfo,
} from './releaseUpdate';
import { RELEASE_NOTES } from './releaseNotes';

const note = (id: string, features: string[] = [`Chức năng ${id}`], date = '2026-10-26'): ReleaseNote => ({ id, date, features });
// mới nhất trước
const NOTES = [note('r5'), note('r4'), note('r3'), note('r2'), note('r1')];
const info = (over: Partial<VersionInfo> = {}): VersionInfo => ({ buildId: 'bbb', builtAt: null, releaseId: 'r5', notes: NOTES, ...over });

describe('release notes thật của app', () => {
  it('đúng dạng: id duy nhất, ngày YYYY-MM-DD, mỗi mục có tên chức năng, mới nhất trước', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    expect(cleanNotes(RELEASE_NOTES)).toHaveLength(RELEASE_NOTES.length);
    expect(new Set(RELEASE_NOTES.map(n => n.id)).size).toBe(RELEASE_NOTES.length);
    for (const n of RELEASE_NOTES) {
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.id.startsWith(n.date)).toBe(true);
      expect(n.features.every(f => f.trim().length > 0 && f.length <= 100)).toBe(true);
    }
    const dates = RELEASE_NOTES.map(n => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('cleanNotes', () => {
  it('bỏ mục sai dạng / trùng id / không có chức năng, cắt khoảng trắng', () => {
    const out = cleanNotes([
      { id: ' a ', date: '2026-10-01', title: ' CSKH ', features: [' X ', '', 5, 'Y'] },
      { id: 'a', date: '2026-10-02', features: ['trùng id'] },
      { id: 'b', date: '2026-10-03', features: [] },
      { id: '', date: '2026-10-04', features: ['không id'] },
      { id: 'c', date: 'hôm qua', features: ['sai ngày'] },
      null, 'x', 3,
    ]);
    expect(out).toEqual([
      { id: 'a', date: '2026-10-01', title: 'CSKH', features: ['X', 'Y'] },
      { id: 'c', date: '', features: ['sai ngày'] },
    ]);
  });
  it('không phải mảng → rỗng', () => {
    expect(cleanNotes(undefined)).toEqual([]);
    expect(cleanNotes({})).toEqual([]);
  });
});

describe('parseVersionInfo', () => {
  it('đọc đúng version.json', () => {
    const v = parseVersionInfo({ buildId: 'abc1234', builtAt: '2026-10-26T01:00:00.000Z', releaseId: 'r5', notes: NOTES });
    expect(v).toEqual({ buildId: 'abc1234', builtAt: '2026-10-26T01:00:00.000Z', releaseId: 'r5', notes: NOTES });
  });
  it('thiếu releaseId → lấy mục đầu danh sách; thiếu notes → rỗng', () => {
    expect(parseVersionInfo({ buildId: 'x', notes: NOTES })?.releaseId).toBe('r5');
    expect(parseVersionInfo({ buildId: 'x' })).toEqual({ buildId: 'x', builtAt: null, releaseId: '', notes: [] });
  });
  it('sai dạng (index.html bị trả về, thiếu buildId…) → null', () => {
    expect(parseVersionInfo(null)).toBeNull();
    expect(parseVersionInfo('<!doctype html>')).toBeNull();
    expect(parseVersionInfo({ buildId: '' })).toBeNull();
    expect(parseVersionInfo({ releaseId: 'r5' })).toBeNull();
    expect(parseVersionInfo([])).toBeNull();
  });
});

describe('isNewBuild', () => {
  it('khác mã → bản mới', () => expect(isNewBuild('aaa', 'bbb')).toBe(true));
  it('cùng mã → không', () => expect(isNewBuild('aaa', 'aaa')).toBe(false));
  it('bản dev hoặc mã rỗng → không kết luận', () => {
    expect(isNewBuild('dev', 'bbb')).toBe(false);
    expect(isNewBuild('', 'bbb')).toBe(false);
    expect(isNewBuild('aaa', '')).toBe(false);
  });
});

describe('notesNewerThan — lọc mục mới hơn bản đã thấy', () => {
  it('lấy các mục nằm trước mốc, mốc không tính', () => {
    expect(notesNewerThan(NOTES, 'r3').map(n => n.id)).toEqual(['r5', 'r4']);
    expect(notesNewerThan(NOTES, 'r4').map(n => n.id)).toEqual(['r5']);
  });
  it('mốc = mục mới nhất → không có gì mới', () => expect(notesNewerThan(NOTES, 'r5')).toEqual([]));
  it('mốc rỗng / null → không có (người dùng mới chỉ ghi nhận)', () => {
    expect(notesNewerThan(NOTES, '')).toEqual([]);
    expect(notesNewerThan(NOTES, null)).toEqual([]);
  });
  it('mốc không có trong danh sách → vài mục mới nhất, không đổ cả danh sách', () => {
    const long = Array.from({ length: 20 }, (_, i) => note(`n${20 - i}`));
    expect(notesNewerThan(long, 'đã-bị-cắt')).toHaveLength(UNKNOWN_BASELINE_NOTES);
    expect(notesNewerThan(long, 'đã-bị-cắt')[0].id).toBe('n20');
  });
  it('bỏ lỡ nhiều bản → gộp đủ tất cả', () => {
    const merged = collectFeatures(notesNewerThan(NOTES, 'r1'));
    expect(merged.shown).toEqual(['Chức năng r5', 'Chức năng r4', 'Chức năng r3', 'Chức năng r2']);
    expect(merged.more).toBe(0);
  });
});

describe('olderBaseline', () => {
  it('lấy mốc cũ hơn', () => {
    expect(olderBaseline(NOTES, 'r5', 'r3')).toBe('r3');
    expect(olderBaseline(NOTES, 'r2', 'r4')).toBe('r2');
  });
  it('thiếu một mốc → lấy mốc còn lại; thiếu cả hai → null', () => {
    expect(olderBaseline(NOTES, null, 'r4')).toBe('r4');
    expect(olderBaseline(NOTES, 'r4', '')).toBe('r4');
    expect(olderBaseline(NOTES, null, null)).toBeNull();
  });
  it('mốc không nhận ra coi là cũ nhất', () => expect(olderBaseline(NOTES, 'lạ', 'r4')).toBe('lạ'));
  it('2 tab: tab kia đã cập nhật (lastSeen r5), tab này vẫn chạy bản r3 → vẫn thấy r4, r5', () => {
    const base = olderBaseline(NOTES, 'r5', 'r3');
    expect(notesNewerThan(NOTES, base).map(n => n.id)).toEqual(['r5', 'r4']);
  });
});

describe('shouldPrompt', () => {
  const t0 = 1_000_000;
  it('bản mới, chưa bấm Để sau → hiện', () => {
    expect(shouldPrompt({ running: 'aaa', remote: 'bbb', dismissed: null, now: t0 })).toBe(true);
  });
  it('cùng bản → không hiện', () => {
    expect(shouldPrompt({ running: 'aaa', remote: 'aaa', dismissed: null, now: t0 })).toBe(false);
  });
  it('đã Để sau cho đúng bản này → ẩn, tới đủ thời gian mới nhắc lại', () => {
    const d = { buildId: 'bbb', at: t0 };
    expect(shouldPrompt({ running: 'aaa', remote: 'bbb', dismissed: d, now: t0 + 60_000 })).toBe(false);
    expect(shouldPrompt({ running: 'aaa', remote: 'bbb', dismissed: d, now: t0 + REMIND_AFTER_MS - 1 })).toBe(false);
    expect(shouldPrompt({ running: 'aaa', remote: 'bbb', dismissed: d, now: t0 + REMIND_AFTER_MS })).toBe(true);
  });
  it('Để sau bản cũ hơn rồi lại có bản mới hơn nữa → hiện ngay', () => {
    expect(shouldPrompt({ running: 'aaa', remote: 'ccc', dismissed: { buildId: 'bbb', at: t0 }, now: t0 + 1000 })).toBe(true);
  });
  it('lỗi tải phần cũ (force) → hiện dù đã Để sau; nhưng không có bản mới thì không hiện', () => {
    expect(shouldPrompt({ running: 'aaa', remote: 'bbb', dismissed: { buildId: 'bbb', at: t0 }, now: t0 + 1000, force: true })).toBe(true);
    expect(shouldPrompt({ running: 'aaa', remote: 'aaa', dismissed: null, now: t0, force: true })).toBe(false);
  });
  it('bản dev không bao giờ hiện', () => {
    expect(shouldPrompt({ running: 'dev', remote: 'bbb', dismissed: null, now: t0, force: true })).toBe(false);
  });
});

describe('planBootNotice — sau khi mở bản mới', () => {
  it('lần đầu (chưa có mốc): chỉ ghi nhận, không báo', () => {
    expect(planBootNotice(info(), null)).toEqual({ writeLastSeen: 'r5', shown: [] });
  });
  it('mốc = mới nhất → không làm gì', () => {
    expect(planBootNotice(info(), 'r5')).toEqual({ writeLastSeen: null, shown: [] });
  });
  it('có bản mới hơn mốc → báo các mục mới + ghi mốc mới', () => {
    const p = planBootNotice(info(), 'r3');
    expect(p.writeLastSeen).toBe('r5');
    expect(p.shown.map(n => n.id)).toEqual(['r5', 'r4']);
  });
  it('version.json không có mục nào → không ghi gì', () => {
    expect(planBootNotice(info({ releaseId: '', notes: [] }), 'r3')).toEqual({ writeLastSeen: null, shown: [] });
  });
});

describe('collectFeatures', () => {
  it('bỏ trùng tên, cắt theo giới hạn và đếm phần còn lại', () => {
    const notes = [note('a', ['A', 'B', 'C']), note('b', ['B', 'D', 'E'])];
    expect(collectFeatures(notes, 3)).toEqual({ shown: ['A', 'B', 'C'], more: 2 });
    expect(collectFeatures(notes, 10)).toEqual({ shown: ['A', 'B', 'C', 'D', 'E'], more: 0 });
    expect(collectFeatures([], 5)).toEqual({ shown: [], more: 0 });
  });
});

describe('formatReleaseDate', () => {
  it('đổi sang dd/mm/yyyy, sai dạng → rỗng', () => {
    expect(formatReleaseDate('2026-10-26')).toBe('26/10/2026');
    expect(formatReleaseDate('2026-10-26T01:00:00.000Z')).toBe('26/10/2026');
    expect(formatReleaseDate('26/10')).toBe('');
    expect(formatReleaseDate(null)).toBe('');
  });
});

describe('formatBuiltAt', () => {
  it('tính ngày theo giờ Việt Nam (UTC+7)', () => {
    expect(formatBuiltAt('2026-10-26T01:00:00.000Z')).toBe('26/10/2026');
    expect(formatBuiltAt('2026-10-26T20:00:00.000Z')).toBe('27/10/2026');
  });
  it('sai dạng → rỗng', () => {
    expect(formatBuiltAt('hôm qua')).toBe('');
    expect(formatBuiltAt(null)).toBe('');
  });
});

describe('parseDismissed', () => {
  it('đọc lại đúng giá trị đã lưu', () => {
    const d = { buildId: 'bbb', at: 123 };
    expect(parseDismissed(serializeDismissed(d))).toEqual(d);
  });
  it('rỗng / hỏng / thiếu trường → null', () => {
    expect(parseDismissed(null)).toBeNull();
    expect(parseDismissed('{hỏng')).toBeNull();
    expect(parseDismissed('{"b":"x"}')).toBeNull();
    expect(parseDismissed('"abc"')).toBeNull();
  });
});

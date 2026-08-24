// ─────────────────────────────────────────────────────────────────────────────
// Tên người Việt — tách tên gọi ra khỏi họ và tên đệm.
//
// Người Việt gọi nhau bằng TÊN (từ cuối), không phải họ: "Nguyễn Minh Tâm" là
// anh Tâm, không phải anh Nguyễn. Nên chữ cái trên avatar phải là "T", và danh
// bạ phải xếp theo vần của tên gọi — giống danh bạ điện thoại.
//
// Dữ liệu thật có cả xưng hô và chú thích lẫn vào ("Mr Đạt ( Bs thông tin )"),
// nên phải bỏ phần trong ngoặc và các mẩu không phải chữ trước khi lấy từ cuối.
// ─────────────────────────────────────────────────────────────────────────────

/** Các mẩu chữ của tên, đã bỏ chú thích trong ngoặc và dấu câu rời. */
function words(full: string | null | undefined): string[] {
  return (full ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(w => /\p{L}/u.test(w));
}

/** Tên gọi — từ cuối cùng. "Trần Thị Mỹ Nhiên" → "Nhiên". */
export function givenName(full: string | null | undefined): string {
  const w = words(full);
  return w.length ? w[w.length - 1] : (full ?? '').trim();
}

/** Họ và tên đệm — phần đứng trước tên gọi. "Trần Thị Mỹ Nhiên" → "Trần Thị Mỹ". */
export function familyName(full: string | null | undefined): string {
  return words(full).slice(0, -1).join(' ');
}

/** Chữ cái cho avatar: lấy theo TÊN GỌI. "Nguyễn Minh Tâm" → "T". */
export function personInitial(full: string | null | undefined): string {
  return (givenName(full).charAt(0) || '?').toUpperCase();
}

/** So sánh hai tên theo vần tiếng Việt: tên gọi trước, rồi mới tới họ đệm. */
export function compareVnName(a: string | null | undefined, b: string | null | undefined): number {
  const byGiven = givenName(a).localeCompare(givenName(b), 'vi');
  return byGiven !== 0 ? byGiven : familyName(a).localeCompare(familyName(b), 'vi');
}

# AUDIT LOGIC — Letsgo VN Web App

> **Phạm vi:** logic nghiệp vụ & tính toán số liệu (KHÔNG phải bảo mật — xem `AUDIT_REPORT.md` ngày 2026-06-21 cho phần đó)
> **Ngày rà:** 2026-08-08
> **Cách rà:** đọc mã nguồn `src/` + **đối chiếu ngược với dữ liệu thật trong Supabase** (chỉ đọc, không ghi)
> **Trạng thái:** ⛔ **CHỈ PHÂN TÍCH — chưa sửa gì. Chờ duyệt từng mục.**

---

## Đọc trước — tóm tắt cho người quyết định

Rà 52.558 dòng / 106 file. **Tìm được 12 lỗi.** Mọi con số dưới đây lấy từ database thật ngày 08/08/2026, không phải ước lượng.

**Vấn đề lớn nhất:** bảng "Báo cáo tổng hợp theo chi nhánh" ngay trên Dashboard đang **báo lợi nhuận thừa 5,15 tỷ đồng cho tháng 1** và **4,52 tỷ cho tháng 2**. Margin hiện 29–34% trong khi thực tế 7–9%. Nguyên nhân: công thức tính không hề đọc bảng chi phí.

**Nguyên nhân gốc chung của 3 lỗi (2, 3, 4):** hệ thống đã tiến hoá — dữ liệu chuyển sang bảng mới nhưng giao diện cũ vẫn đọc cột cũ đã bỏ hoang. Các cột này giờ rỗng 100%, khiến vài khu vực giao diện luôn hiện sai hoặc luôn rỗng mà không ai báo lỗi.

**Lý do "ít hôm lại phát hiện lỗi 1 lần":** hệ thống **không có test tự động nào cho các trang chính**. 203 test hiện có đều nằm ở module lương/báo giá — và các module đó sạch. Dashboard, Tài chính, Báo cáo, Khách hàng, Chi nhánh, Workspace: 0 test. Mọi lỗi chỉ lộ ra khi người dùng tình cờ nhìn thấy.

### Bảng tổng hợp

| # | Lỗi | Mức | Đang sai ngay? | Cần migration |
|---|---|---|---|---|
| 1 | Bảng tổng hợp chi nhánh tính lợi nhuận sai | 🔴 Nghiêm trọng | ✅ Có | Không |
| 2 | `clients.status` chết → 4 khu vực UI hỏng | 🟠 Nặng | ✅ Có | Không |
| 3 | `paid_this_month` chết → rail hiện sai 59/59 KH | 🟠 Nặng | ✅ Có | Không |
| 4 | `phone`/`email` rỗng nhưng vẫn render | 🟠 Nhẹ | ✅ Có | Không |
| 5 | `week_label` không mang năm | 🟡 Bom hẹn giờ | ❌ Từ 01/2027 | **Có** |
| 6 | `loadFinance('2026-06')` ghi cứng | 🟡 Vừa | ✅ Có (Workspace) | Không |
| 7 | `"+8.3% so T5"` ghi cứng | 🟡 Vừa | ✅ Có | Không |
| 8 | `startMonth = '2026-01'` ghi cứng | 🟡 Nhẹ | ❌ Từ 2027 | Không |
| 9 | Tài chính trộn 2 nguồn dữ liệu | 🔵 Vừa | ⚠️ Có điều kiện | Không |
| 10 | Việc "Tái ký HĐ" gán nhầm người | 🔵 Nặng (vận hành) | ✅ Có | Không |
| 11 | `branch_targets` rỗng — migration 082 | 🔵 Nhẹ | ✅ Có | **Có** |
| 12 | `branch_overhead` thiếu tháng | ⚪ Nhập liệu | ✅ Có | Không |

---

## 🔴 LỖI 1 — Bảng tổng hợp chi nhánh tính lợi nhuận sai hoàn toàn

**Vị trí:** `src/pages/Dashboard.tsx:263` (tính) → `src/pages/Dashboard.tsx:936` (hiển thị)

### Hiện trạng

```js
const profit = projects.reduce((s, p) => {
  if (p.project_type === 'shared') return s + (p.revenue || 0) * (p.cn_pct || 0) / 100;
  return s;
}, 0);
map[key].costs  += rev - profit;
map[key].profit += profit;
```

Ba sai lầm chồng nhau:

1. **Không đọc bảng chi phí.** `projects_pnl_costs` (464 dòng chi phí thật) không hề được truy vấn. Chi phí hiển thị là số bịa ra bằng `doanh thu − lợi nhuận`.
2. **Nhân sai gốc.** `cn_pct` là tỷ lệ chia **lợi nhuận** cho chi nhánh. Code đem nhân với **doanh thu**.
3. **Không trừ thuế.** Trang Tài chính trừ thuế TNDN (mặc định 20%), bảng này thì không.

### Bằng chứng số thật

| Tháng | Dashboard đang hiện | Thực tế (`calcPnl`) | Sai lệch |
|---|---|---|---|
| 2026-01 | CP 16.651.642.037 · LN **6.957.832.001** · margin **29,5%** | CP 21.344.960.775 · LN **1.811.610.610** · margin **7,7%** | **thừa 5.146.221.391** |
| 2026-02 | CP 10.861.354.484 · LN **5.699.619.241** · margin **34,4%** | CP 15.092.286.587 · LN **1.174.949.710** · margin **7,1%** | **thừa 4.524.669.530** |
| 2026-03 | CP 1.358.006.509 · LN **0** · margin **0,0%** | CP 1.203.421.446 · LN **123.668.050** · margin **9,1%** | thiếu 123.668.050 |
| 2026-04 | CP 1.516.065.728 · LN 631.770.449 · margin 29,4% | CP 1.903.874.017 · LN 195.169.728 · margin 9,1% | thừa 436.600.721 |
| 2026-05 | CP 1.542.377.754 · LN 748.117.594 · margin 32,7% | CP 2.042.389.003 · LN 198.485.076 · margin 8,7% | thừa 549.632.518 |

**Thêm:** 47/111 dự án bị loại khỏi phép tính hoàn toàn.

| Loại dự án | Số DA | Doanh thu | Dashboard xử lý |
|---|---|---|---|
| `shared` | 64 | 24.508.937.030 | Có tính (nhưng sai gốc nhân) |
| `managed` | 45 | 19.631.657.210 | **LN = 0, CP = 100% DT, margin 0%** |
| `per_manday` | 2 | 1.826.191.557 | **LN = 0, CP = 100% DT, margin 0%** |

### Tác động

Bảng này nằm ngay Dashboard — màn hình đầu tiên mở mỗi ngày. Nếu dùng nó để đánh giá chi nhánh nào lãi/lỗ thì mọi kết luận đều sai. Chi nhánh chỉ có dự án `managed` luôn hiện margin 0% dù thực tế có lãi.

### Phương án sửa

Thay công thức bằng `calcPnl()` — hàm chuẩn đã có sẵn tại `src/lib/format.ts:253`, đã đúng, đang được trang Tài chính dùng, và đã được kiểm chứng.

Dashboard **đã sẵn có** hai nguồn dữ liệu cần thiết nhưng chưa dùng cho bảng này:
- `monthPnlCosts` — chi phí theo dự án
- `splitSettingsMap` — cấu hình thuế theo khách hàng

Việc cần làm: đổi `groups` để mỗi dự án gọi `calcPnl(p, costs, { taxPct, taxExempt })`, rồi cộng `tc` vào cột chi phí và `profitAfterTax` vào cột lợi nhuận.

### Kết quả sau khi sửa

| | Trước | Sau |
|---|---|---|
| Cột Chi phí | Số bịa từ doanh thu | Tổng chi phí thật từ `projects_pnl_costs` |
| Cột Lợi nhuận | % doanh thu, bỏ thuế | Lợi nhuận sau thuế đúng chuẩn |
| Margin T1 | 29,5% | **7,7%** |
| Margin T2 | 34,4% | **7,1%** |
| Dự án `managed`/`per_manday` | Luôn 0% | Tính đúng như trang Tài chính |
| Khớp với trang Tài chính | ❌ Lệch hàng tỷ | ✅ Trùng khít |

**Lưu ý quan trọng:** sau khi sửa, **các con số lợi nhuận trên Dashboard sẽ TỤT MẠNH** (từ ~30% margin xuống ~8%). Đây là số đúng, không phải hỏng thêm. Cần biết trước để không hoảng.

**Rủi ro:** thấp. Không đụng database, chỉ đổi phép tính hiển thị.
**Công sức:** ~30 phút + kiểm chứng đối chiếu với trang Tài chính.

---

## 🟠 LỖI 2 — `clients.status` là trường chết, đang điều khiển 4 khu vực giao diện

**Vị trí:** `src/lib/types.ts:55` (định nghĩa) — dùng tại 4 nơi bên dưới

### Hiện trạng

Kiểu dữ liệu khai báo `'ok' | 'warn' | 'danger'`. Kiểm tra database: **59/59 khách hàng đều là `'ok'`**. Không có bất kỳ đoạn mã nào ghi giá trị `'warn'` hoặc `'danger'`.

### Các khu vực bị ảnh hưởng

| Vị trí | Biểu hiện |
|---|---|
| `src/pages/Workspace.tsx:310` | Rail **"KH cần chú ý"** → vĩnh viễn rỗng |
| `src/pages/Clients.tsx:1149`, `:1887` | Pill trạng thái → vĩnh viễn "Bình thường" |
| `src/pages/ClientDetail.tsx:693` | Pill trạng thái → vĩnh viễn "Bình thường" |
| `src/components/AlertsTasksPanel.tsx:164`, `:191` | Nhánh lọc chết, mô tả "Khách hàng khẩn cấp" không bao giờ chạy |
| `src/pages/Dashboard.tsx` (thẻ HĐ cần xử lý) | ✅ **Đã sửa trong phiên 08/08** |

### Phương án sửa — 2 lựa chọn

**Phương án A (đề xuất):** tính `status` tự động, không lưu vào database.
Thêm hàm dùng chung, ví dụ `clientStatus(client, workers)`:
- `danger` — hợp đồng đã hết hạn, **hoặc** lao động thực tế < 70% cam kết `min_workers`
- `warn` — hợp đồng còn ≤ 30 ngày, **hoặc** lao động thực tế < 90% cam kết
- `ok` — còn lại

**Phương án B:** bỏ hẳn trường `status` và toàn bộ UI phụ thuộc.

### Kết quả sau khi sửa (theo phương án A)

| | Trước | Sau (số thật hiện tại) |
|---|---|---|
| Rail "KH cần chú ý" | 0 khách (rỗng) | **≈ 8 khách** — 4 hết hạn + 4 sắp hết |
| Pill ở danh sách KH | 59/59 "Bình thường" | 4 "Hết hạn HĐ", 4 "Sắp hết HĐ", 51 "Bình thường" |
| AlertsTasksPanel | Nhánh chết | Hoạt động đúng |

**Rủi ro:** trung bình — đổi hiển thị ở 4 màn hình. Cần bạn xác nhận ngưỡng %.
**Cần bạn quyết:** chọn A hay B; nếu A thì ngưỡng cảnh báo lao động thiếu là bao nhiêu %.
**Công sức:** ~1 giờ.

---

## 🟠 LỖI 3 — `paid_this_month` là cờ chết, rail thanh toán luôn hiện sai

**Vị trí:** `src/pages/Workspace.tsx:309`, `src/pages/Dashboard.tsx:210`

### Hiện trạng

```js
const unpaidClients = clients.filter(c => c.client_type === 'active' && !c.paid_this_month);
```

Kiểm tra database: **0/59 khách có `paid_this_month = true`**.

Đây là cờ boolean **không gắn tháng**. Kể cả nếu có ai tích, nó cũng không bao giờ tự reset sang tháng mới — về bản chất trường này không thể đúng được.

Nguồn thanh toán thật đã chuyển sang `finance_records.paid_status`, nhưng bảng đó chỉ có **8 dòng, toàn bộ thuộc tháng 2026-06**.

### Tác động

Rail Workspace **"KH chưa thanh toán tháng này"** đang liệt kê **cả 59 khách**, mọi lúc. Rail này vô dụng — và tệ hơn, nó tạo cảm giác sai rằng không ai thanh toán.

### Phương án sửa

1. Đọc trạng thái thanh toán **theo tháng** từ `finance_records` (hoặc `projects_pnl` nếu đó mới là nguồn chuẩn — **cần bạn xác nhận nguồn nào là chuẩn**).
2. Truyền tháng hiện tại vào Workspace thay vì cờ trên `clients`.
3. Nếu tháng đó chưa có dữ liệu thanh toán → hiện "Chưa nhập dữ liệu thanh toán T8" thay vì liệt kê toàn bộ khách.

### Kết quả sau khi sửa

| | Trước | Sau |
|---|---|---|
| Rail "KH chưa thanh toán" | Luôn 59 khách | Đúng số khách chưa TT của tháng đang xét |
| Khi chưa nhập dữ liệu | Vẫn hiện 59 khách (hiểu nhầm) | Ghi rõ "chưa nhập dữ liệu tháng này" |
| Sang tháng mới | Không đổi gì | Tự reset theo tháng |

**Cần bạn quyết:** nguồn dữ liệu thanh toán chuẩn là `finance_records` hay `projects_pnl`?
**Công sức:** ~45 phút.

---

## 🟠 LỖI 4 — Khối liên hệ hiển thị trường đã bỏ hoang

**Vị trí:** `src/pages/Dashboard.tsx:1052-1058`

**Hiện trạng:** `clients.phone` và `clients.email` **rỗng 100%** trên cả 80 dòng. Popup chi tiết khách trên Dashboard vẫn render khối liên hệ với icon điện thoại/email — luôn trống.

Danh bạ thật đã chuyển sang bảng người liên hệ riêng (tab Người liên hệ trong Chi tiết KH).

**Phương án sửa:** trỏ popup sang bảng người liên hệ (lấy người liên hệ chính), hoặc bỏ khối đó nếu không cần.

**Kết quả sau khi sửa:** popup hiện đúng số điện thoại/email của người liên hệ chính, hoặc gọn lại nếu bỏ.

**Công sức:** ~20 phút.

---

## 🟡 LỖI 5 — `week_label` không mang năm ⚠️ BOM HẸN GIỜ LỚN NHẤT

**Vị trí:** `src/lib/format.ts:27` (`getMonthLast`), bảng `client_labor_history`

### Hiện trạng

Nhãn lưu dạng `"T7W4"` — tháng 7 tuần 4, **không có năm**. Hàm khớp bằng biểu thức `^T{month}W(\d+)$`, tức `T1W2` của 2026 và của 2027 là **hoàn toàn không phân biệt được**.

Kiểm tra database: 703 bản ghi, toàn bộ nhập trong năm 2026, các tháng T1–T7. **Hiện đang an toàn.**

### Khi nào nổ

**Tháng 1/2027.** Ngay khi có bản ghi `T1W1` của 2027 trong khi `T1W1` của 2026 vẫn còn, mọi thống kê lao động sẽ trộn số hai năm:

- Dashboard — biểu đồ Xu hướng lao động, Lao động theo chi nhánh
- Báo cáo — Xu hướng lao động 6 tháng, chỉ số doanh thu/lao động
- Chi nhánh — thống kê lao động theo chi nhánh
- Chi tiết KH — lịch sử lao động từng khách

### Phương án sửa

1. **Migration:** thêm cột `period TEXT` dạng `'YYYY-MM'` vào `client_labor_history`.
2. **Backfill** dữ liệu cũ từ `created_at` — logic suy luận năm **đã có sẵn và đã đúng** tại `src/utils/clientMdExport.ts:102` (hàm `inferLaborMonth`, xử lý cả trường hợp nhập tháng 1/2027 cho nhãn T12/2026).
3. Đổi `getMonthLast` nhận `period` thay vì số tháng.
4. Cập nhật mọi nơi ghi mới để điền `period`.

### Kết quả sau khi sửa

| | Trước | Sau |
|---|---|---|
| Phạm vi xem được | Tối đa 12 tháng, và chỉ đúng trong cùng năm | Không giới hạn, đúng qua nhiều năm |
| Biểu đồ Dashboard | Buộc chặn ở T1 năm nay | Xem được T8/2025 → T8/2026 nếu muốn |
| Tháng 1/2027 | ❌ Số liệu sai lẫn lộn | ✅ Chính xác |

**Rủi ro:** trung bình-cao — đụng vào bảng dữ liệu lịch sử. **Bắt buộc sao lưu trước.**
**Cần bạn:** chạy migration qua Supabase SQL Editor (tôi sẽ đưa nội dung SQL để bạn tự chạy).
**Công sức:** ~2 giờ + kiểm chứng.
**Thời hạn:** nên xong **trước tháng 12/2026**.

---

## 🟡 LỖI 6 — `loadFinance('2026-06')` ghi cứng 3 chỗ

**Vị trí:** `src/App.tsx:108`, `:143`, `:165`

**Hiện trạng:** cả 3 chỗ đều gọi `loadFinance('2026-06')` với tháng ghi cứng.

Trang Tài chính **tự nạp lại** đúng tháng ở `src/pages/Finance.tsx:144` nên không ảnh hưởng. Nhưng **Workspace không nạp lại** → dữ liệu tài chính mà Workspace nhận được vĩnh viễn là tháng 6/2026.

**Phương án sửa:** thay `'2026-06'` bằng tháng hiện tại. Sau khi sửa lỗi 3, cân nhắc bỏ hẳn lần nạp này cho Workspace nếu không còn dùng.

**Kết quả sau khi sửa:** Workspace nhận dữ liệu tài chính đúng tháng hiện tại thay vì T6/2026 đóng băng.

**Công sức:** ~10 phút.

---

## 🟡 LỖI 7 — `"+8.3% so T5"` ghi cứng

**Vị trí:** `src/pages/Finance.tsx:477`

**Hiện trạng:** thẻ Doanh thu trên trang Tài chính hiện dòng `+8.3% so T5` — chuỗi ghi cứng trong mã nguồn, không tính toán gì. Giống hệt lỗi `+2.8%` đã sửa trên Dashboard trong phiên 08/08.

Chuỗi này còn tham chiếu "T5" cố định, trong khi trang đang xem tháng khác.

**Phương án sửa:** tính thật từ doanh thu tháng trước (`projects_pnl` tháng liền trước), hiện "chưa có dữ liệu" khi thiếu — dùng đúng cách đã áp cho Dashboard.

**Kết quả sau khi sửa:** hiện % tăng/giảm thật, tự đổi màu xanh/đỏ, hoặc ghi rõ chưa có dữ liệu so sánh.

**Công sức:** ~20 phút.

---

## 🟡 LỖI 8 — `startMonth = '2026-01'` ghi cứng

**Vị trí:** `src/pages/Finance.tsx:152` và `:164`

**Hiện trạng:** hai danh sách tháng (`workspaceMonths`, `timelineMonths`) đều bắt đầu cố định từ `'2026-01'` và chạy tới hiện tại. Sang 2027 dropdown dài 24 mục, 2028 là 36 mục, không bao giờ cắt bớt.

**Phương án sửa:** giới hạn cửa sổ trượt, ví dụ 18 tháng gần nhất, vẫn luôn kèm tháng đang chọn.

**Kết quả sau khi sửa:** dropdown giữ độ dài ổn định, không phình theo thời gian.

**Công sức:** ~15 phút.

---

## 🔵 LỖI 9 — Trang Tài chính trộn hai nguồn dữ liệu

**Vị trí:** `src/pages/Finance.tsx:349-351`

### Hiện trạng

```js
const totalRev  = pnlTotalRev  || finRev;
const totalCost = pnlTotalCost || finCost;
const totalProfit = totalRev - totalCost;
```

Hai dòng đầu quyết định độc lập nhau. Nếu tháng đang xem **có P&L nhưng chưa nhập chi phí nào**, kết quả là:
- Doanh thu ← lấy từ `projects_pnl` (tháng đang xem)
- Chi phí ← rơi về `finance_records` (chỉ có dữ liệu T6/2026)

→ lấy doanh thu tháng này trừ chi phí tháng 6, ra lợi nhuận vô nghĩa.

### Phương án sửa

Quyết định nguồn **một lần cho cả cụm**:

```js
const usePnl = pnlMonth.length > 0;
const totalRev  = usePnl ? pnlTotalRev  : finRev;
const totalCost = usePnl ? pnlTotalCost : finCost;
```

Kèm cảnh báo khi có P&L mà chưa nhập chi phí.

**Kết quả sau khi sửa:** doanh thu và chi phí luôn cùng một nguồn, cùng một tháng. Thiếu dữ liệu thì báo rõ thay vì âm thầm trộn.

**Công sức:** ~20 phút.

---

## 🔵 LỖI 10 — Việc "Tái ký HĐ" tự sinh gán nhầm người phụ trách

**Vị trí:** `src/components/AlertsTasksPanel.tsx:242`

### Hiện trạng

Khi ai đó **mở Dashboard**, hệ thống tự tạo việc "Tái ký HĐ" cho các khách sắp hết hợp đồng, và gán:

```js
user_id: (user as any).id,   // ← người đang mở trình duyệt
```

Nhưng Workspace chỉ hiện việc của chính mình (`.eq('user_id', user.id)` tại `MyWorkFeed.tsx:246`).

### Bằng chứng số thật

29 việc "Tái ký HĐ" hiện thuộc **2 tài khoản**, trong đó **24/29 dồn vào một người duy nhất**.

Ai mở Dashboard trước thì ôm hết việc tái ký của toàn công ty. Quản lý phụ trách thật không thấy gì trong Workspace của mình.

**Đây chính là lý do** Workspace của bạn hiện "1 HĐ cần xử lý" trong khi Dashboard hiện 8 — phần lớn việc đã bị gán cho tài khoản khác.

### Phương án sửa

Gán `user_id` theo **quản lý phụ trách khách hàng** (`clients.manager` → tra sang bảng `users`), không theo người đang mở trình duyệt. Trường hợp không tra được người phụ trách thì gán cho admin và ghi chú rõ.

Cân nhắc thêm: chuyển việc tự sinh từ "khi mở Dashboard" sang tác vụ chạy định kỳ, để việc không phụ thuộc vào ai tình cờ mở trang.

### Kết quả sau khi sửa

| | Trước | Sau |
|---|---|---|
| Ai nhận việc | Người mở Dashboard đầu tiên | Quản lý phụ trách khách hàng đó |
| Phân bổ hiện tại | 24/29 dồn 1 người | Trải đúng theo người phụ trách |
| Workspace mỗi người | Thiếu việc của mình | Thấy đúng việc của mình |

**Rủi ro:** trung bình — đụng logic tạo dữ liệu. **Cần xử lý cả 29 việc đã gán sai trước đó** (gán lại hoặc để nguyên — cần bạn quyết).
**Công sức:** ~1 giờ.

---

## 🔵 LỖI 11 — `branch_targets` rỗng, migration 082 chưa chạy

**Vị trí:** `src/pages/Reports.tsx:121`, `:617`, `:1100`

**Hiện trạng:** bảng `branch_targets` tồn tại nhưng **0 dòng**. Bảng xếp hạng chi nhánh ở Báo cáo không có thanh % đạt mục tiêu, luôn hiện "0/N đúng tiến độ", và tự chuyển sang xếp theo doanh thu.

Code đã có sẵn ghi chú nhắc chạy migration `082_branch_targets_renewal.sql`.

**Phương án sửa:** đây **không phải lỗi code** — code đã xử lý đúng trường hợp thiếu dữ liệu. Cần chạy migration 082 rồi nhập mục tiêu doanh thu từng chi nhánh theo tháng.

**Kết quả sau khi sửa:** bảng xếp hạng hiện % đạt mục tiêu, thanh tiến độ, cảnh báo chi nhánh chậm nhịp.

**Cần bạn:** chạy migration + nhập số mục tiêu.

---

## ⚪ LỖI 12 — `branch_overhead` thiếu tháng

**Hiện trạng:** chi phí chung theo tháng hiện có:

| Tháng | Giá trị |
|---|---|
| 2026-01 | 10.000.000 |
| 2026-02 | 10.000.000 |
| 2026-03 | ❌ **thiếu** |
| 2026-04 | ❌ **thiếu** |
| 2026-05 | 61.487.219 |
| 2026-06 | 61.487.266 |
| 2026-07 | 15.550.000 |
| 2026-08 | ❌ **thiếu** |

Báo cáo tính lợi nhuận các tháng thiếu mà **không trừ chi phí chung** → lợi nhuận cao giả. Giao diện không hề cảnh báo.

Ngoài ra T1/T2 chỉ 10 triệu trong khi T5/T6 hơn 61 triệu — chênh lệch 6 lần, nhiều khả năng T1/T2 cũng nhập thiếu.

**Phương án sửa:** không phải lỗi code. Đề xuất thêm cảnh báo trên Báo cáo khi tháng đang xem chưa có chi phí chung, để không đọc nhầm lợi nhuận.

**Cần bạn:** nhập bù chi phí chung các tháng thiếu.

---

## ✅ Những chỗ đã kiểm và SẠCH

Để bạn biết phạm vi đã phủ, không chỉ phần có lỗi:

| Hạng mục | Kết quả |
|---|---|
| `lg_pct + cn_pct = 100` | ✅ Đúng trên toàn bộ 64 dự án `shared` |
| `calcPnl()` — chia LN, thuế, HOH, per_manday | ✅ Logic đúng |
| 203 test module lương / báo giá / so sánh vùng | ✅ Pass hết |
| `current_workers` khớp tháng mới nhất | ✅ Hiện không khách nào lệch (đã tạo task phòng ngừa riêng) |
| Build production | ✅ Sạch |
| SQL injection | ✅ Không có (dùng Supabase client tham số hoá) |

---

## Đề xuất thứ tự thực hiện

### Đợt 1 — Sửa số đang sai (làm ngay)
| # | Lỗi | Công sức |
|---|---|---|
| 1 | Bảng tổng hợp chi nhánh | 30 phút |
| 7 | `+8.3%` ghi cứng | 20 phút |
| 9 | Tài chính trộn nguồn | 20 phút |
| 6 | `loadFinance` ghi cứng | 10 phút |

→ **~1,5 giờ.** Không cần migration, rủi ro thấp, sửa xong là số trên màn hình đúng.

### Đợt 2 — Khôi phục chức năng đã chết (cần bạn quyết vài điểm)
| # | Lỗi | Cần bạn quyết |
|---|---|---|
| 10 | Gán việc tái ký | Có gán lại 29 việc cũ không? |
| 3 | Rail thanh toán | Nguồn chuẩn: `finance_records` hay `projects_pnl`? |
| 2 | `clients.status` | Phương án A hay B? Ngưỡng % bao nhiêu? |
| 4 | Khối liên hệ | Trỏ sang danh bạ mới hay bỏ? |

→ **~3 giờ.**

### Đợt 3 — Gỡ bom trước 12/2026
| # | Lỗi | Ghi chú |
|---|---|---|
| 5 | `week_label` không mang năm | **Cần migration + sao lưu trước** |
| 8 | `startMonth` ghi cứng | Làm kèm luôn |

→ **~2,5 giờ.**

### Đợt 4 — Việc của bạn, không phải của code
| # | Việc |
|---|---|
| 11 | Chạy migration 082 + nhập mục tiêu chi nhánh |
| 12 | Nhập bù chi phí chung T3, T4, T8 (và rà lại T1, T2) |

### Đề xuất kèm theo — chống tái phát

Nguyên nhân "ít hôm lại phát hiện lỗi 1 lần" là **không có test cho các trang chính**. Sau khi xong đợt 1–3, đề xuất viết test cho các hàm tính toán số liệu (`calcPnl`, `getMonthLast`, gom nhóm chi nhánh, tổng hợp tài chính). Hạ tầng test đã sẵn sàng — `vitest` đang chạy tốt với 203 test. Ước lượng ~3 giờ, và sẽ chặn được đúng loại lỗi trong tài liệu này trước khi lên production.

---

## Nguyên tắc thực hiện

- ⛔ **Chưa sửa bất kỳ dòng nào** cho tới khi bạn duyệt từng mục
- Mỗi lỗi sửa xong sẽ **đối chiếu lại với dữ liệu thật** rồi báo cáo trước/sau
- Migration: tôi **đưa nội dung SQL, bạn tự chạy** qua Supabase SQL Editor
- Không đụng vào dữ liệu đang có nếu chưa sao lưu
- Commit để bạn tự đẩy lên qua GitHub Desktop

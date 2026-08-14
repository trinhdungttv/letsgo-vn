# KẾ HOẠCH SỬA LỖI — chia bước để làm từng phần

> Đi kèm: `AUDIT_LOGIC_2026-08-08.md` (mô tả 12 lỗi)
> **Trạng thái: chờ duyệt từng bước. Chưa sửa gì.**

---

## Nguyên tắc xuyên suốt

1. **Mỗi bước = 1 commit độc lập.** Bước nào hỏng thì lùi riêng bước đó, không kéo theo bước khác.
2. **Đối chiếu số thật trước và sau.** Mỗi bước động tới con số đều có bảng trước/sau lấy từ database, không nói suông.
3. **Lưới an toàn đi trước.** Bước đầu tiên là viết test cho công thức hiện tại — chưa đổi hành vi. Có test rồi mới dám sửa.
4. **Migration bạn tự chạy.** Tôi đưa SQL, bạn dán vào Supabase SQL Editor. Không tự động chạy lệnh đụng dữ liệu.
5. **Dừng ở mỗi chốt.** Hết mỗi bước tôi báo cáo, bạn duyệt rồi mới đi tiếp.

---

## Sơ đồ phụ thuộc

```
B0 (mốc số liệu)
 │
 ├─ GĐ1 ─ B1.1 (test lưới an toàn) → B1.2 (sửa bảng tổng hợp)
 │         B1.3 (Tài chính KPI)      ─ độc lập
 │         B1.4 (loadFinance)        ─ độc lập
 │
 ├─ GĐ2 ─ B2.1 (gán việc)  ─ độc lập
 │         B2.2 (rail TT)   ─ làm SAU B1.4 (dùng chung nguồn tháng)
 │         B2.3 (status)    ─ độc lập
 │         B2.4 (liên hệ)   ─ độc lập
 │
 ├─ GĐ3 ─ B3.1 (migration) → B3.2 (backfill) → B3.3 (đổi code) → B3.4 (mở khoá T1 + dropdown)
 │
 ├─ GĐ4 ─ việc nhập liệu của bạn (song song, không chặn ai)
 │
 └─ GĐ5 ─ bộ test chống tái phát (sau cùng)
```

Ba giai đoạn đầu **không phụ thuộc nhau** — có thể dừng sau GĐ1 nếu muốn.

---

## BƯỚC 0 — Chụp mốc số liệu hiện tại

**Mục tiêu:** có ảnh chụp số liệu "trước khi sửa" để đối chiếu, tránh tranh cãi về sau.

**Việc làm:** chạy script chỉ-đọc, xuất ra file các con số hiện tại của mọi thẻ và bảng sẽ bị đụng tới — Dashboard, Tài chính, Workspace, Báo cáo.

**Kết quả:** một file mốc. Sau mỗi bước sửa, chạy lại và so.

**Không đụng code.** ⏱ 15 phút · Rủi ro: không có · **Không cần bạn quyết**

---

# GIAI ĐOẠN 1 — Sửa số tiền đang sai

> Không cần migration. Rủi ro thấp. Xong giai đoạn này là các con số trên màn hình đúng.

## BƯỚC 1.1 — Dựng lưới an toàn (chưa đổi hành vi)

**Vì sao làm trước:** đây là câu trả lời cho "ít hôm lại phát hiện lỗi 1 lần". Hiện các trang chính **không có test nào**. Tách công thức ra hàm thuần rồi phủ test, thì lần sau ai sửa nhầm là test kêu ngay.

**Việc làm:**
- Tách phép gộp chi nhánh từ `src/pages/Dashboard.tsx:263` ra hàm thuần trong `src/lib/` (ví dụ `aggregateBranchRows`)
- Viết test cho hàm đó, **khoá đúng hành vi SAI hiện tại**
- Dashboard gọi hàm mới — màn hình không đổi một pixel

**Kiểm chứng:** `npx vitest run` xanh · Dashboard hiện y hệt trước

**Kết quả:** công thức nằm ở chỗ test được. Bước sau sửa là test đỏ lên đúng chỗ, chứng minh sửa có tác dụng.

⏱ 45 phút · Rủi ro: **rất thấp** (thuần tái cấu trúc) · **Không cần bạn quyết**

---

## BƯỚC 1.2 — Sửa công thức bảng tổng hợp chi nhánh ⭐ *(lỗi 1)*

**Đây là bước đáng giá nhất trong toàn kế hoạch.**

### ⚠️ Cần bạn quyết trước khi làm

Dashboard hiện có **hai luồng dữ liệu P&L chạy song song**:

| | Nguồn A (dòng 179) | Nguồn B (dòng 406) |
|---|---|---|
| Tháng | Cố định tháng hiện tại | **Chọn được** bằng dropdown |
| Có doanh thu | ✅ | ✅ |
| Có chi phí | ❌ **không** | ✅ |
| Có cấu hình thuế | ❌ **không** | ✅ |
| Đang dùng cho | Thẻ Doanh thu + **bảng tổng hợp** | 2 biểu đồ cột |

Bảng tổng hợp đang bám Nguồn A — **chính vì Nguồn A không có chi phí nên mới sinh ra lỗi**.

**Phương án A — gộp bảng về Nguồn B (tôi đề xuất)**
- Bảng có luôn chi phí + thuế đúng
- Bảng theo được dropdown tháng như 2 biểu đồ bên trên → cả trang thống nhất một tháng
- Bỏ được một truy vấn trùng
- ⚠️ **Đổi hành vi:** bảng hiện đang luôn là tháng hiện tại, sau khi sửa sẽ đi theo tháng bạn chọn

**Phương án B — giữ bảng ở tháng hiện tại**
- Không đổi hành vi
- ⚠️ Phải nạp thêm chi phí cho tháng hiện tại → thêm truy vấn, thêm dữ liệu trùng
- ⚠️ Trang có 2 tháng khác nhau cùng lúc: biểu đồ theo tháng chọn, bảng theo tháng hiện tại

👉 **Bạn chọn A hay B?**

### Việc làm
Thay công thức bịa bằng `calcPnl()` — hàm chuẩn tại `src/lib/format.ts:253`, trang Tài chính đang dùng, đã kiểm chứng. Cột chi phí lấy `tc`, cột lợi nhuận lấy `profitAfterTax`.

### Kiểm chứng
- Test ở B1.1 chuyển sang giá trị đúng
- **Đối chiếu tổng từng tháng với trang Tài chính** — phải trùng khít
- Chạy lại script kiểm chứng độc lập

### Kết quả kỳ vọng

| Tháng | Trước (sai) | Sau (đúng) |
|---|---|---|
| T1 | LN 6.957.832.001 · margin 29,5% | LN **1.811.610.610** · margin **7,7%** |
| T2 | LN 5.699.619.241 · margin 34,4% | LN **1.174.949.710** · margin **7,1%** |
| T4 | LN 631.770.449 · margin 29,4% | LN **195.169.728** · margin **9,1%** |
| T5 | LN 748.117.594 · margin 32,7% | LN **198.485.076** · margin **8,7%** |

47 dự án `managed`/`per_manday` (21,4 tỷ doanh thu) từ margin 0% → tính đúng.

> 🚨 **Chuẩn bị tinh thần:** lợi nhuận trên Dashboard sẽ **tụt từ ~30% xuống ~8%**. Đây là số đúng. Số cũ mới là số sai.

⏱ 45 phút · Rủi ro: thấp (không đụng database) · **Cần bạn quyết: phương án A hay B**

---

## BƯỚC 1.3 — Sửa 2 thẻ KPI trang Tài chính *(lỗi 7 + lỗi 9)*

Gộp chung vì cùng nằm ở cụm thẻ KPI, `src/pages/Finance.tsx:349-351` và `:477`.

**Việc làm:**
- **Lỗi 7** — bỏ chuỗi ghi cứng `"+8.3% so T5"`, tính thật từ doanh thu tháng liền trước. Thiếu dữ liệu thì ghi rõ, không bịa số. Dùng đúng cách đã áp cho Dashboard phiên trước.
- **Lỗi 9** — quyết định nguồn dữ liệu **một lần cho cả cụm** thay vì để doanh thu và chi phí rơi về hai nguồn khác nhau:
  ```js
  const usePnl = pnlMonth.length > 0;
  const totalRev  = usePnl ? pnlTotalRev  : finRev;
  const totalCost = usePnl ? pnlTotalCost : finCost;
  ```
- Thêm cảnh báo khi có P&L mà chưa nhập chi phí

**Kiểm chứng:** đổi qua vài tháng, kiểm doanh thu và chi phí luôn cùng một nguồn

**Kết quả:**

| | Trước | Sau |
|---|---|---|
| Dòng % dưới Doanh thu | `+8.3% so T5` (bịa, cố định) | % thật so tháng liền trước, xanh/đỏ theo chiều |
| Khi thiếu dữ liệu | Vẫn hiện +8.3% | "Chưa có dữ liệu T… để so sánh" |
| Doanh thu / Chi phí | Có thể lệch nguồn, lệch tháng | Luôn cùng nguồn, cùng tháng |
| Có P&L, chưa nhập chi phí | Âm thầm lấy chi phí T6/2026 | Cảnh báo rõ |

⏱ 40 phút · Rủi ro: thấp · **Không cần bạn quyết**

---

## BƯỚC 1.4 — Bỏ tháng ghi cứng khi nạp tài chính *(lỗi 6)*

**Việc làm:** thay `loadFinance('2026-06')` bằng tháng hiện tại tại `src/App.tsx:108`, `:143`, `:165`.

**Kiểm chứng:** mở Workspace, kiểm tra dữ liệu tài chính nhận được là tháng hiện tại

**Kết quả:** Workspace hết bị đóng băng ở T6/2026.

⏱ 10 phút · Rủi ro: rất thấp · **Không cần bạn quyết**

**→ CHỐT GIAI ĐOẠN 1.** Tổng ~2,5 giờ. Báo cáo trước/sau đầy đủ, bạn duyệt rồi đẩy lên GitHub.

---

# GIAI ĐOẠN 2 — Khôi phục chức năng đã chết

> Cần bạn quyết vài điểm. Mỗi bước độc lập, làm bước nào cũng được.

## BƯỚC 2.1 — Gán đúng người phụ trách cho việc tái ký *(lỗi 10)*

**Ảnh hưởng vận hành lớn nhất trong giai đoạn này.** Hiện 24/29 việc tái ký dồn vào một tài khoản chỉ vì người đó mở Dashboard trước.

### ⚠️ Cần bạn quyết

**Câu hỏi 1 — xử lý 29 việc đã gán sai:**
- (a) Gán lại hết theo quản lý phụ trách *(tôi đề xuất)*
- (b) Để nguyên việc cũ, chỉ áp quy tắc mới từ nay
- (c) Bạn tự xử lý thủ công

**Câu hỏi 2 — khi không tra được người phụ trách** (khách chưa gán quản lý, hoặc quản lý không có tài khoản):
- (a) Gán cho admin *(tôi đề xuất)*
- (b) Không tạo việc, hiện cảnh báo trên Dashboard

**Việc làm:** đổi `user_id` tại `src/components/AlertsTasksPanel.tsx:242` — tra từ `clients.manager` sang bảng `users` thay vì lấy người đang mở trình duyệt.

**Kiểm chứng:** đối chiếu danh sách việc ↔ người phụ trách từng khách, không còn dồn cục

**Kết quả:**

| | Trước | Sau |
|---|---|---|
| Ai nhận việc | Người mở Dashboard đầu tiên | Quản lý phụ trách khách đó |
| Phân bổ | 24/29 dồn 1 tài khoản | Trải đúng theo người phụ trách |
| Workspace mỗi người | Thiếu việc của mình | Thấy đúng việc của mình |

⏱ 1 giờ *(+30 phút nếu chọn gán lại việc cũ)* · Rủi ro: trung bình — **có ghi vào database, sẽ sao lưu trước** · **Cần bạn quyết 2 câu**

---

## BƯỚC 2.2 — Rail thanh toán đọc đúng theo tháng *(lỗi 3)*

Hiện rail "KH chưa thanh toán tháng này" liệt kê **cả 59 khách**, mọi lúc.

### ⚠️ Cần bạn quyết

**Nguồn dữ liệu thanh toán chuẩn là bảng nào?**
- (a) `finance_records.paid_status` — hiện chỉ có 8 dòng, toàn T6/2026
- (b) `projects_pnl` — 111 dòng, đủ T1–T5
- (c) Bạn cho biết quy trình thực tế đang ghi nhận thanh toán ở đâu

Đây là câu quan trọng nhất: **tôi không đoán được đâu là nguồn thật của bạn.** Nhìn dữ liệu thì `finance_records` có vẻ đã bỏ hoang từ T6.

**Việc làm:** bỏ cờ `clients.paid_this_month` (0/59 = true, không thể đúng vì không gắn tháng), đọc theo tháng từ nguồn bạn chọn. Chưa có dữ liệu thì ghi rõ thay vì liệt kê toàn bộ khách.

**Kết quả:**

| | Trước | Sau |
|---|---|---|
| Rail hiện | Luôn 59 khách | Đúng số khách chưa TT tháng đang xét |
| Chưa nhập dữ liệu | Vẫn 59 khách (hiểu nhầm) | "Chưa nhập dữ liệu thanh toán T8" |
| Sang tháng mới | Không đổi | Tự reset |

⏱ 45 phút · Rủi ro: thấp · **Cần bạn quyết nguồn dữ liệu**

---

## BƯỚC 2.3 — Hồi sinh trạng thái khách hàng *(lỗi 2)*

`clients.status` hiện 59/59 đều `'ok'` → 4 khu vực giao diện chết.

### ⚠️ Cần bạn quyết

**Câu hỏi 1 — hướng xử lý:**
- (a) **Tính tự động, không lưu database** *(tôi đề xuất)* — luôn đúng, không cần ai bảo trì
- (b) Bỏ hẳn trường `status` và mọi UI phụ thuộc

**Câu hỏi 2 — nếu chọn (a), ngưỡng cảnh báo:**

| Mức | Đề xuất của tôi | Bạn muốn đổi? |
|---|---|---|
| 🔴 `danger` | HĐ đã hết hạn **hoặc** lao động < **70%** cam kết | |
| 🟠 `warn` | HĐ còn ≤ **30 ngày** **hoặc** lao động < **90%** cam kết | |
| 🟢 `ok` | còn lại | |

**Việc làm:** thêm hàm dùng chung, áp cho 4 nơi: `Workspace.tsx:310`, `Clients.tsx:1149` + `:1887`, `ClientDetail.tsx:693`, `AlertsTasksPanel.tsx:164`.

**Kết quả (theo số thật hiện tại):**

| | Trước | Sau |
|---|---|---|
| Rail "KH cần chú ý" | 0 khách | **≈ 8 khách** (4 hết hạn + 4 sắp hết) |
| Pill danh sách KH | 59/59 "Bình thường" | 4 "Hết hạn", 4 "Sắp hết", 51 "Bình thường" |
| AlertsTasksPanel | Nhánh chết | Chạy đúng |

⏱ 1 giờ · Rủi ro: trung bình — đổi hiển thị 4 màn hình · **Cần bạn quyết 2 câu**

---

## BƯỚC 2.4 — Khối liên hệ trong popup khách hàng *(lỗi 4)*

`clients.phone` / `clients.email` rỗng 100%, popup vẫn render khối trống.

**⚠️ Cần bạn quyết:** trỏ sang bảng người liên hệ mới *(đề xuất)*, hay bỏ hẳn khối đó?

⏱ 20 phút · Rủi ro: rất thấp · **Cần bạn quyết**

**→ CHỐT GIAI ĐOẠN 2.** Tổng ~3,5 giờ.

---

# GIAI ĐOẠN 3 — Gỡ bom hẹn giờ ⏰

> **Hạn chót: xong trước 12/2026.** Sang 01/2027 mọi biểu đồ lao động sẽ trộn số hai năm.
> Đây là giai đoạn rủi ro nhất — chia nhỏ nhất, mỗi bước có điểm dừng an toàn.

## BƯỚC 3.1 — Sao lưu + migration thêm cột `period`

**Việc của bạn, không phải của tôi.**

1. **Sao lưu `client_labor_history`** (703 dòng) — bắt buộc, làm trước tiên
2. Tôi đưa nội dung SQL, bạn dán vào Supabase SQL Editor
3. SQL chỉ **thêm cột mới**, không sửa/xoá dữ liệu cũ

**Điểm dừng an toàn:** sau bước này app chạy y như cũ, cột mới nằm đó chưa ai dùng. Dừng lại đây cũng không sao.

⏱ 20 phút · Rủi ro: thấp *(chỉ thêm cột)* · **Cần bạn: sao lưu + chạy SQL**

---

## BƯỚC 3.2 — Điền năm cho 703 bản ghi cũ

**Việc làm:** suy ra năm từ `created_at`, điền vào cột `period`. Logic **đã có sẵn và đã đúng** tại `src/utils/clientMdExport.ts:102` (hàm `inferLaborMonth`, xử lý được cả trường hợp nhập tháng 1/2027 cho nhãn T12/2026).

**Cách làm an toàn:**
1. Chạy thử **chế độ xem trước** — in ra 703 dòng sẽ điền gì, **chưa ghi**
2. Bạn xem bảng đó, xác nhận đúng
3. Mới chạy thật

**Kiểm chứng:** 703/703 dòng có `period`; tổng số lao động từng tháng **không đổi** so với mốc ở Bước 0

**Điểm dừng an toàn:** app vẫn chạy bằng logic cũ. Cột mới đã đầy nhưng chưa ai đọc.

⏱ 40 phút · Rủi ro: trung bình — **có ghi dữ liệu, đã sao lưu ở B3.1** · **Cần bạn duyệt bảng xem trước**

---

## BƯỚC 3.3 — Chuyển code sang dùng `period`

**Việc làm:** đổi `getMonthLast` (`src/lib/format.ts:27`) nhận `'YYYY-MM'` thay vì số tháng. Cập nhật mọi nơi gọi: Dashboard, Reports, Branches, ClientDetail. Mọi chỗ ghi mới đều điền `period`.

**Kiểm chứng:** so từng biểu đồ với mốc Bước 0 — **số phải y hệt** (dữ liệu hiện chỉ có 2026 nên không được phép đổi)

⏱ 1,5 giờ · Rủi ro: trung bình · **Không cần bạn quyết**

---

## BƯỚC 3.4 — Mở khoá xem nhiều năm + dọn dropdown *(lỗi 8)*

**Việc làm:**
- Bỏ giới hạn "không lùi quá T1 năm nay" ở biểu đồ Xu hướng lao động — giới hạn này chỉ tồn tại vì `week_label` thiếu năm, giờ hết lý do
- Thêm lựa chọn xem 18/24 tháng
- Sửa `startMonth = '2026-01'` ghi cứng (`Finance.tsx:152`, `:164`) thành cửa sổ trượt 18 tháng

**Kết quả:**

| | Trước | Sau |
|---|---|---|
| Xu hướng lao động | Chặn ở T1 năm nay | Xem xuyên năm, T8/2025 → T8/2026 |
| Dropdown tháng Tài chính | Phình vô hạn từ 2026-01 | Cửa sổ 18 tháng ổn định |
| Tháng 1/2027 | ❌ Trộn số 2 năm | ✅ Chính xác |

⏱ 40 phút · Rủi ro: thấp · **Không cần bạn quyết**

**→ CHỐT GIAI ĐOẠN 3.** Tổng ~3,5 giờ. Bom đã gỡ.

---

# GIAI ĐOẠN 4 — Việc nhập liệu của bạn

Không chặn giai đoạn nào, làm song song lúc nào cũng được.

| Việc | Lỗi | Nội dung |
|---|---|---|
| Chạy migration 082 | 11 | `082_branch_targets_renewal.sql`, rồi nhập mục tiêu doanh thu từng chi nhánh theo tháng → bật thanh % đạt mục tiêu ở Báo cáo |
| Nhập bù chi phí chung | 12 | Thiếu **T3, T4, T8**. Rà lại **T1, T2** — đang 10 triệu/tháng trong khi T5, T6 hơn 61 triệu, chênh 6 lần, nhiều khả năng nhập thiếu |

**Tôi có thể làm thêm:** thêm cảnh báo trên Báo cáo khi tháng đang xem chưa có chi phí chung, để không đọc nhầm lợi nhuận. ⏱ 20 phút — **bạn muốn không?**

---

# GIAI ĐOẠN 5 — Chống tái phát

> Đây mới là thứ trị gốc "ít hôm lại phát hiện lỗi 1 lần".

Hạ tầng test **đã sẵn sàng** — `vitest` đang chạy tốt với 203 test. Vấn đề là 203 test đó đều nằm ở module lương/báo giá, còn Dashboard, Tài chính, Báo cáo, Khách hàng, Chi nhánh, Workspace thì **không có test nào**.

**Việc làm:** phủ test cho các hàm tính số liệu — `calcPnl`, `getMonthLast`, gộp chi nhánh, tổng hợp tài chính, trạng thái khách hàng, khung trục biểu đồ.

**Kết quả:** đúng loại lỗi trong tài liệu này sẽ bị chặn **trước khi lên production**, thay vì đợi bạn tình cờ nhìn thấy.

⏱ 3 giờ · **Bạn muốn làm không?**

---

## Tổng thời gian

| Giai đoạn | Nội dung | Thời gian | Cần bạn |
|---|---|---|---|
| 0 | Chụp mốc số liệu | 15 phút | — |
| 1 | Sửa số tiền đang sai | ~2,5 giờ | 1 quyết định |
| 2 | Khôi phục chức năng chết | ~3,5 giờ | 5 quyết định |
| 3 | Gỡ bom `week_label` | ~3,5 giờ | Sao lưu + chạy SQL |
| 4 | Nhập liệu | — | Việc của bạn |
| 5 | Bộ test chống tái phát | ~3 giờ | Duyệt |
| | **Tổng** | **~12,5 giờ** | |

---

## Bảng quyết định — gom hết vào một chỗ

Trả lời được câu nào thì tôi chạy được bước đó.

| Bước | Câu hỏi | Đề xuất của tôi |
|---|---|---|
| 1.2 | Bảng tổng hợp theo dropdown tháng (A) hay giữ tháng hiện tại (B)? | **A** |
| 2.1 | 29 việc tái ký đã gán sai: gán lại / để nguyên / bạn tự xử lý? | **Gán lại** |
| 2.1 | Không tra được người phụ trách thì gán admin hay bỏ qua? | **Gán admin** |
| 2.2 | Nguồn thanh toán chuẩn: `finance_records` / `projects_pnl` / khác? | **Cần bạn cho biết** |
| 2.3 | Tính `status` tự động (A) hay bỏ hẳn (B)? | **A** |
| 2.3 | Ngưỡng cảnh báo lao động thiếu: 70% / 90%? | **70% / 90%** |
| 2.4 | Khối liên hệ: trỏ danh bạ mới hay bỏ? | **Trỏ danh bạ mới** |
| 4 | Thêm cảnh báo thiếu chi phí chung? | **Nên** |
| 5 | Làm bộ test chống tái phát? | **Nên** |

---

## Đề xuất khởi động

Chạy **Bước 0 → 1.1 → 1.2** liền mạch. Lý do:

- Bước 0 và 1.1 **không đổi một pixel nào** trên giao diện — an toàn tuyệt đối
- Xong 1.1 là có lưới an toàn, sửa gì cũng biết ngay đúng/sai
- 1.2 là bước đáng giá nhất: sửa con số sai tiền tỷ mà bạn nhìn mỗi ngày

Chỉ cần bạn trả lời **một câu**: bước 1.2 chọn phương án **A** hay **B**?

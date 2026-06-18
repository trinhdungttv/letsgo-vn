# Tài liệu Kỹ thuật Hệ thống Letsgo VN

> Phiên bản tài liệu: 1.0 | Ngày tạo: 2026-06-18
> Ngôn ngữ: Tiếng Việt kỹ thuật | Mục đích: Tham chiếu nội bộ và tích hợp AI

---

## Mục lục

1. [Cấu trúc Dự án](#1-cấu-trúc-dự-án)
2. [Mô hình Dữ liệu](#2-mô-hình-dữ-liệu)
3. [Logic Nghiệp vụ Cốt lõi](#3-logic-nghiệp-vụ-cốt-lõi)
4. [Xác thực và Phân quyền](#4-xác-thực-và-phân-quyền)
5. [Kiến trúc Hooks và Luồng Dữ liệu](#5-kiến-trúc-hooks-và-luồng-dữ-liệu)
6. [Cấu hình Môi trường](#6-cấu-hình-môi-trường)

---

## 1. Cấu trúc Dự án

### 1.1 Tech Stack

| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| Ngôn ngữ lập trình | TypeScript | 5.5.3 |
| UI Framework | React | 18.3.1 |
| Build Tool | Vite | 5.4.2 |
| CSS Framework | Tailwind CSS | 3.4.1 |
| Backend / Database | Supabase (PostgreSQL) | 2.57.4 |
| Biểu đồ dữ liệu | Chart.js + react-chartjs-2 | 4.5.1 |
| Xuất Excel | ExcelJS | 4.4.0 |
| Nhập Excel | XLSX | 0.18.5 |
| Bộ icon UI | Lucide React | 0.344.0 |
| AI tích hợp | Google Gemini API | (qua gemini.ts) |
| Linting | ESLint + TypeScript ESLint | 9.9.1 / 8.3.0 |

Kiến trúc tổng thể là **Single Page Application (SPA)** thuần client-side. Không có backend riêng biệt; toàn bộ nghiệp vụ giao tiếp trực tiếp với Supabase Cloud thông qua Supabase JS Client. Xác thực sử dụng bảng `app_users` tự quản lý (không dùng Supabase Auth).

### 1.2 Sơ đồ Thư mục

```
letsgo-vn/
├── src/
│   ├── App.tsx                          # Bộ định tuyến chính (page-based routing), wrapper xác thực
│   ├── main.tsx                         # Điểm khởi động ứng dụng React
│   ├── lib/                             # Tiện ích, kiểu dữ liệu, kết nối hệ thống
│   │   ├── types.ts                     # Toàn bộ TypeScript interfaces (800+ dòng)
│   │   ├── supabase.ts                  # Khởi tạo Supabase client
│   │   ├── auth.tsx                     # Context xác thực, phân quyền, vai trò
│   │   ├── audit.ts                     # Ghi nhật ký hoạt động và hàm hoàn tác (undo)
│   │   ├── format.ts                    # Hàm định dạng ngày, tiền tệ, tính điểm sức khỏe
│   │   ├── constants.ts                 # Hằng số ứng dụng (chi nhánh, vai trò, giai đoạn CRM)
│   │   ├── clientImport.ts              # Nhập/xuất khách hàng qua file Excel
│   │   ├── pipelineHelpers.ts           # Tiện ích cho CRM pipeline
│   │   ├── paymentDate.ts               # Tính toán ngày thanh toán
│   │   ├── appSettings.ts               # Cấu hình ứng dụng
│   │   └── gemini.ts                    # Tích hợp Google Gemini AI
│   ├── hooks/                           # Custom React Hooks (tải và quản lý dữ liệu)
│   │   ├── useAppData.ts                # Dữ liệu lõi: khách hàng, lịch sử lao động, thị trường
│   │   ├── useCRMData.ts                # Dữ liệu CRM: leads, pipeline, deals, hoạt động
│   │   ├── useFinanceData.ts            # P&L, chi phí chi nhánh, cấu hình phân chia lợi nhuận
│   │   ├── useContacts.ts               # Danh sách liên hệ của từng khách hàng
│   │   ├── useManagers.ts               # CRUD danh sách quản lý
│   │   ├── useRegions.ts                # Danh sách chi nhánh / khu vực
│   │   ├── useBranchData.ts             # Dữ liệu hồ sơ chi nhánh
│   │   ├── usePayrollStaffs.ts          # CRUD nhân sự tính lương
│   │   └── usePersistedState.ts         # useState được lưu vào localStorage
│   ├── pages/                           # Các trang ứng dụng (mỗi file = một trang)
│   │   ├── Login.tsx                    # Màn hình đăng nhập
│   │   ├── Dashboard.tsx                # Tổng quan doanh thu, sức khỏe hợp đồng
│   │   ├── Clients.tsx                  # Danh sách khách hàng, bộ lọc, nhập liệu hàng loạt
│   │   ├── ClientDetail.tsx             # Chi tiết từng khách hàng: liên hệ, tài liệu, lịch sử LĐ
│   │   ├── Branches.tsx                 # Quản lý hồ sơ chi nhánh
│   │   ├── Finance.tsx                  # Dữ liệu tài chính tháng, timeline thu chi
│   │   ├── Market.tsx                   # Module thị trường: KCN, khảo sát lương, đối thủ
│   │   ├── Workspace.tsx                # Ưu tiên buổi sáng, win/loss, KCN grid, nhiệm vụ treo
│   │   ├── Reports.tsx                  # Phân tích và báo cáo tổng hợp
│   │   ├── UserManagement.tsx           # Quản lý tài khoản người dùng
│   │   ├── History.tsx                  # Xem nhật ký hoạt động, hỗ trợ hoàn tác
│   │   ├── AdminPage.tsx                # Cấu hình admin, ma trận phân quyền
│   │   ├── CRMDash.tsx                  # Tổng quan CRM
│   │   ├── CRMBoard.tsx                 # Bảng Kanban deals
│   │   ├── CRMLeads.tsx                 # Quản lý leads
│   │   ├── CRMPipeline.tsx              # Theo dõi pipeline bán hàng
│   │   ├── CRMProds.tsx                 # Danh mục sản phẩm/dịch vụ
│   │   ├── CRMDeal.tsx                  # Chi tiết từng deal
│   │   ├── CSKH.tsx                     # Nhật ký chăm sóc khách hàng
│   │   └── Quotes.tsx                   # Tạo báo giá
│   ├── components/                      # Các component tái sử dụng
│   │   ├── Sidebar.tsx                  # Thanh điều hướng chính
│   │   ├── PageHeader.tsx               # Tiêu đề trang
│   │   ├── AlertsTasksPanel.tsx         # Bảng cảnh báo và nhiệm vụ
│   │   ├── AdminSettings.tsx            # Cài đặt hiển thị cột, NS tính lương
│   │   ├── FilterDropdown.tsx           # Bộ lọc chi nhánh / quản lý
│   │   ├── ContactsTab.tsx              # Tab liên hệ trong ClientDetail
│   │   ├── FinanceTimeline.tsx          # Biểu đồ timeline tài chính
│   │   ├── SalesTaskBoard.tsx           # Bảng nhiệm vụ bán hàng
│   │   ├── clients/                     # Components con cho trang Clients
│   │   │   ├── HealthScoreRing.tsx      # Vòng tròn điểm sức khỏe (0-100)
│   │   │   ├── ChurnBadge.tsx           # Huy hiệu cảnh báo rủi ro mất khách
│   │   │   └── CycleTrack.tsx           # Thanh tiến trình chu kỳ thanh toán
│   │   ├── crm/                         # Components CRM
│   │   │   └── CompanyProfileModal.tsx  # Modal hồ sơ chăm sóc: ghi chú, phụ lục, lịch sử
│   │   ├── finance/                     # Components tài chính
│   │   └── workspace/                   # Components Workspace
│   │       ├── MorningPrioritySection.tsx  # Ưu tiên buổi sáng + theo dõi chi nhánh
│   │       ├── WinLossSection.tsx          # Theo dõi thắng/thua thương vụ
│   │       ├── KCNGridSection.tsx          # Lưới KCN tổng quan
│   │       ├── WorkTasksCard.tsx           # Thẻ nhiệm vụ công việc
│   │       └── WorkspaceModulesTabs.tsx    # Tab điều hướng trong Workspace
│   └── utils/
│       └── healthScore.ts               # Hàm tính điểm sức khỏe hợp đồng
├── supabase/
│   └── migrations/                      # 55 file migration SQL (001 -> 055)
├── public/                              # Tài nguyên tĩnh
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.app.json
├── tailwind.config.js
└── .env                                 # Biến môi trường (URL + ANON_KEY Supabase)
```

---

## 2. Mô hình Dữ liệu

Toàn bộ dữ liệu được lưu trữ trên Supabase (PostgreSQL). Có 55 file migration định nghĩa lược đồ. Tất cả bảng sử dụng UUID làm khóa chính và bật Row-Level Security (RLS) ở mức permissive (cho phép anon + authenticated).

### 2.1 Nhóm Bảng Khách hàng và Hợp đồng

#### Bảng `clients` - Thực thể trung tâm của hệ thống

Bảng thống nhất cả khách hàng đang hoạt động (`client_type = 'active'`) và đối tượng tiềm năng (`client_type = 'prospect'`).

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | Định danh duy nhất |
| name | TEXT NOT NULL | Tên công ty |
| region | TEXT | Chi nhánh phụ trách |
| manager | TEXT | Tên quản lý phụ trách |
| client_type | TEXT | `'active'` hoặc `'prospect'` |
| industrial_zones | TEXT[] | Mảng tên KCN đang hoạt động |
| min_workers | INTEGER | Số lao động tối thiểu cam kết |
| cutoff_day / cutoff_day_end | INTEGER | Ngày chốt công (đầu / cuối kỳ) |
| calc_day / calc_day_end | INTEGER | Ngày tính lương |
| invoice_day / invoice_day_end | INTEGER | Ngày xuất hóa đơn |
| payment_start / payment_end | INTEGER | Kỳ thanh toán |
| salary_day / salary_day_end | INTEGER | Ngày trả lương |
| next_month_pay | BOOLEAN | Thanh toán vào tháng sau |
| contract_start / contract_end | DATE | Hiệu lực hợp đồng |
| notes | TEXT | Ghi chú tổng hợp |
| status | TEXT | `'ok'`, `'warn'`, `'danger'` |
| paid_this_month | BOOLEAN | Đã thanh toán tháng này |
| prog_cutoff / prog_calc / prog_paid | BOOLEAN | Tiến độ chu kỳ |
| pipeline_stage | TEXT | Giai đoạn CRM (nếu là prospect) |
| won_date | DATE | Ngày chốt hợp đồng |
| source / crm_owner | TEXT | Nguồn khách / người phụ trách CRM |
| phone / email | TEXT | Thông tin liên hệ công ty |
| prospect_status | TEXT | `'lead'`, `'prospect'`, `'customer'`, `'churned'` |
| archived_at | TIMESTAMPTZ | Xóa mềm (soft delete) |
| cooperation_status | TEXT | `'active'` hoặc `'suspended'` |
| suspension_reason / suspended_at | TEXT / TIMESTAMPTZ | Lý do và thời điểm đình chỉ |
| payment_group / payment_days / ... | Nhiều kiểu | Cấu hình chi tiết kỳ thanh toán |
| payroll_staff | TEXT | Tên nhân sự tính lương |
| created_at / updated_at | TIMESTAMPTZ | Thời gian tạo / cập nhật |

#### Bảng `client_labor_history` - Lịch sử số lao động

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | Khách hàng |
| week_label | TEXT | Tuần lao động, định dạng `"YYYY-WNN"` |
| count | INTEGER | Số lao động thực tế tuần đó |
| updated_by | TEXT | Người cập nhật |
| created_at | TIMESTAMPTZ | |

#### Bảng `client_manager_history` - Lịch sử bàn giao quản lý

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | |
| manager_name | TEXT | Tên quản lý |
| effective_from | TEXT | Tháng bắt đầu `"YYYY-MM"` |
| created_by | TEXT | Người tạo bản ghi |

#### Bảng `contacts` - Đầu mối liên hệ

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients, nullable) | Khách hàng liên quan |
| name | TEXT | Tên người liên hệ |
| phone / email | TEXT | Liên hệ |
| role | TEXT | Chức danh |
| start_date / end_date | DATE | Thời gian công tác |
| is_active / is_primary | BOOLEAN | Trạng thái và ưu tiên |
| birthday | DATE | Ngày sinh (phục vụ chăm sóc KH) |
| hobbies / social_link | TEXT | Thông tin cá nhân |
| channel | TEXT | Kênh liên lạc ưu tiên |
| notes / rich_notes | TEXT | Ghi chú thường / ghi chú định dạng |

#### Bảng `client_documents` - Tài liệu đính kèm

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | |
| name | TEXT | Tên tài liệu |
| file_url / file_path | TEXT | Đường dẫn Supabase Storage |
| doc_type | TEXT | `'contract'`, `'appendix'`, `'other'` |
| uploaded_by | TEXT | Người tải lên |

#### Bảng `client_gifts` - Quà tặng khách hàng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | |
| item_name | TEXT | Tên quà |
| value | TEXT | Giá trị ước tính |
| gift_date | DATE | Ngày tặng |
| recipient_name | TEXT | Người nhận |
| created_by | TEXT | Người tạo bản ghi |

#### Bảng `cskh_logs` - Nhật ký chăm sóc khách hàng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients, nullable) | |
| client_name / contact_person | TEXT | |
| contact_type | TEXT | `'call'`, `'email'`, `'zalo'`, `'meeting'` |
| content | TEXT | Nội dung trao đổi |
| followup | TEXT | Công việc cần theo dõi |
| followup_done | BOOLEAN | Đã xử lý chưa |
| log_date | DATE | Ngày ghi nhận |

---

### 2.2 Nhóm Bảng Tài chính

#### Bảng `finance_records` - Dữ liệu tài chính tháng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | |
| month | TEXT | `"YYYY-MM"` |
| revenue | NUMERIC | Doanh thu |
| cost_labor / cost_mgmt / cost_other | NUMERIC | Chi phí lao động / quản lý / khác |
| commission_rate | NUMERIC | Tỷ lệ hoa hồng (mặc định 0.05) |
| paid_status | BOOLEAN | Đã thanh toán chưa |
| paid_date | DATE | Ngày thanh toán thực tế |

#### Bảng `projects_pnl` - Dự án Lãi/Lỗ

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | |
| month | TEXT | `"YYYY-MM"` |
| branch_manager | TEXT | Tên quản lý chi nhánh |
| project_type | TEXT | `'shared'` hoặc `'managed'` |
| lg_pct / cn_pct | NUMERIC | Tỷ lệ phân chia lợi nhuận (Letsgo / Chi nhánh) |
| revenue | NUMERIC | Doanh thu dự án |
| split_temp_until | TEXT | Phân chia tạm thời đến tháng |
| split_reverted | BOOLEAN | Đã hoàn về phân chia gốc |

#### Bảng `projects_pnl_costs` - Dòng chi phí trong P&L

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| pnl_id | UUID (FK -> projects_pnl) | |
| label | TEXT | Mô tả chi phí |
| value | NUMERIC | Giá trị |
| payer | TEXT | `'lg'`, `'cn'`, `'ch'` (Letsgo / Chi nhánh / Khách hàng) |
| sort_order | INTEGER | Thứ tự hiển thị |

#### Bảng `pnl_split_settings` - Cấu hình phân chia lợi nhuận

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | |
| lg_pct / cn_pct | NUMERIC | Tỷ lệ mặc định |
| pending_lg_pct / pending_cn_pct | NUMERIC | Tỷ lệ tạm thời |
| pending_until_month | TEXT | Hiệu lực tạm thời đến tháng |

#### Bảng `branch_overhead` - Chi phí vận hành chi nhánh

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| branch_manager | TEXT | |
| month | TEXT | `"YYYY-MM"` |
| label | TEXT | Danh mục chi phí |
| value | NUMERIC | Giá trị |
| cost_type | TEXT | `'Cố định'` hoặc `'Biến đổi'` |

---

### 2.3 Nhóm Bảng CRM

#### Bảng `crm_pipeline` - Danh sách đối tượng tiềm năng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients, nullable) | Liên kết khi chuyển thành khách hàng |
| company_name | TEXT NOT NULL | Tên công ty |
| region | TEXT | Chi nhánh phụ trách |
| worker_estimate | INTEGER | Ước tính lao động |
| stage | TEXT | `'tiem-nang'`, `'dang-lh'`, `'quan-tam'`, `'dam-phan'`, `'hop-tac'` |
| sub_status | TEXT | Trạng thái con trong giai đoạn |
| last_contact | DATE | Ngày liên hệ gần nhất |
| contact_id | UUID (FK -> contacts) | Đầu mối liên hệ chính |
| product_id | UUID (FK -> crm_products) | Sản phẩm đang đàm phán |
| custom_price | NUMERIC | Giá tùy chỉnh |
| notes | TEXT | Ghi chú |

#### Bảng `crm_interactions` - Nhật ký tương tác pipeline

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| crm_id | UUID (FK -> crm_pipeline) | |
| interaction_date | DATE | |
| interaction_type | TEXT | `'call'`, `'email'`, `'meeting'`, `'note'` |
| content | TEXT | Nội dung trao đổi |

#### Bảng `crm_pipeline_tasks` - Nhiệm vụ gắn với pipeline

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| crm_id | UUID (FK -> crm_pipeline) | |
| title | TEXT | Tiêu đề nhiệm vụ |
| due_date | DATE | Hạn hoàn thành |
| status | TEXT | `'pending'`, `'in_progress'`, `'done'` |
| doc_status | TEXT | Trạng thái hồ sơ: `'chua_soan'`, `'dang_soan'`, `'cho_duyet'`, `'cho_kh_ky'`, `'hoan_tat'`, `'ngung_hd'` |
| result_note | TEXT | Ghi chú kết quả |

#### Bảng `pipeline_appendices` - Phụ lục hợp đồng (versioned)

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| crm_id | UUID (FK -> crm_pipeline) | |
| version_label | TEXT | Nhãn phiên bản, ví dụ `"PL - Lần 1"` |
| content | TEXT | Nội dung phụ lục |
| created_by | TEXT | Người tạo |

#### Bảng `crm_gifts` - Quà tặng đối tượng tiềm năng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| crm_id | UUID (FK -> crm_pipeline) | |
| gift_date | DATE | |
| item_name | TEXT | Tên quà |
| value | TEXT | Giá trị |
| recipient_contact_id | UUID (FK -> contacts) | |
| recipient_name | TEXT | |

#### Bảng `crm_leads` - Leads (giai đoạn đầu)

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT NOT NULL | Tên khách hàng tiềm năng |
| phone / email / company | TEXT | Thông tin liên hệ |
| source | TEXT | Nguồn lead (mặc định `'website'`) |
| status | TEXT | Trạng thái lead |
| owner | TEXT | Người phụ trách |

#### Bảng `crm_products` - Danh mục sản phẩm/dịch vụ

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT NOT NULL | |
| price | NUMERIC | Đơn giá |
| sku | TEXT | Mã sản phẩm |
| category | TEXT | Phân loại |
| industry | TEXT | Ngành áp dụng |

#### Bảng `crm_deals` - Thương vụ

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| title | TEXT NOT NULL | |
| lead_id | UUID (FK -> crm_leads, nullable) | |
| contact_id | UUID (FK -> contacts, nullable) | |
| product_id | UUID (FK -> crm_products, nullable) | |
| client_id | UUID (FK -> clients, nullable) | Liên kết khi kích hoạt |
| value | NUMERIC | Giá trị thương vụ |
| stage | TEXT | `'new'`, `'contacted'`, `'in_progress'`, `'proposal'`, `'won'`, `'lost'` |
| owner | TEXT | Người phụ trách |
| expected_closing_date | DATE | Ngày dự kiến chốt |
| probability | INTEGER | Xác suất thành công (0-100) |

#### Bảng `crm_activities` - Hoạt động gắn với deal

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| deal_id | UUID (FK -> crm_deals) | |
| type | TEXT | `'call'`, `'email'`, `'note'`, `'meeting'` |
| content | TEXT | Nội dung |
| created_by | TEXT | |

---

### 2.4 Nhóm Bảng Thị trường

#### Bảng `market_zones` - Hồ sơ Khu công nghiệp (KCN)

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT UNIQUE | Tên viết tắt KCN |
| full_name | TEXT | Tên đầy đủ |
| location / province | TEXT | Địa điểm / tỉnh thành |
| operator | TEXT | Ban quản lý KCN |
| area | TEXT | Diện tích |
| established_year | TEXT | |
| occupancy_pct | INTEGER | Tỷ lệ lấp đầy (%) |
| total_companies / fdi_companies | INTEGER | |
| total_workers | INTEGER | |
| industries / countries | TEXT[] | Ngành nghề / quốc gia đầu tư |
| lgv_clients / lgv_workers | INTEGER | Số khách hàng và lao động Letsgo tại đây |
| potential | INTEGER | Điểm tiềm năng 1-5 |
| last_visit_date | DATE | Ngày thăm quan gần nhất |
| characteristics / strengths / weaknesses | TEXT | Phân tích SWOT cơ bản |
| labor_availability | TEXT | Mức độ sẵn có lao động |

#### Bảng `market_surveys` - Khảo sát mức lương

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| zone_name | TEXT | Tên KCN |
| survey_date | DATE | Ngày khảo sát |
| industry | TEXT | Ngành nghề |
| wage_unskilled_min / max | NUMERIC | Lương lao động phổ thông |
| wage_seasonal_min / max | NUMERIC | Lương thời vụ |
| wage_skilled_min / max | NUMERIC | Lương lao động có tay nghề |
| wage_tech | NUMERIC | Lương kỹ thuật viên |
| surveyed_by | TEXT | Người khảo sát |

#### Bảng `competitors` - Theo dõi đối thủ cạnh tranh

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| zone_name | TEXT | KCN hoạt động |
| company_name | TEXT | Tên công ty đối thủ |
| wage_paid / fee_unskilled / fee_skilled / fee_tech | NUMERIC | Mức trả cho lao động và phí cung ứng |
| supplying_for | TEXT[] | Các nhà máy đang phục vụ |
| trend | TEXT | `'stable'`, `'up'`, `'down'` |

#### Bảng `market_leads` - Dự án tiềm năng trên thị trường

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| company_name | TEXT | |
| region / industry | TEXT | |
| workers_needed | INTEGER | Nhu cầu lao động |
| suppliers | JSONB | Mảng `[{name, qty, is_us}]` - nhà cung cấp hiện tại |
| status | TEXT | Trạng thái theo dõi |

#### Bảng `kcn_visits` - Nhật ký thăm quan KCN

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| zone_id | UUID (FK -> market_zones) | |
| user_id | UUID (FK -> app_users) | Người thực hiện |
| visit_date | DATE | |
| status | TEXT | `'planned'` hoặc `'done'` |
| report_summary | TEXT | Tóm tắt báo cáo |
| occupancy_note / labor_note / wage_note / competitor_note | TEXT | Ghi chú theo chủ đề |

---

### 2.5 Nhóm Bảng Vận hành (Workspace)

#### Bảng `morning_priorities` - Ưu tiên công việc buổi sáng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| user_id | UUID (FK -> app_users) | |
| priority_date | DATE | Ngày làm việc |
| target_name | TEXT | Tên khách hàng hoặc `"Chi nhánh {region}"` |
| target_kcn | TEXT | KCN liên quan |
| goal_type | TEXT | Mục tiêu: `'tai_ky'`, `'chot_bao_gia'`, `'follow_up'`, `'tham_quan'`, `'hoi_tham'`, `'cap_nhat'`, `'kho_khan'`, `'other'` |
| goal_note | TEXT | Mô tả mục tiêu |
| outcome_note | TEXT | Kết quả thực tế |
| outcome_status | TEXT | `'done'`, `'partial'`, `'missed'` |
| Ràng buộc | | UNIQUE(user_id, priority_date, target_name) |

#### Bảng `work_tasks` - Nhiệm vụ công việc

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| user_id | UUID (FK -> app_users) | Người được giao |
| client_id | UUID (FK -> clients, nullable) | Khách hàng liên quan |
| title | TEXT | Tiêu đề nhiệm vụ |
| task_type | TEXT | `'Tái ký HĐ'`, `'Báo giá'`, v.v. |
| due_date | DATE | Hạn hoàn thành |
| priority | TEXT | `'high'`, `'medium'`, `'low'` |
| status | TEXT | `'pending'`, `'in_progress'`, `'done'`, `'ngung_hd'` |
| doc_status | TEXT | Trạng thái hồ sơ (6 bước từ soạn đến hoàn tất) |
| completed_at | TIMESTAMPTZ | Thời điểm hoàn thành |

#### Bảng `work_task_comments` - Bình luận trên nhiệm vụ

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| task_id | UUID (FK -> work_tasks) | |
| user_id | UUID (FK -> app_users) | |
| user_name | TEXT | |
| content | TEXT | Nội dung bình luận |

#### Bảng `win_loss_records` - Theo dõi thắng/thua thương vụ

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| user_id | UUID (FK -> app_users) | |
| client_name | TEXT | |
| deal_type | TEXT | `'new_client'`, `'renewal'`, `'expansion'` |
| result | TEXT | `'win'`, `'loss'`, `'pending'` |
| labor_count | INTEGER | Số lao động thương vụ |
| monthly_value | NUMERIC | Giá trị hàng tháng |
| loss_reason | TEXT | Lý do thua: `'price'`, `'labor_quality'`, `'competitor'`, v.v. |
| competitor_name | TEXT | Tên đối thủ thắng |
| days_to_close | INTEGER | GENERATED ALWAYS (tính từ ngày tiếp xúc đến chốt) |

#### Bảng `cooperation_suspension_requests` - Yêu cầu đình chỉ hợp tác

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_id | UUID (FK -> clients) | |
| task_id | UUID (FK -> work_tasks, nullable) | |
| requester_id / requester_name | UUID / TEXT | Người yêu cầu |
| reason | TEXT | Lý do |
| status | TEXT | `'pending'`, `'approved'`, `'rejected'` |
| reviewed_by / reviewed_at | TEXT / TIMESTAMPTZ | Người duyệt |

---

### 2.6 Nhóm Bảng Tổ chức

#### Bảng `regions` - Chi nhánh / Khu vực

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT | Tên chi nhánh |

#### Bảng `managers` - Quản lý

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT | |
| phone / email | TEXT | |
| region | TEXT | Chi nhánh phụ trách |

#### Bảng `branches` - Hồ sơ Chi nhánh

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| name / short_name | TEXT | Tên đầy đủ / rút gọn |
| manager_id / manager_name | UUID / TEXT | Quản lý chi nhánh |
| address / phone / email | TEXT | Thông tin liên hệ |
| region / location | TEXT | Khu vực / địa điểm |
| status | TEXT | `'active'` hoặc `'paused'` |
| notes | TEXT | Ghi chú chung |
| status_note | TEXT | Tình trạng hiện tại |
| difficulties | TEXT | Khó khăn đang gặp |
| opportunities | TEXT | Cơ hội phát triển |

#### Bảng `payroll_staffs` - Nhân sự tính lương

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT | Tên nhân sự |
| created_at | TIMESTAMPTZ | |

#### Bảng `quotes` - Báo giá

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| client_name | TEXT | |
| tax_code / address | TEXT | |
| zone | TEXT | KCN cung ứng |
| price_unskilled / price_skilled / price_tech | NUMERIC | Đơn giá theo loại lao động |
| status | TEXT | `'draft'`, v.v. |

---

### 2.7 Nhóm Bảng Hệ thống (Admin & Audit)

#### Bảng `app_users` - Tài khoản người dùng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| username | TEXT UNIQUE | Tên đăng nhập |
| password | TEXT | Mật khẩu (lưu plaintext - cần hash trong môi trường production) |
| full_name | TEXT | Tên hiển thị |
| role | TEXT | `'admin'`, `'ketoan'`, `'kinhdoanh'`, `'bdh'` |
| is_active | BOOLEAN | Trạng thái hoạt động |

#### Bảng `audit_logs` - Nhật ký hoạt động

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| user_id / user_name | UUID / TEXT | Người thực hiện |
| action | TEXT | `'insert'`, `'update'`, `'delete'` |
| table_name | TEXT | Bảng bị tác động |
| record_id | UUID | Bản ghi bị tác động |
| description | TEXT | Mô tả hành động |
| old_data / new_data | JSONB | Snapshot dữ liệu trước / sau |
| undone | BOOLEAN | Đã hoàn tác chưa |

#### Bảng `role_permissions` - Ma trận phân quyền theo vai trò

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| role | TEXT | Vai trò người dùng |
| module | TEXT | Tên module ứng dụng |
| level | TEXT | `'full'`, `'view'`, `'none'` |

#### Bảng `user_permissions` - Phân quyền cấp người dùng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| user_email | TEXT | |
| module | TEXT | |
| can_view / can_edit / can_delete / can_export | BOOLEAN | |
| granted_by | TEXT | Người cấp quyền |

#### Bảng `permission_requests` - Yêu cầu cấp quyền

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | UUID (PK) | |
| requester_email / requester_name / requester_role | TEXT | |
| module | TEXT | Module yêu cầu truy cập |
| action_requested | TEXT | `'view'`, `'edit'`, `'delete'`, `'export'` |
| reason | TEXT | Lý do yêu cầu |
| status | TEXT | `'pending'`, `'approved'`, `'rejected'` |

#### Bảng `app_settings` - Cấu hình ứng dụng

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| key | TEXT (PK) | Khóa cấu hình |
| value | TEXT / JSONB | Giá trị |
| updated_at | TIMESTAMPTZ | |

---

### 2.8 Sơ đồ Quan hệ

```
clients (thực thể trung tâm)
├── [1:N] client_labor_history        (số lao động hàng tuần)
├── [1:N] finance_records             (tài chính hàng tháng)
├── [1:N] client_manager_history      (lịch sử quản lý)
├── [1:N] contacts                    (đầu mối liên hệ)
├── [1:N] client_gifts                (quà tặng)
├── [1:N] client_documents            (hợp đồng, tài liệu)
├── [1:N] cskh_logs                   (nhật ký chăm sóc)
├── [1:N] projects_pnl                (dự án P&L)
│   └── [1:N] projects_pnl_costs      (dòng chi phí)
├── [1:1] pnl_split_settings          (tỷ lệ phân chia)
├── [1:N] work_tasks                  (nhiệm vụ)
│   └── [1:N] work_task_comments      (bình luận)
└── [1:N] win_loss_records            (thắng/thua, tùy chọn)

crm_pipeline (đối tượng tiềm năng)
├── [1:N] crm_interactions            (nhật ký tương tác)
├── [1:N] crm_pipeline_tasks          (nhiệm vụ pipeline)
├── [1:N] crm_gifts                   (quà tặng)
├── [1:N] pipeline_appendices         (phụ lục hợp đồng - có versioning)
├── [N:1] contacts                    (đầu mối liên hệ chính)
├── [N:1] crm_products                (sản phẩm đàm phán)
└── [N:1] clients                     (nullable - liên kết khi chốt)

crm_leads
└── [1:N] crm_deals
    └── [1:N] crm_activities

market_zones
├── [1:N] market_surveys              (khảo sát lương)
├── [1:N] competitors                 (đối thủ tại KCN)
└── [1:N] kcn_visits                  (nhật ký thăm quan)

managers
└── [N:1] regions

branches
├── [N:1] managers                    (quản lý chi nhánh)
└── [1:N] branch_overhead             (chi phí vận hành)

app_users
├── [1:N] morning_priorities
├── [1:N] work_tasks
├── [1:N] win_loss_records
├── [1:N] kcn_visits
└── [1:N] audit_logs
```

---

## 3. Logic Nghiệp vụ Cốt lõi

### 3.1 Luồng Quản lý Lao động (Workforce Management)

Đây là luồng cốt lõi nhất của hệ thống:

1. **Tạo khách hàng**: Nhân viên kinh doanh tạo bản ghi `clients` với `client_type = 'active'`, thiết lập chu kỳ (cutoff_day, calc_day, payment_start, salary_day).
2. **Cập nhật số lao động hàng tuần**: Người dùng double-click ô "LĐ" trong bảng `Clients.tsx`, nhập số lao động thực tế -> ghi vào `client_labor_history` với `week_label` theo định dạng ISO week.
3. **Theo dõi tiến độ chu kỳ**: Các cờ `prog_cutoff`, `prog_calc`, `prog_paid` trên bảng `clients` được cập nhật thủ công để theo dõi trạng thái từng bước trong chu kỳ thanh toán tháng.
4. **Cảnh báo tự động trên Dashboard**: Hàm `calcHealthScore()` trong `src/utils/healthScore.ts` tính điểm sức khỏe (0-100) dựa trên: số lao động hiện tại so với tối thiểu, trạng thái thanh toán, ngày hết hạn hợp đồng, xu hướng lao động 6 tuần gần nhất.
5. **Phát hiện rủi ro mất khách**: Hàm `detectChurnRisk()` phân tích mảng `wHistory` (6 tuần) -> trả về `'high'`, `'medium'`, `null` dựa trên xu hướng giảm liên tiếp.

### 3.2 Luồng CRM và Chuyển đổi Khách hàng

1. **Tạo lead**: Nhập thông tin vào bảng `crm_pipeline` hoặc `crm_leads` với `stage = 'tiem-nang'`.
2. **Tiến trình pipeline**: Cập nhật `stage` qua các bước: `tiem-nang` -> `dang-lh` -> `quan-tam` -> `dam-phan` -> `hop-tac`.
3. **Ghi nhận tương tác**: Mỗi cuộc gọi, email, cuộc họp được ghi vào `crm_interactions` để theo dõi lịch sử liên lạc.
4. **Tạo phụ lục**: Hệ thống tự động đánh số phiên bản `"PL - Lần N"` khi tạo phụ lục trong `pipeline_appendices`. Có chức năng xem diff side-by-side giữa các phiên bản.
5. **Kích hoạt thành khách hàng**: Khi deal thắng, bản ghi trong `crm_pipeline` hoặc `crm_deals` được liên kết với `clients` thông qua cột `client_id`.

### 3.3 Luồng Tài chính và P&L

1. **Nhập dữ liệu tài chính tháng**: Kế toán nhập doanh thu và chi phí vào `finance_records` cho từng khách hàng và tháng.
2. **Timeline Tài chính**: Trang `Finance.tsx` hiển thị timeline trực quan cho mỗi khách hàng với các mốc: Chốt công -> Tính lương -> Xuất HĐ -> Kỳ thanh toán. Mỗi mốc được hiển thị bằng marker màu sắc riêng trên biểu đồ Chart.js.
3. **Phân chia P&L**: Bảng `pnl_split_settings` lưu tỷ lệ phân chia lợi nhuận mặc định giữa Letsgo và Chi nhánh (lg_pct / cn_pct). Hỗ trợ tỷ lệ tạm thời (`pending_lg_pct`) có giới hạn thời gian.
4. **Chi phí Chi nhánh**: Bảng `branch_overhead` ghi nhận chi phí cố định và biến đổi của từng chi nhánh theo tháng, phục vụ tính P&L thực.

### 3.4 Luồng Workspace - Vận hành Hàng ngày

1. **Ưu tiên buổi sáng (Morning Priority)**:
   - Nhân viên kinh doanh chọn khách hàng/chi nhánh cần xử lý trong ngày từ danh sách `clients` hoặc `branches`.
   - Thiết lập `goal_type` và `goal_note` -> lưu vào `morning_priorities`.
   - Cuối ngày cập nhật `outcome_status` và `outcome_note`.
   - Ràng buộc UNIQUE(user_id, priority_date, target_name) đảm bảo mỗi đối tượng chỉ xuất hiện một lần mỗi ngày.

2. **Nhiệm vụ đang treo (Workspace Tasks)**:
   - Tạo nhiệm vụ độc lập trong bảng `workspace_tasks` (bảng riêng, không phải `work_tasks`).
   - Nhân viên có thể chỉnh sửa, xóa, hoặc đánh dấu hoàn thành.
   - Khi hoàn thành, bản ghi được lưu vào lịch sử với phân loại theo hạng mục.

3. **Theo dõi thắng/thua (Win/Loss)**:
   - Ghi nhận kết quả thương vụ vào `win_loss_records`.
   - Tính `days_to_close` tự động bằng GENERATED COLUMN.
   - Phân tích lý do thua và thông tin đối thủ cạnh tranh.

4. **Theo dõi KCN**:
   - `MorningPrioritySection.tsx` hiển thị danh sách KCN sắp xếp theo số ngày chưa được ghé thăm (dựa trên `morning_priorities` với `goal_type = 'tham_quan'`).
   - Click vào KCN mở panel hồ sơ chi tiết để cập nhật tình trạng, khó khăn, cơ hội.

### 3.5 Luồng Kiểm soát Truy cập

1. **Đăng nhập**: Form nhập `username` + `password` -> truy vấn bảng `app_users` -> nếu khớp, lưu object user vào localStorage với key `letsgo_user`.
2. **Phân quyền theo Vai trò**:
   - `admin`: Toàn quyền tất cả module.
   - `ketoan` (Kế toán): Truy cập module Tài chính, xem Dashboard.
   - `kinhdoanh` (Kinh doanh): Truy cập Khách hàng, CRM, Workspace, Thị trường.
   - `bdh` (Ban điều hành): Xem báo cáo tổng hợp, không chỉnh sửa.
3. **Ghi nhật ký**: Mọi thao tác CRUD gọi `logActivity()` -> ghi vào `audit_logs` với snapshot JSONB của dữ liệu trước/sau.
4. **Hoàn tác (Undo)**: Hàm `undoActivity()` đọc `old_data` / `new_data` từ `audit_logs` và đảo ngược thao tác tương ứng (re-insert / restore / delete).

### 3.6 Tính toán Điểm Sức khỏe Hợp đồng

Hàm `calcHealthScore()` trong `src/utils/healthScore.ts` trả về điểm từ 0-100 dựa trên 6 tiêu chí:

| Tiêu chí | Điểm tối đa |
|---|---|
| Số lao động >= mức tối thiểu cam kết | 25 |
| Đã thanh toán tháng này | 20 |
| Đã chốt công (prog_cutoff) | 10 |
| Ngày hết hạn hợp đồng > 30 ngày | 20 |
| Không có xu hướng giảm lao động | 15 |
| Đã liên hệ gần đây | 10 |

### 3.7 Luồng Nhập/Xuất Dữ liệu

- **Xuất khách hàng**: `clientImport.ts` sử dụng ExcelJS để tạo file `.xlsx` với dữ liệu khách hàng đã lọc. Hỗ trợ xuất theo chi nhánh, quản lý, nhóm đã chọn.
- **Nhập khách hàng**: Đọc file `.xlsx` bằng thư viện XLSX, parse từng dòng, validate bắt buộc (tên công ty), sau đó upsert vào Supabase.
- **Tải tài liệu**: File hợp đồng được tải lên Supabase Storage bucket `documents`, đường dẫn được lưu vào `client_documents`.

---

## 4. Xác thực và Phân quyền

### 4.1 Cơ chế Xác thực

Hệ thống không sử dụng Supabase Auth. Xác thực được xây dựng tùy chỉnh:

- Người dùng nhập `username` và `password`.
- Client truy vấn trực tiếp bảng `app_users` để kiểm tra khớp.
- Nếu xác thực thành công, object `AppUser` được lưu vào `localStorage['letsgo_user']`.
- `AuthContext` trong `src/lib/auth.tsx` cung cấp `user`, `login()`, `logout()`, `rolePermissions`, `refreshRolePermissions()` cho toàn bộ ứng dụng thông qua React Context.

**Lưu ý bảo mật quan trọng**: Mật khẩu hiện được lưu dưới dạng plaintext trong bảng `app_users`. Trong môi trường production, bắt buộc phải chuyển sang hashing (bcrypt hoặc tương đương).

### 4.2 Ma trận Phân quyền

| Module | admin | ketoan | kinhdoanh | bdh |
|---|---|---|---|---|
| Dashboard | full | view | view | view |
| Khách hàng | full | view | full | view |
| Chi nhánh | full | none | view | view |
| Tài chính | full | full | none | view |
| Thị trường | full | none | full | view |
| CRM | full | none | full | view |
| Workspace | full | none | full | view |
| Báo cáo | full | view | view | full |
| Lịch sử | full | view | none | view |
| Admin | full | none | none | none |

Các quyền này được lưu trong bảng `role_permissions` và có thể ghi đè ở cấp người dùng qua bảng `user_permissions`.

---

## 5. Kiến trúc Hooks và Luồng Dữ liệu

### 5.1 Hook Dữ liệu Chính

#### `useAppData` - Dữ liệu lõi ứng dụng

Được gọi từ `App.tsx` và truyền props xuống các trang con. Tải:
- `clients[]`: Tất cả khách hàng active (không archived, không suspended).
- `laborHistory`: Map `{clientId -> LaborHistoryEntry[]}` theo tuần.
- `managerHistory`: Map `{clientId -> ClientManagerHistory[]}`.
- Dữ liệu thị trường: `marketZones`, `marketSurveys`, `competitors`, `marketLeads`.

#### `useCRMData` - Module CRM

- Tải toàn bộ dữ liệu CRM: leads, pipeline, deals, activities, products.
- Pipeline tải kết hợp: `crm_pipeline` JOIN `contacts` và `crm_products`.
- Deals tải kết hợp: `crm_deals` JOIN `crm_leads`, `crm_products`, `contacts`.

#### `useFinanceData` - Module Tài chính

- Tải theo tháng: `projects_pnl` JOIN `clients`, `projects_pnl_costs`, `pnl_split_settings`, `branch_overhead`.
- Hỗ trợ CRUD đầy đủ cho tất cả thực thể tài chính.

#### `useContacts` - Liên hệ Khách hàng

- Tải contacts cho một `client_id` cụ thể.
- Sắp xếp: active trước, primary trước, sau đó theo thứ tự tạo.
- Hỗ trợ: `addContact`, `updateContact`, `markInactive`, `setPrimary`.

### 5.2 Pattern Truy vấn Phổ biến

Toàn bộ truy vấn sử dụng Supabase JS Client (không có REST endpoint tùy chỉnh):

```typescript
// Tải danh sách khách hàng active
supabase.from('clients')
  .select('*')
  .eq('client_type', 'active')
  .is('archived_at', null)
  .order('name')

// Tải pipeline với JOIN
supabase.from('crm_pipeline')
  .select('*, contacts(name, phone), crm_products(name, category, price)')
  .order('created_at', { ascending: false })

// Tải lịch sử lao động theo danh sách client
supabase.from('client_labor_history')
  .select('*')
  .in('client_id', clientIds)
  .order('created_at')

// Cập nhật inline trong bảng
supabase.from('clients')
  .update({ manager: newValue, updated_at: new Date().toISOString() })
  .eq('id', clientId)
```

### 5.3 Pattern Chỉnh sửa Inline trong Bảng

Bảng `Clients.tsx` sử dụng state `editingCell` để quản lý chỉnh sửa trực tiếp trên từng ô:

```typescript
editingCell: {
  id: string;          // ID bản ghi đang chỉnh sửa
  field: 'region' | 'manager' | 'zone' | 'contract_start' |
         'contract_end' | 'cutoff_day' | 'status' | 'labor' | 'payroll_staff'
} | null
```

- Double-click vào ô -> `startEdit()` -> hiển thị input/select tại chỗ.
- `onBlur` hoặc Enter -> `saveEdit()` -> gọi Supabase update -> gọi `logActivity()`.
- Escape -> `cancelEdit()`.

---

## 6. Cấu hình Môi trường

### 6.1 Biến Môi trường

File `.env` tại thư mục gốc:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### 6.2 Supabase Storage

Bucket `documents` dùng để lưu tài liệu đính kèm khách hàng (hợp đồng, phụ lục, tài liệu khác). Đường dẫn file được lưu vào bảng `client_documents.file_path`.

### 6.3 Lệnh Vận hành

| Lệnh | Mục đích |
|---|---|
| `npm run dev` | Khởi động môi trường phát triển (Vite HMR, cổng 5173) |
| `npm run build` | Build production vào thư mục `dist/` |
| `npm run lint` | Kiểm tra lỗi ESLint |
| `npx tsc -p tsconfig.app.json --noEmit` | Kiểm tra lỗi TypeScript |

### 6.4 Migrations

Các file migration SQL được đặt trong `supabase/migrations/` với quy tắc đặt tên `YYYYMMDDHHMMSS_NNN_<description>.sql`. Cần chạy thủ công trong Supabase SQL Editor khi triển khai schema mới. Hiện tại có 55 migrations từ 001 (setup ban đầu) đến 055 (payroll_staffs).

---

*Tài liệu này mô tả trạng thái hệ thống tại thời điểm 2026-06-18. Mọi thay đổi schema sau ngày này cần được cập nhật tương ứng vào tài liệu.*

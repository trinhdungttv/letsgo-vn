import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

export const IMPORT_HEADERS = [
  'Tên công ty *',
  'Khu vực',
  'Người quản lý',
  'Số điện thoại',
  'Email',
  'Ngày bắt đầu hợp đồng (YYYY-MM-DD)',
  'Ngày kết thúc hợp đồng (YYYY-MM-DD)',
  'Số lao động hiện tại',
  'Số lao động tối thiểu',
  'Khu công nghiệp (phân tách bằng dấu phẩy)',
  'Ghi chú',
] as const;

export interface ClientImportRow {
  name: string;
  region: string | null;
  manager: string | null;
  phone: string | null;
  email: string | null;
  contract_start: string | null;
  contract_end: string | null;
  current_workers: number | null;
  min_workers: number;
  industrial_zones: string[];
  notes: string | null;
}

export interface TemplateOptions {
  regionNames: string[];
  managerNames: string[];
  zoneNames: string[];
}

const TEMPLATE_ROWS = 200;

export async function downloadClientTemplate(options: TemplateOptions = { regionNames: [], managerNames: [], zoneNames: [] }): Promise<void> {
  const { regionNames, managerNames, zoneNames } = options;
  const exampleRow = [
    'Công ty TNHH ABC',
    'Bình Dương',
    'Nguyễn Văn A',
    '0901234567',
    'contact@abc.com',
    '2024-01-01',
    '2026-12-31',
    '50',
    '20',
    'VSIP 1, VSIP 2',
    'Khách hàng cũ chuyển từ Excel',
  ];

  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet('Khach hang');
  ws.addRow([...IMPORT_HEADERS]);
  ws.addRow(exampleRow);
  ws.columns = IMPORT_HEADERS.map(() => ({ width: 30 }));
  ws.getRow(1).font = { bold: true };

  // Hidden sheet holding the option lists used to power the dropdowns below.
  const wsLists = wb.addWorksheet('Lists');
  wsLists.state = 'hidden';
  wsLists.getColumn(1).values = ['Khu vực', ...regionNames];
  wsLists.getColumn(2).values = ['Người quản lý', ...managerNames];
  wsLists.getColumn(3).values = ['Khu công nghiệp', ...zoneNames];

  const addDropdown = (col: string, listColLetter: string, count: number) => {
    if (count === 0) return;
    const formula = `Lists!$${listColLetter}$2:$${listColLetter}$${count + 1}`;
    for (let row = 2; row <= TEMPLATE_ROWS; row++) {
      ws.getCell(`${col}${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: 'warning',
        error: 'Giá trị không có trong danh sách gợi ý, bạn vẫn có thể nhập nếu cần.',
      };
    }
  };

  addDropdown('B', 'A', regionNames.length); // Khu vực
  addDropdown('C', 'B', managerNames.length); // Người quản lý
  addDropdown('J', 'C', zoneNames.length); // Khu công nghiệp

  const wsInstructions = wb.addWorksheet('Huong dan');
  wsInstructions.getColumn(1).width = 90;
  [
    ['HƯỚNG DẪN NHẬP DỮ LIỆU'],
    [''],
    ['1. Không thay đổi tên các cột ở sheet "Khach hang".'],
    ['2. "Tên công ty" là bắt buộc, không được để trống.'],
    ['3. Ngày nhập theo định dạng YYYY-MM-DD, ví dụ 2024-01-01.'],
    ['4. Các cột "Khu vực", "Người quản lý", "Khu công nghiệp" có sẵn danh sách thả xuống (click vào ô để chọn) lấy theo dữ liệu hiện có trên hệ thống — chọn cho đúng để tránh phải sửa lại sau.'],
    ['5. "Khu công nghiệp" nếu có nhiều khu, phân tách bằng dấu phẩy (có thể chọn 1 khu từ danh sách rồi gõ thêm các khu khác).'],
    ['6. Các công ty nhập từ file này được hiểu là đã ký hợp đồng và đang hợp tác — sẽ được đánh dấu "Công ty cũ" trong báo cáo CRM.'],
    ['7. Nếu tên công ty đã tồn tại trong hệ thống, dòng đó sẽ bị bỏ qua khi import.'],
  ].forEach(r => wsInstructions.addRow(r));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mau_import_khach_hang.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function cell(row: Record<string, unknown>, key: string): string {
  const val = row[key];
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

export function parseClientExcel(file: File): Promise<ClientImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });

        const parsed: ClientImportRow[] = rows
          .map(row => {
            const name = cell(row, 'Tên công ty *') || cell(row, 'Tên công ty');
            const zonesRaw = cell(row, 'Khu công nghiệp (phân tách bằng dấu phẩy)') || cell(row, 'Khu công nghiệp');
            const currentWorkersRaw = cell(row, 'Số lao động hiện tại');
            const minWorkersRaw = cell(row, 'Số lao động tối thiểu');
            return {
              name,
              region: cell(row, 'Khu vực') || null,
              manager: cell(row, 'Người quản lý') || null,
              phone: cell(row, 'Số điện thoại') || null,
              email: cell(row, 'Email') || null,
              contract_start: cell(row, 'Ngày bắt đầu hợp đồng (YYYY-MM-DD)') || cell(row, 'Ngày bắt đầu hợp đồng') || null,
              contract_end: cell(row, 'Ngày kết thúc hợp đồng (YYYY-MM-DD)') || cell(row, 'Ngày kết thúc hợp đồng') || null,
              current_workers: currentWorkersRaw ? Number(currentWorkersRaw) || null : null,
              min_workers: minWorkersRaw ? Number(minWorkersRaw) || 0 : 0,
              industrial_zones: zonesRaw ? zonesRaw.split(/[,;]/).map(z => z.trim()).filter(Boolean) : [],
              notes: cell(row, 'Ghi chú') || null,
            };
          })
          .filter(r => r.name);

        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsBinaryString(file);
  });
}

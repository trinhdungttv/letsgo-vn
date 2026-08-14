import type { Client, FinanceRecord, CRMPipelineEntry } from './types';
import { formatCurrency, daysUntil } from './format';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const MODEL = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || 'gemini-2.5-flash';

export function geminiConfigured(): boolean {
  // Dev: can VITE_GEMINI_API_KEY de goi thang. Prod: gia su Vercel function da co GEMINI_API_KEY.
  return import.meta.env.DEV ? !!import.meta.env.VITE_GEMINI_API_KEY : true;
}

// Goi Gemini generateContent.
//  - Prod: POST qua /api/gemini (key nam o server, KHONG lo ra client bundle).
//  - Dev:  goi thang Google bang VITE_GEMINI_API_KEY. Reference key nam trong nhanh import.meta.env.DEV
//          nen bi loai bo khoi prod build (key khong xuat hien trong bundle).
async function generateContent(body: unknown): Promise<Response> {
  if (import.meta.env.DEV) {
    const devKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!devKey) throw new Error('Chưa cấu hình VITE_GEMINI_API_KEY (môi trường dev)');
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${devKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, body }),
  });
}

// Builds a compact text summary of company data to ground Gemini's answers.
// Bao gồm cả phần tổng hợp KPI (khớp với các thẻ số liệu trên Dashboard) để AI
// có thể trả lời các câu hỏi tổng quan mà không cần tự suy luận/tính toán lại.
export function buildWorkspaceContext(clients: Client[], finance: FinanceRecord[], pipeline: CRMPipelineEntry[]): string {
  const month = new Date().toISOString().slice(0, 7);
  const monthFinance = finance.filter(f => f.month === month);

  const activeClients = clients.filter(c => c.client_type === 'active');
  const totalRevenue = monthFinance.reduce((s, f) => s + (f.revenue || 0), 0);
  const totalWorkers = activeClients.reduce((s, c) => s + (c.current_workers || 0), 0);
  const unpaidClients = activeClients.filter(c => !c.paid_this_month);
  const alertClients = activeClients.filter(c => c.status === 'warn' || c.status === 'danger');
  const expiringSoon = activeClients.filter(c => {
    const d = daysUntil(c.contract_end);
    return d !== null && d >= 0 && d <= 30;
  });

  const clientLines = activeClients
    .map(c => {
      const fin = monthFinance.find(f => f.client_id === c.id);
      return [
        `- ${c.name}`,
        `quản lý: ${c.manager || '—'}`,
        `trạng thái: ${c.status}`,
        `lao động hiện tại: ${c.current_workers ?? 0}`,
        `HĐ hết: ${c.contract_end || '—'}`,
        `đã TT tháng này: ${c.paid_this_month ? 'rồi' : 'chưa'}`,
        fin ? `doanh thu tháng: ${formatCurrency(fin.revenue)}` : 'chưa có dữ liệu tài chính tháng này',
      ].join(', ');
    })
    .join('\n');

  const pipelineLines = pipeline
    .map(p => `- ${p.company_name}: giai đoạn ${p.stage}, khu vực ${p.region || '—'}, liên hệ gần nhất ${p.last_contact || 'chưa'}`)
    .join('\n');

  return [
    `Hôm nay là tháng ${month}.`,
    '',
    '## Tổng quan (KPI Dashboard):',
    `- Khách hàng đang hoạt động: ${activeClients.length}`,
    `- Tổng doanh thu tháng ${month}: ${formatCurrency(totalRevenue)} (tính từ tổng "doanh thu tháng" của các khách hàng dưới đây)`,
    `- Tổng số lao động hiện tại (tất cả khách hàng): ${totalWorkers}`,
    `- Khách hàng chưa thanh toán tháng này: ${unpaidClients.length}${unpaidClients.length ? ' (' + unpaidClients.map(c => c.name).join(', ') + ')' : ''}`,
    `- Khách hàng đang cảnh báo (trạng thái warn/danger): ${alertClients.length}${alertClients.length ? ' (' + alertClients.map(c => c.name).join(', ') + ')' : ''}`,
    `- Hợp đồng sắp hết hạn trong 30 ngày: ${expiringSoon.length}${expiringSoon.length ? ' (' + expiringSoon.map(c => `${c.name}: ${c.contract_end}`).join(', ') + ')' : ''}`,
    '',
    '## Danh sách khách hàng đang hoạt động:',
    clientLines || '(không có)',
    '',
    '## Pipeline kinh doanh (BD Pipeline):',
    pipelineLines || '(không có)',
  ].join('\n');
}

// Khi Gemini trả về lỗi 429 (vượt hạn mức free tier), trả về thông báo lịch sự bằng tiếng Việt
// thay vì hiển thị nguyên JSON lỗi. Cố gắng đọc thời gian chờ gợi ý (retryDelay) nếu có.
function rateLimitMessage(errBody: string): string {
  let waitSeconds = 60;
  try {
    const parsed = JSON.parse(errBody);
    const details = parsed?.error?.details as Array<Record<string, unknown>> | undefined;
    const retryInfo = details?.find(d => typeof d['retryDelay'] === 'string');
    const retryDelay = retryInfo?.['retryDelay'] as string | undefined;
    if (retryDelay) {
      const seconds = parseInt(retryDelay, 10);
      if (!Number.isNaN(seconds) && seconds > 0) waitSeconds = seconds;
    }
  } catch {
    // Không parse được JSON, dùng giá trị mặc định
  }
  return `Trợ lý AI đang dùng phiên bản miễn phí của Google Gemini nên có giới hạn số câu hỏi trong một khoảng thời gian ngắn. Bạn vừa gửi câu hỏi hơi nhanh, vui lòng chờ khoảng ${waitSeconds} giây rồi gửi lại câu hỏi nhé.`;
}

// Khi Gemini báo quá tải (503) hoặc lỗi tạm thời từ máy chủ Google.
function overloadedMessage(): string {
  return 'Hệ thống AI của Google đang tạm thời quá tải (phiên bản miễn phí). Vui lòng chờ khoảng 30 giây rồi gửi lại câu hỏi nhé.';
}

// Chuyển lỗi HTTP từ Gemini thành thông báo lịch sự bằng tiếng Việt, thay vì hiển thị JSON thô.
function friendlyErrorMessage(status: number, errBody: string): string {
  if (status === 429) return rateLimitMessage(errBody);
  if (status === 503) return overloadedMessage();
  return `Gemini API lỗi (${status}): ${errBody.slice(0, 200)}`;
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được file (${res.status})`);
  const blob = await res.blob();
  const mimeType = blob.type || 'application/pdf';
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mimeType };
}

// Asks Gemini a question about a single PDF/document (sent inline, suitable for typical contract-sized files).
export async function askGeminiAboutDocument(fileUrl: string, question: string): Promise<string> {
  const { data, mimeType } = await fetchAsBase64(fileUrl);

  const res = await generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data } },
        { text: question },
      ],
    }],
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(friendlyErrorMessage(res.status, errBody));
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini không trả về nội dung');
  return text;
}

export async function askGemini(context: string, history: ChatMessage[]): Promise<string> {
  const systemInstruction = {
    parts: [{
      text: [
        'Bạn là trợ lý AI của Letsgo VN, hỗ trợ tra cứu và phân tích dữ liệu khách hàng, tài chính, hợp đồng của công ty.',
        'Trả lời ngắn gọn, rõ ràng, bằng tiếng Việt. Chỉ dùng dữ liệu được cung cấp dưới đây, không bịa thông tin.',
        'Phần "Tổng quan (KPI Dashboard)" đã được tính sẵn (tổng doanh thu, tổng lao động, số khách cảnh báo...) — hãy dùng trực tiếp các số liệu này khi được hỏi, đừng nói là chưa có dữ liệu nếu nó đã xuất hiện trong phần đó.',
        'Nếu được hỏi về tổng hợp/so sánh giữa các khách hàng (ví dụ: ai có doanh thu cao nhất, lao động nhiều nhất), hãy tự tính toán dựa trên danh sách khách hàng được cung cấp.',
        'Chỉ trả lời "chưa có dữ liệu" khi thông tin được hỏi thực sự không xuất hiện ở đâu trong dữ liệu công ty dưới đây (ví dụ: lịch sử biến động lao động theo thời gian hiện chưa được cung cấp).',
        'Nếu người dùng hỏi lại "sao lại lỗi" hoặc phản hồi không rõ ràng, hãy hỏi lại để hiểu họ đang muốn hỏi về vấn đề/dữ liệu gì.',
        '',
        'DỮ LIỆU CÔNG TY:',
        context,
      ].join('\n'),
    }],
  };

  const contents = history.map(m => ({ role: m.role, parts: [{ text: m.text }] }));

  const res = await generateContent({ systemInstruction, contents });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(friendlyErrorMessage(res.status, errBody));
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini không trả về nội dung');
  return text;
}

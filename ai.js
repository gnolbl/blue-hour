// ai.js - module backend cho trợ lý học tập (Node 18+, không cần cài thêm package)
//
// Chọn "bộ não" AI theo biến môi trường trong file .env:
//   GEMINI_API_KEY      -> dùng Google Gemini (key lấy ở Google AI Studio), tự tra cứu bằng Google Search
//   GEMINI_MODEL        -> (tuỳ chọn) tên model Gemini, mặc định bên dưới
//   ANTHROPIC_API_KEY   -> dùng Claude (key lấy ở console.anthropic.com), tự tra cứu bằng công cụ web search
// Có cả hai key thì ưu tiên Gemini.
 
const GEMINI_KEY = process.env.GEMINI_API_KEY;
// Làm sạch tên model: bỏ khoảng trắng, ngoặc kép, tiền tố "models/" nếu lỡ dán thừa
const GEMINI_MODEL = (process.env.GEMINI_MODEL || '')
  .trim().replace(/^["']|["']$/g, '').replace(/^models\//, '').trim() || 'gemini-2.5-flash';
// Model dự phòng khi model chính quá tải / hết hạn mức
const FALLBACK_MODELS = ['gemini-3.5-flash-lite'];
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-5-5';
 
const MODE_PROMPTS = {
  'goc-bai-tap': 'CHỨC NĂNG GỢI Ý BÀI TẬP: đề xuất 3-5 bài tập phù hợp mục tiêu học hôm nay, từ dễ đến khó. Mỗi bài có đề, gợi ý hướng làm và đáp số nếu có. Ưu tiên bài tìm được từ internet.',
  'goc-dang-bai': 'CHỨC NĂNG GỢI Ý DẠNG BÀI: liệt kê các dạng bài trọng tâm của nội dung đang học. Mỗi dạng gồm: cách nhận biết, phương pháp giải ngắn gọn, một ví dụ mini.',
  'tim-kiem': 'CHỨC NĂNG TÌM KIẾM BÀI TẬP: tra cứu internet, liệt kê bài tập/tài liệu tìm được và tóm tắt từng mục.',
  chat: 'Trả lời trực tiếp câu hỏi học tập, giải thích dễ hiểu, giải từng bước nếu là bài tập.',
};
 
// ---------- Lớp và môn học (tên môn phải trùng với tên tab môn trong study.html) ----------
const GRADES = ['10', '11', '12'];
 
const SUBJECT_HINTS = {
  'Toán': 'Trình bày lời giải từng bước, có công thức rõ ràng.',
  'Vật lý': 'Nêu công thức, đơn vị, giải từng bước.',
  'Hóa học': 'Viết phương trình phản ứng, cân bằng, nêu điều kiện phản ứng.',
  'Tiếng Anh': 'Giải thích ngữ pháp/từ vựng bằng tiếng Việt, ví dụ bằng tiếng Anh.',
  'Ngữ văn': 'Môn này không có đáp số: gợi ý dàn ý, luận điểm, cách phân tích, cách viết đoạn/bài nghị luận xã hội và nghị luận văn học.',
  'Lịch sử': 'Nêu mốc thời gian, sự kiện, nguyên nhân – diễn biến – kết quả – ý nghĩa.',
  'Địa lí': 'Gắn với Atlat Địa lí Việt Nam, số liệu, biểu đồ; hướng dẫn nhận dạng biểu đồ khi có.',
  'Sinh học': 'Giải thích cơ chế, thuật ngữ; bài tập di truyền thì giải từng bước.',
  'Tin học': 'Có thể đưa ví dụ code ngắn; giải thích rõ khái niệm và thuật toán.',
  'Giáo dục kinh tế và pháp luật': 'Dùng tình huống thực tế, nêu căn cứ khái niệm/quy định pháp luật hiện hành.',
  'Giáo dục quốc phòng và an ninh': 'Bám nội dung sách giáo khoa GDQP-AN, trình bày ngắn gọn, đúng trọng tâm.',
  'Công nghệ': 'Giải thích nguyên lí, quy trình kĩ thuật; gắn ví dụ thực tế.',
};
const SUBJECTS = Object.keys(SUBJECT_HINTS);
 
// ---------- Gọi Gemini ----------
async function askGemini({ system, messages, search = false, json = false, maxTokens = 4096, model = GEMINI_MODEL }) {
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  if (search) body.tools = [{ google_search: {} }];
 
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Lỗi API Gemini');
 
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
  const seen = new Set();
  const sources = (cand?.groundingMetadata?.groundingChunks || [])
    .filter(c => c.web && c.web.uri && !seen.has(c.web.uri) && seen.add(c.web.uri))
    .map(c => ({ title: c.web.title || c.web.uri, url: c.web.uri }));
  return { text, sources };
}
 
// ---------- Gọi Claude ----------
async function askClaude({ system, messages, search = false, maxTokens = 2000 }) {
  const body = { model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages };
  if (search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Lỗi API Claude');
  const text = j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { text, sources: [] };
}
 
// ---------- Tự thử lại + chuyển model dự phòng khi quá tải ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isBusy = e => /high demand|overloaded|unavailable|503|429|quota|no longer available|not found|404/i.test(String(e.message || ''));
async function ask(opts) {
  if (GEMINI_KEY) {
    const models = [GEMINI_MODEL, ...FALLBACK_MODELS.filter(m => m !== GEMINI_MODEL)];
    let lastErr;
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await askGemini({ ...opts, model });
        } catch (e) {
          lastErr = e;
          if (!isBusy(e)) throw e;
          console.warn(`[Gemini] ${model} lỗi (lần ${attempt + 1}): ${e.message}`);
          if (/quota/i.test(e.message)) break;      // hết quota thì bỏ model này, sang model kế
          await sleep(1500 * (attempt + 1));
        }
      }
    }
    throw lastErr;
  }
  if (CLAUDE_KEY) return askClaude(opts);
  throw new Error('Chưa đặt GEMINI_API_KEY (hoặc ANTHROPIC_API_KEY) trong file .env');
}
 
// ---------- Bước 1: lọc câu hỏi + trích từ khoá ----------
async function analyze(message, subject, note, grade) {
  try {
    const { text } = await ask({
      maxTokens: 600,
      json: true,
      system: 'Bạn là bộ lọc cho trợ lý học tập. Chỉ trả về JSON, không giải thích.',
      messages: [{
        role: 'user',
        content: `Các môn hỗ trợ (lớp 10, 11, 12): ${SUBJECTS.join(', ')}. Môn đang mở: "${subject}". Lớp: "${grade || 'chưa chọn'}". Mục tiêu học: "${note}".
Câu người dùng: "${message}"
Trả về JSON: {"on_topic": true/false, "needs_search": true/false}
- on_topic=true nếu liên quan kiến thức, bài tập, ôn tập, phương pháp học, kế hoạch học của một môn học.
- on_topic=false nếu trò chuyện phiếm, giải trí, tin tức, chính trị, tư vấn đời sống...
- needs_search=true nếu cần tra thông tin/bài tập bên ngoài internet.`,
      }],
    });
    return JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
  } catch {
    // Bước lọc lỗi thì cho qua, để bước trả lời quyết định
    return { on_topic: true, needs_search: true };
  }
}
 
// body: { message, mode, subject, note, time, history }
async function handleChat(body) {
  if (!GEMINI_KEY && !CLAUDE_KEY) throw new Error('Chưa đặt GEMINI_API_KEY (hoặc ANTHROPIC_API_KEY) trong file .env');
  const { message, mode = 'chat', note = '', time = '', history = [] } = body;
  // Chỉ nhận lớp/môn hợp lệ (không cho chữ lạ lọt vào prompt)
  const grade = GRADES.includes(String(body.grade)) ? String(body.grade) : '';
  const subject = SUBJECTS.find(s => s.toLowerCase() === String(body.subject || '').trim().toLowerCase()) || 'Chung';
  if (!message || !message.trim()) return { reply: 'Bạn hãy nhập câu hỏi nhé.' };
 
  // 3 nút chức năng chắc chắn là học tập => bỏ bước lọc, tiết kiệm 1 lần gọi API
  const plan = mode === 'chat'
    ? await analyze(message, subject, note, grade)
    : { on_topic: true, needs_search: true };
 
  if (!plan.on_topic) {
    return { reply: '⚠️ Mình chỉ hỗ trợ các câu hỏi liên quan đến môn học (kiến thức, bài tập, ôn tập, kế hoạch học). Bạn hãy hỏi một nội dung học tập nhé!', sources: [] };
  }
 
  const needSearch = process.env.USE_SEARCH !== 'false' &&
  (mode === 'tim-kiem' || mode === 'goc-bai-tap' || !!plan.needs_search);
 
  const system = `Bạn là Blue Hour, trợ lý học tập trong ứng dụng, trả lời bằng tiếng Việt, chính xác, dễ hiểu, ngắn gọn.
Môn đang mở: ${subject}. Lớp: ${grade ? 'lớp ' + grade + ' (chương trình GDPT 2018)' : 'chưa chọn'}. Mục tiêu học hôm nay: ${note || 'chưa ghi'}. Khung giờ: ${time || 'chưa xếp'}.
Lưu ý riêng cho môn này: ${SUBJECT_HINTS[subject] || 'Trả lời đúng trọng tâm môn học.'}
${MODE_PROMPTS[mode] || MODE_PROMPTS.chat}
Quy tắc:
${grade ? `- Học sinh đã chọn LỚP ${grade}. Nếu câu hỏi không nói rõ lớp, mặc định hiểu là lớp ${grade}: bài tập, kiến thức, mức độ đều theo chương trình lớp ${grade}. Chỉ đổi sang lớp khác khi học sinh nêu rõ lớp đó trong câu hỏi.
- Khi tra cứu internet, thêm "lớp ${grade}" vào từ khoá tìm kiếm.` : '- Chưa biết lớp của học sinh: bám chương trình lớp 10-12, nếu cần thì hỏi lại học sinh đang học lớp mấy.'}
- Chỉ trả lời nội dung liên quan đến môn học. Nếu lạc đề, từ chối lịch sự.
- Khi cần dữ liệu bên ngoài, hãy tra cứu internet và dựa vào kết quả tìm được. Không bịa nguồn, không bịa đường link.
- Không chắc thì nói rõ. Dùng **in đậm** cho ý chính, không dùng bảng markdown.`;
 
  const msgs = history.slice(-6).filter(m => m && m.role && m.content);
  msgs.push({ role: 'user', content: message });
 
  const { text, sources } = await ask({ system, messages: msgs, search: needSearch, maxTokens: 4096 });
  return { reply: text || 'Mình chưa tạo được câu trả lời, bạn thử hỏi lại nhé.', sources };
}
 
module.exports = { handleChat };
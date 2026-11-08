// study-ai.js - đặt SAU thẻ <script> chính trong study.html.
// Các function bên dưới ghi đè hàm cùng tên trong study.html (sendMessage, appendMessage, handleAction...).
(function () {
  const history = [];
  let activeMode = 'chat';
  let busy = false;
  let msgCounter = 0;
 
  const DEFAULT_PROMPTS = {
    'goc-bai-tap': 'Gợi ý cho tôi một số bài tập luyện tập phù hợp với mục tiêu học hôm nay.',
    'goc-dang-bai': 'Phân tích và gợi ý các dạng bài chính của nội dung đang học.',
    'tim-kiem': 'Tìm kiếm bài tập và tài liệu liên quan đến nội dung đang học.',
  };
 
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 
  // Hiển thị văn bản AI: giữ nguyên công thức LaTeX, chỉ định dạng phần chữ xung quanh
  const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g;
  const render = s => {
    const maths = [];
    // 1. Cất công thức đi để các bước định dạng bên dưới không làm hỏng chúng
    let t = String(s).replace(MATH_RE, m => {
      maths.push(m);
      return '\uE000' + (maths.length - 1) + '\uE001';
    });
    // 2. Định dạng phần chữ thường
    t = esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^\s*[\*\-] /gm, '• ')
      .replace(/^---$/gm, '<hr class="my-2">')
      .replace(/\n/g, '<br>');
    // 3. Trả công thức về chỗ cũ (đã escape an toàn)
    return t.replace(/\uE000(\d+)\uE001/g, (_, i) => esc(maths[i]));
  };
 
  // Vẽ công thức bằng KaTeX; nếu thư viện chưa tải xong thì thử lại tối đa ~5 giây
  function typeset(el, tries = 0) {
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$', right: '$', display: false },
          ],
          throwOnError: false,
        });
      } catch (e) { console.warn('KaTeX lỗi:', e); }
    } else if (tries < 20) {
      setTimeout(() => typeset(el, tries + 1), 250);
    } else {
      console.warn('Không tải được KaTeX (kiểm tra mạng hoặc 3 dòng KaTeX trong <head> của study.html)');
    }
  }
 
  // ----- Ghi đè: hiển thị tin nhắn (an toàn, hỗ trợ **đậm**, công thức và danh sách nguồn) -----
  window.appendMessage = function (text, sender, isLoading = false, sources = []) {
    const box = document.getElementById('chatContainer');
    const id = 'msg_' + Date.now() + '_' + (msgCounter++);
    const div = document.createElement('div');
    div.id = id;
    div.className = 'flex items-start space-x-3 ' + (sender === 'user' ? 'justify-end' : '');
    let srcHtml = '';
    if (sources && sources.length) {
      srcHtml = '<div class="mt-3 pt-2 border-t border-slate-200 text-xs space-y-1"><div class="font-semibold text-slate-500">Nguồn tham khảo:</div>' +
        sources.map((s, i) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="block text-blue-600 hover:underline truncate">[${i + 1}] ${esc(s.title)}</a>`).join('') + '</div>';
    }
    if (sender === 'user') {
      div.innerHTML = `<div class="bg-blue-600 text-white p-4 rounded-2xl shadow-sm text-sm max-w-2xl">${render(text)}</div>
        <div class="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center shrink-0 font-bold text-xs shadow">Bạn</div>`;
    } else {
      div.innerHTML = `<div class="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 font-bold text-xs shadow" title="Blue Hour">BH</div>
        <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 text-sm text-slate-700 max-w-2xl ${isLoading ? 'italic text-slate-400 animate-pulse' : ''}">${render(text)}${srcHtml}</div>`;
    }
    box.appendChild(div);
    if (sender !== 'user' && !isLoading) typeset(div);   // vẽ công thức toán
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    // công thức vẽ xong làm tin nhắn cao hơn, cuộn lại một lần nữa
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 400);
    return id;
  };
 
  // ----- Ghi đè: 3 nút chức năng trên thanh chat -----
  window.handleAction = function (type) {
    activeMode = type;
    document.querySelectorAll('button[onclick^="handleAction"]').forEach(b => {
      b.classList.toggle('ring-2', b.getAttribute('onclick').includes(`'${type}'`));
      b.classList.toggle('ring-blue-500', b.getAttribute('onclick').includes(`'${type}'`));
    });
    const input = document.getElementById('chatInput');
    if (!input.value.trim()) input.value = DEFAULT_PROMPTS[type] || '';
    window.sendMessage();   // bấm nút là chạy luôn; có chữ sẵn thì dùng chữ đó làm yêu cầu
  };
 
  // ----- Ghi đè: gửi tin nhắn tới backend -----
  window.sendMessage = async function () {
    if (busy) return;
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question) return;
 
    busy = true;
    const mode = activeMode;
    activeMode = 'chat';
    document.querySelectorAll('button[onclick^="handleAction"]').forEach(b => b.classList.remove('ring-2', 'ring-blue-500'));
 
    window.appendMessage(question, 'user');
    input.value = '';
    const loadingId = window.appendMessage(
      mode === 'tim-kiem' || mode === 'goc-bai-tap' ? 'Đang tìm kiếm trên internet...' : 'Đang phân tích câu hỏi...', 'ai', true);
 
    const sheet = getActiveSheetData();   // hàm có sẵn: lấy môn, ghi chú, thời gian của sheet đang mở
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);   // quá 90 giây thì báo lỗi, không treo mãi
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: ctrl.signal,
        body: JSON.stringify({ message: question, mode, subject: sheet.name, grade: sheet.grade, note: sheet.note, time: sheet.time, history }),
      });
      const data = await res.json();
      removeMessage(loadingId);
      if (res.status === 401) {
        window.appendMessage('🔒 Phiên đăng nhập đã hết hạn. Hãy quay lại trang đăng nhập rồi thử lại.', 'ai');
      } else if (!res.ok) {
        window.appendMessage(data.reply || data.error || 'Máy chủ gặp lỗi, hãy thử lại.', 'ai');
      } else {
        window.appendMessage(data.reply || 'Không nhận được phản hồi.', 'ai', false, data.sources);
        history.push({ role: 'user', content: question }, { role: 'assistant', content: data.reply || '' });
        if (history.length > 12) history.splice(0, history.length - 12);
      }
    } catch (e) {
      removeMessage(loadingId);
      window.appendMessage(e.name === 'AbortError'
        ? '⏳ AI phản hồi quá lâu. Bạn thử lại sau ít phút nhé!'
        : '⚠️ Không kết nối được máy chủ AI. Hãy kiểm tra server đã chạy chưa.', 'ai');
    } finally {
      clearTimeout(timer);
    }
    busy = false;
  };
 
  // Nhấn Enter để gửi
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('chatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
    });
  });
})();
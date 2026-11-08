try { process.loadEnvFile(); } catch {}
const { handleChat } = require('./ai');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
 
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'users.json');
 
// Khóa ký token: dùng biến môi trường, hoặc tự sinh và lưu lại lần đầu chạy
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(__dirname, 'data', '.jwt_secret');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const JWT_SECRET = loadSecret();
 
// ---------- Database ----------
// Lưu vào file JSON (không cần cài đặt/biên dịch gì thêm, chạy tốt trên Windows).
// Muốn dùng SQL thật sự thì có thể đổi sang SQLite/MySQL/PostgreSQL sau.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
 
let store = { nextId: 1, users: [] };
if (fs.existsSync(DB_PATH)) {
  try {
    store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('Không đọc được file dữ liệu, hãy kiểm tra lại:', DB_PATH);
    process.exit(1);
  }
}
 
// Ghi an toàn: ghi ra file tạm rồi đổi tên, tránh hỏng file nếu đang ghi mà bị tắt
function save() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DB_PATH);
}
 
const now = () => new Date().toISOString();
 
const stmts = {
  insertUser: {
    run(fullName, email, passwordHash) {
      const user = {
        id: store.nextId++,
        full_name: fullName,
        email,
        password_hash: passwordHash,
        created_at: now(),
        last_login_at: null,
      };
      store.users.push(user);
      save();
      return { lastInsertRowid: user.id };
    },
  },
  byEmail: {
    get: (email) => store.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()),
  },
  byId: {
    get: (id) => store.users.find((u) => u.id === id),
  },
  touchLogin: {
    run(id) {
      const u = store.users.find((x) => x.id === id);
      if (u) { u.last_login_at = now(); save(); }
    },
  },
};
 
// ---------- App ----------
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
 
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (u) => ({ id: u.id, fullName: u.full_name, email: u.email });
 
function setAuthCookie(res, user, remember) {
  const maxAge = remember ? 30 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: Math.floor(maxAge / 1000) });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: remember ? maxAge : undefined, // không remember => cookie phiên
  });
}
 
function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies.token || '', JWT_SECRET);
    const user = stmts.byId.get(payload.sub);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  }
}
 
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần thử. Vui lòng quay lại sau ít phút.' },
});
 
app.post('/api/register', authLimiter, (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
 
  if (fullName.length < 2 || fullName.length > 100)
    return res.status(400).json({ error: 'Họ và tên phải từ 2 đến 100 ký tự' });
  if (!EMAIL_RE.test(email) || email.length > 254)
    return res.status(400).json({ error: 'Email không hợp lệ' });
  if (password.length < 6 || password.length > 72)
    return res.status(400).json({ error: 'Mật khẩu phải từ 6 đến 72 ký tự' });
  if (stmts.byEmail.get(email))
    return res.status(409).json({ error: 'Email này đã được đăng ký' });
 
  const hash = bcrypt.hashSync(password, 12);
  const info = stmts.insertUser.run(fullName, email, hash);
  res.status(201).json({ message: 'Đăng ký thành công', user: { id: info.lastInsertRowid, fullName, email } });
});
 
app.post('/api/login', authLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const remember = !!req.body.remember;
 
  const user = stmts.byEmail.get(email);
  // Thông báo chung để không lộ email nào đã tồn tại
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
 
  stmts.touchLogin.run(user.id);
  setAuthCookie(res, user, remember);
  res.json({ message: 'Đăng nhập thành công', user: publicUser(user) });
});
 
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Đã đăng xuất' });
});
 
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Bạn hỏi quá nhanh, hãy đợi một chút rồi thử lại.' },
});
 
app.post('/api/chat', requireAuth, chatLimiter, async (req, res) => {
  try {
    res.json(await handleChat(req.body));
  } catch (e) {
    console.error(e);
    if (e.busy) return res.status(503).json({ reply: '⚠️ ' + e.message, sources: [] });
    res.status(500).json({ reply: 'Lỗi: ' + e.message });
  }
});
// Giao diện tĩnh
app.use(express.static(path.join(__dirname, 'public')));
 
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ' });
});
 
app.listen(PORT, () => console.log(`Blue Hour server chạy tại http://localhost:${PORT}`));
 
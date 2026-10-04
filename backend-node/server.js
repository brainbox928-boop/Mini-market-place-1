require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const env = process.env;
const PROD = env.NODE_ENV === 'production';
if (PROD && (!env.JWT_SECRET || env.JWT_SECRET.startsWith('change-me'))) {
  throw new Error('Set a strong JWT_SECRET in .env');
}
const JWT_SECRET = env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const SITE = {
  name: env.SITE_NAME || 'NovaLink',
  currency: env.CURRENCY || 'NGN',
  symbol: env.CURRENCY_SYMBOL || '₦',
  paystack: !!env.PAYSTACK_SECRET,
  manualInfo: env.MANUAL_PAYMENT_INFO || '',
};

// ---------- DB (all money stored as integer minor units, e.g. kobo/cents) ----------
const db = new Database(path.join(__dirname, 'market.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  role TEXT NOT NULL DEFAULT 'user', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, category TEXT NOT NULL CHECK(category IN('number','account','boost')),
  platform TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK(price >= 0), per INTEGER NOT NULL DEFAULT 1,
  min_qty INTEGER NOT NULL DEFAULT 1, max_qty INTEGER NOT NULL DEFAULT 1,
  provider_service TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS stock(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  data TEXT NOT NULL, order_id INTEGER);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
  category TEXT NOT NULL, qty INTEGER NOT NULL, total INTEGER NOT NULL, link TEXT,
  status TEXT NOT NULL DEFAULT 'pending', delivery TEXT, provider_order TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, amount INTEGER NOT NULL, ref TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

if (!db.prepare('SELECT 1 FROM users WHERE role=?').get('admin')) {
  const pw = env.ADMIN_PASSWORD || 'ChangeThisNow123';
  db.prepare('INSERT INTO users(email,name,pass_hash,role) VALUES(?,?,?,?)')
    .run((env.ADMIN_EMAIL || 'admin@example.com').toLowerCase(), 'Admin', bcrypt.hashSync(pw, 12), 'admin');
  console.log('Admin account created. Change the password after first login.');
}
if (!db.prepare('SELECT 1 FROM products LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO products(category,platform,name,description,price,per,min_qty,max_qty) VALUES(?,?,?,?,?,?,?,?)');
  ins.run('number', 'WhatsApp', 'WhatsApp Verification Number', 'One-time SMS verification number. Code delivered to your order.', 150000, 1, 1, 1);
  ins.run('account', 'Instagram', 'Aged Instagram Account', 'Pre-registered account with login details delivered instantly.', 200000, 1, 1, 20);
  ins.run('boost', 'Instagram', 'Instagram Followers (Real)', 'Real, active profiles. Gradual delivery. Price per 1000.', 450000, 1000, 100, 50000);
  ins.run('boost', 'TikTok', 'TikTok Followers (Bot / Fast)', 'Fast delivery, may drop. Price per 1000.', 150000, 1000, 100, 100000);
}

// ---------- helpers ----------
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
} } }));
app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(e); res.status(500).json({ error: 'Server error' });
});
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const publicUser = u => ({ id: u.id, email: u.email, name: u.name, balance: u.balance, role: u.role });
const money = (n) => Number.isInteger(n) && n > 0;

function auth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token || '', JWT_SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) throw 0;
    req.user = u; next();
  } catch { bad(res, 'Please log in', 401); }
}
const admin = (req, res, next) => (req.user.role === 'admin' ? next() : bad(res, 'Forbidden', 403));

// Block cross-site state changes (cookie is SameSite=Lax; this is defense in depth)
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.path !== '/paystack/webhook' && !req.is('application/json')) return bad(res, 'JSON required', 415);
  next();
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// ---------- auth ----------
const emailOk = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
function setToken(res, id) {
  res.cookie('token', jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' }), {
    httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 864e5 });
}
app.get('/api/config', (_req, res) => res.json(SITE));

app.post('/api/register', authLimiter, wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 80) return bad(res, 'Name required');
  if (!emailOk(email)) return bad(res, 'Valid email required');
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return bad(res, 'Password must be 8+ characters');
  const e = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(e)) return bad(res, 'Email already registered', 409);
  const r = db.prepare('INSERT INTO users(email,name,pass_hash) VALUES(?,?,?)').run(e, name.trim(), await bcrypt.hash(password, 12));
  setToken(res, r.lastInsertRowid);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid)));
}));

app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = typeof email === 'string' && typeof password === 'string'
    ? db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()) : null;
  if (!u || !(await bcrypt.compare(password, u.pass_hash))) return bad(res, 'Invalid email or password', 401);
  setToken(res, u.id);
  res.json(publicUser(u));
}));
app.post('/api/logout', (_req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));

// ---------- catalog ----------
app.get('/api/products', (_req, res) => {
  res.json(db.prepare(`SELECT p.id,p.category,p.platform,p.name,p.description,p.price,p.per,p.min_qty,p.max_qty,
    CASE WHEN p.category='account' THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id=p.id AND s.order_id IS NULL) END AS in_stock
    FROM products p WHERE p.active=1 ORDER BY p.category,p.platform,p.id`).all());
});

// ---------- orders ----------
const totalFor = (p, qty) => Math.ceil((p.price * qty) / p.per);

async function submitToProvider(order, product) {
  if (!env.SMM_API_URL || !env.SMM_API_KEY || !product.provider_service) return null;
  const body = new URLSearchParams({ key: env.SMM_API_KEY, action: 'add',
    service: product.provider_service, link: order.link, quantity: String(order.qty) });
  const r = await fetch(env.SMM_API_URL, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (!j.order) throw new Error(j.error || 'Provider rejected order');
  return String(j.order);
}

function refund(orderId, status, note) {
  db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!o || ['failed', 'refunded', 'cancelled'].includes(o.status)) return;
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(o.total, o.user_id);
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, orderId);
    db.prepare('INSERT INTO transactions(user_id,type,amount,ref,status,note) VALUES(?,?,?,?,?,?)')
      .run(o.user_id, 'refund', o.total, `refund-${orderId}-${Date.now()}`, 'success', note);
  })();
}

const placeOrder = db.transaction((user, p, qty, link) => {
  const total = totalFor(p, qty);
  const upd = db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?').run(total, user.id, total);
  if (!upd.changes) return { error: 'Insufficient balance. Please fund your wallet.' };
  let status = 'pending', delivery = null, rows = [];
  if (p.category === 'account') {
    rows = db.prepare('SELECT id,data FROM stock WHERE product_id=? AND order_id IS NULL LIMIT ?').all(p.id, qty);
    if (rows.length < qty) throw Object.assign(new Error('stock'), { stock: true });
    status = 'completed';
    delivery = rows.map(r => r.data).join('\n');
  }
  const o = db.prepare('INSERT INTO orders(user_id,product_id,product_name,category,qty,total,link,status,delivery) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(user.id, p.id, p.name, p.category, qty, total, link, status, delivery);
  for (const r of rows) db.prepare('UPDATE stock SET order_id=? WHERE id=?').run(o.lastInsertRowid, r.id);
  db.prepare('INSERT INTO transactions(user_id,type,amount,ref,status,note) VALUES(?,?,?,?,?,?)')
    .run(user.id, 'purchase', -total, `order-${o.lastInsertRowid}`, 'success', p.name);
  return { id: o.lastInsertRowid };
});

app.post('/api/orders', auth, wrap(async (req, res) => {
  const { productId, link } = req.body || {};
  const qty = Number(req.body && req.body.qty);
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(productId));
  if (!p) return bad(res, 'Product not found', 404);
  if (!Number.isInteger(qty) || qty < p.min_qty || qty > p.max_qty) return bad(res, `Quantity must be ${p.min_qty}-${p.max_qty}`);
  let cleanLink = null;
  if (p.category === 'boost') {
    try { const u = new URL(link); if (!/^https?:$/.test(u.protocol)) throw 0; cleanLink = u.href.slice(0, 500); }
    catch { return bad(res, 'Valid profile/post link required'); }
  } else if (typeof link === 'string' && link.trim()) cleanLink = link.trim().slice(0, 200);

  let result;
  try { result = placeOrder(req.user, p, qty, cleanLink); }
  catch (e) { if (e.stock) return bad(res, 'Not enough stock', 409); throw e; }
  if (result.error) return bad(res, result.error, 402);

  if (p.category === 'boost') {
    try {
      const pid = await submitToProvider({ link: cleanLink, qty }, p);
      if (pid) db.prepare('UPDATE orders SET provider_order=?, status=? WHERE id=?').run(pid, 'processing', result.id);
    } catch (e) {
      console.error('Provider error', e.message);
      refund(result.id, 'failed', 'Provider error - auto refund');
    }
  }
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(result.id);
  res.json({ order, balance: db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance });
}));

app.get('/api/orders', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 200').all(req.user.id));
});
app.get('/api/transactions', auth, (req, res) => {
  res.json(db.prepare('SELECT id,type,amount,status,note,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 200').all(req.user.id));
});

// ---------- payments (Paystack) ----------
const MIN_FUND = 100 * 100;
const creditDeposit = db.transaction((ref, amount) => {
  const t = db.prepare('SELECT * FROM transactions WHERE ref=? AND type=?').get(ref, 'deposit');
  if (!t || t.status !== 'pending' || t.amount !== amount) return false;
  db.prepare('UPDATE transactions SET status=? WHERE id=?').run('success', t.id);
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(t.amount, t.user_id);
  return true;
});

app.post('/api/fund', auth, wrap(async (req, res) => {
  if (!SITE.paystack) return bad(res, 'Online payment not configured', 503);
  const naira = Number(req.body && req.body.amount);
  const amount = Math.round(naira * 100);
  if (!money(amount) || amount < MIN_FUND || amount > 1e10) return bad(res, `Minimum is ${SITE.symbol}${MIN_FUND / 100}`);
  const ref = 'dep_' + crypto.randomBytes(12).toString('hex');
  const r = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: req.user.email, amount, reference: ref, currency: SITE.currency,
      callback_url: `${env.SITE_URL || ''}/#/wallet?ref=${ref}` }),
  });
  const j = await r.json();
  if (!j.status) return bad(res, 'Payment provider error', 502);
  db.prepare('INSERT INTO transactions(user_id,type,amount,ref) VALUES(?,?,?,?)').run(req.user.id, 'deposit', amount, ref);
  res.json({ url: j.data.authorization_url });
}));

app.get('/api/fund/verify/:ref', auth, wrap(async (req, res) => {
  const t = db.prepare('SELECT * FROM transactions WHERE ref=? AND user_id=? AND type=?').get(req.params.ref, req.user.id, 'deposit');
  if (!t) return bad(res, 'Not found', 404);
  if (t.status === 'pending' && SITE.paystack) {
    const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(t.ref)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET}` }, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (j.status && j.data.status === 'success' && j.data.currency === SITE.currency) creditDeposit(t.ref, j.data.amount);
  }
  res.json({ status: db.prepare('SELECT status FROM transactions WHERE id=?').get(t.id).status });
}));

app.post('/api/paystack/webhook', (req, res) => {
  if (!SITE.paystack || !req.rawBody) return res.sendStatus(400);
  const sig = crypto.createHmac('sha512', env.PAYSTACK_SECRET).update(req.rawBody).digest('hex');
  const given = String(req.get('x-paystack-signature') || '');
  if (given.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(sig))) return res.sendStatus(401);
  const ev = req.body;
  if (ev.event === 'charge.success' && ev.data && ev.data.currency === SITE.currency) creditDeposit(ev.data.reference, ev.data.amount);
  res.sendStatus(200);
});

// ---------- admin ----------
const adm = express.Router();
app.use('/api/admin', auth, admin, adm);

adm.get('/stats', (_req, res) => res.json({
  users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
  pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status IN('pending','processing')").get().c,
  revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN('completed','processing','pending')").get().s,
}));
adm.get('/orders', (_req, res) => res.json(db.prepare(
  'SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 300').all()));
adm.get('/users', (_req, res) => res.json(db.prepare('SELECT id,email,name,balance,role,created_at FROM users ORDER BY id DESC LIMIT 500').all()));
adm.get('/products', (_req, res) => res.json(db.prepare(
  'SELECT p.*,(SELECT COUNT(*) FROM stock s WHERE s.product_id=p.id AND s.order_id IS NULL) AS in_stock FROM products p ORDER BY p.id').all()));

function productFields(b) {
  const f = {
    category: b.category, platform: String(b.platform || '').slice(0, 40), name: String(b.name || '').trim().slice(0, 120),
    description: String(b.description || '').slice(0, 500), price: Math.round(Number(b.price)),
    per: Number(b.per) || 1, min_qty: Number(b.min_qty) || 1, max_qty: Number(b.max_qty) || 1,
    provider_service: b.provider_service ? String(b.provider_service).slice(0, 40) : null, active: b.active === 0 || b.active === false ? 0 : 1,
  };
  if (!['number', 'account', 'boost'].includes(f.category) || !f.name) return null;
  if (!Number.isInteger(f.price) || f.price < 0 || f.per < 1 || f.min_qty < 1 || f.max_qty < f.min_qty) return null;
  return f;
}
adm.post('/products', (req, res) => {
  const f = productFields(req.body || {});
  if (!f) return bad(res, 'Invalid product');
  const r = db.prepare(`INSERT INTO products(category,platform,name,description,price,per,min_qty,max_qty,provider_service,active)
    VALUES(@category,@platform,@name,@description,@price,@per,@min_qty,@max_qty,@provider_service,@active)`).run(f);
  res.json({ id: r.lastInsertRowid });
});
adm.put('/products/:id', (req, res) => {
  const f = productFields(req.body || {});
  if (!f) return bad(res, 'Invalid product');
  db.prepare(`UPDATE products SET category=@category,platform=@platform,name=@name,description=@description,price=@price,
    per=@per,min_qty=@min_qty,max_qty=@max_qty,provider_service=@provider_service,active=@active WHERE id=@id`).run({ ...f, id: Number(req.params.id) });
  res.json({ ok: true });
});
adm.post('/products/:id/stock', (req, res) => {
  const lines = String((req.body && req.body.items) || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 2000);
  if (!lines.length) return bad(res, 'No items');
  const ins = db.prepare('INSERT INTO stock(product_id,data) VALUES(?,?)');
  db.transaction(() => lines.forEach(l => ins.run(Number(req.params.id), l.slice(0, 1000))))();
  res.json({ added: lines.length });
});

adm.put('/orders/:id', (req, res) => {
  const { status, delivery } = req.body || {};
  const id = Number(req.params.id);
  if (!['pending', 'processing', 'completed', 'cancelled', 'failed', 'refunded'].includes(status)) return bad(res, 'Bad status');
  if (['cancelled', 'failed', 'refunded'].includes(status)) refund(id, status, `Admin ${status}`);
  else db.prepare('UPDATE orders SET status=?, delivery=COALESCE(?,delivery) WHERE id=? AND status NOT IN(\'cancelled\',\'failed\',\'refunded\')')
    .run(status, typeof delivery === 'string' ? delivery.slice(0, 2000) : null, id);
  res.json({ ok: true });
});
// Manual funding: admin credits wallet after confirming a bank transfer
adm.post('/credit', (req, res) => {
  const amount = Math.round(Number(req.body && req.body.amount) * 100);
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(String((req.body && req.body.email) || '').toLowerCase());
  if (!u || !money(amount)) return bad(res, 'Valid user email and amount required');
  db.transaction(() => {
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(amount, u.id);
    db.prepare('INSERT INTO transactions(user_id,type,amount,ref,status,note) VALUES(?,?,?,?,?,?)')
      .run(u.id, 'deposit', amount, `manual-${crypto.randomBytes(8).toString('hex')}`, 'success', 'Manual credit');
  })();
  res.json({ ok: true });
});

app.use('/api', (_req, res) => bad(res, 'Not found', 404));
app.use(express.static(path.join(__dirname, 'public')));

const port = Number(env.PORT) || 3000;
app.listen(port, () => console.log(`${SITE.name} running on http://localhost:${port}`));

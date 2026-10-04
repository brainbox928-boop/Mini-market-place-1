/* Front-end demo store: data saved in the browser (localStorage).
   Replace the functions in the "STORE" section with fetch() calls when you add a real backend. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => CONFIG.currency + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const total = (p, q) => Math.ceil(p.price * q / p.per);

// ---------- STORE ----------
const DB = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem("nl_" + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem("nl_" + k, JSON.stringify(v)),
};
async function hash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function seed() {
  if (!DB.get("users")) DB.set("users", [{ email: CONFIG.adminEmail, name: "Admin", pass: await hash(CONFIG.adminPassword), balance: 0, admin: true }]);
  if (!DB.get("stock")) { const s = {}; PRODUCTS.forEach(p => { if (p.stock) s[p.id] = [...p.stock]; }); DB.set("stock", s); }
  if (!DB.get("orders")) DB.set("orders", []);
  if (!DB.get("tx")) DB.set("tx", []);
}
const me = () => DB.get("users", []).find(u => u.email === DB.get("session"));
function saveUser(u) { DB.set("users", DB.get("users", []).map(x => x.email === u.email ? u : x)); }
function logTx(email, type, amount, note) { const t = DB.get("tx", []); t.unshift({ email, type, amount, note, date: new Date().toLocaleString() }); DB.set("tx", t); }
function toast(msg, ok = true) {
  let c = $("#toasts");
  if (!c) { c = document.createElement("div"); c.id = "toasts"; c.className = "toast-container position-fixed bottom-0 end-0 p-3"; document.body.append(c); }
  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${ok ? "success" : "danger"} border-0`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  c.append(el); const t = new bootstrap.Toast(el, { delay: 3500 }); t.show(); el.addEventListener("hidden.bs.toast", () => el.remove());
}
function requireLogin(admin) {
  const u = me();
  if (!u || (admin && !u.admin)) { location.href = "auth.html?next=" + encodeURIComponent(location.pathname.split("/").pop()); return null; }
  return u;
}

// ---------- LAYOUT ----------
function layout() {
  const u = me(), page = document.body.dataset.page;
  const a = (h, t, k) => `<li class="nav-item"><a class="nav-link ${page === k ? "active" : ""}" href="${h}">${t}</a></li>`;
  $("#site-nav").innerHTML = `<nav class="navbar navbar-expand-lg navbar-dark sticky-top"><div class="container">
    <a class="navbar-brand" href="index.html">${esc(CONFIG.name.slice(0, 4))}<span>${esc(CONFIG.name.slice(4))}</span></a>
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#nv"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="nv"><ul class="navbar-nav ms-auto align-items-lg-center gap-lg-2">
      ${a("index.html", "Home", "home")}${a("services.html", "Services", "services")}
      ${u ? a("dashboard.html", "Dashboard", "dashboard") + (u.admin ? a("admin.html", "Admin", "admin") : "") +
        `<li class="nav-item"><span class="badge bg-success">${money(u.balance)}</span></li>
         <li class="nav-item"><button class="btn btn-sm btn-outline-light" id="logout">Logout</button></li>`
        : `<li class="nav-item"><a class="btn btn-sm btn-brand" href="auth.html">Login / Sign up</a></li>`}
    </ul></div></div></nav>`;
  $("#site-footer").innerHTML = `<footer class="py-4 mt-5"><div class="container d-flex flex-wrap justify-content-between gap-2">
    <span>© ${new Date().getFullYear()} ${esc(CONFIG.name)}. All rights reserved.</span>
    <span>${CONFIG.whatsapp ? `<a class="text-info" href="${esc(CONFIG.whatsapp)}" target="_blank" rel="noopener">WhatsApp support</a> · ` : ""}<a class="text-info" href="#">Terms</a> · <a class="text-info" href="#">Privacy</a></span></div></footer>`;
  $("#logout")?.addEventListener("click", () => { localStorage.removeItem("nl_session"); location.href = "index.html"; });
}

// ---------- SHARED: product card + order modal ----------
function stockOf(p) { return p.type === "account" ? (DB.get("stock", {})[p.id] || []).length : null; }
function productCard(p) {
  const s = stockOf(p), out = s === 0;
  return `<div class="col-md-6 col-lg-4"><div class="card product-card h-100"><div class="card-body d-flex flex-column">
    <div><span class="badge bg-secondary">${esc(p.platform)}</span> ${s !== null ? `<span class="badge ${out ? "bg-danger" : "bg-success"}">${out ? "Out of stock" : s + " in stock"}</span>` : ""}</div>
    <h5 class="mt-2">${esc(p.name)}</h5><p class="text-muted small flex-grow-1">${esc(p.desc)}</p>
    <div class="price mb-2">${money(p.price)}${p.per > 1 ? `<small class="text-muted fs-6"> / ${p.per}</small>` : ""}</div>
    <button class="btn btn-brand" data-buy="${p.id}" ${out ? "disabled" : ""}>Order now</button></div></div></div>`;
}
function openOrder(id) {
  const u = requireLogin(); if (!u) return;
  const p = PRODUCTS.find(x => x.id === id);
  $("#om-title").textContent = p.name; $("#om-desc").textContent = p.desc;
  const qty = $("#om-qty"); qty.min = p.min; qty.max = p.type === "account" ? Math.min(p.max, stockOf(p)) : p.max; qty.value = p.min;
  $("#om-range").textContent = `${p.min} - ${qty.max}`;
  $("#om-link-wrap").style.display = p.type === "boost" ? "" : "none";
  $("#om-link").required = p.type === "boost"; $("#om-link").value = "";
  const upd = () => $("#om-total").textContent = money(total(p, Number(qty.value) || 0));
  qty.oninput = upd; upd();
  $("#om-form").onsubmit = e => { e.preventDefault(); placeOrder(p, Number(qty.value), $("#om-link").value.trim()); };
  bootstrap.Modal.getOrCreateInstance($("#orderModal")).show();
}
function placeOrder(p, qty, link) {
  const u = me(); const t = total(p, qty);
  if (!Number.isInteger(qty) || qty < p.min || qty > p.max) return toast("Invalid quantity", false);
  if (p.type === "boost") { try { if (!/^https?:$/.test(new URL(link).protocol)) throw 0; } catch { return toast("Enter a valid link (https://...)", false); } }
  if (u.balance < t) { toast("Insufficient balance. Fund your wallet first.", false); return setTimeout(() => location.href = "dashboard.html", 1200); }
  let status = "pending", delivery = "";
  if (p.type === "account") {
    const st = DB.get("stock", {}); const items = (st[p.id] || []).splice(0, qty);
    if (items.length < qty) return toast("Not enough stock", false);
    DB.set("stock", st); status = "completed"; delivery = items.join("\n");
  }
  u.balance -= t; saveUser(u);
  const orders = DB.get("orders", []);
  orders.unshift({ id: Date.now().toString().slice(-7), email: u.email, product: p.name, type: p.type, qty, total: t, link, status, delivery, date: new Date().toLocaleString() });
  DB.set("orders", orders); logTx(u.email, "purchase", -t, p.name);
  bootstrap.Modal.getOrCreateInstance($("#orderModal")).hide(); toast("Order placed!");
  setTimeout(() => location.href = "dashboard.html", 900);
}
function bindBuy(root) { root.addEventListener("click", e => { const b = e.target.closest("[data-buy]"); if (b) openOrder(Number(b.dataset.buy)); }); }

// ---------- PAGES ----------
const pages = {
  home() {
    $("#hero-name").textContent = CONFIG.name; $("#hero-tag").textContent = CONFIG.tagline;
    $("#popular").innerHTML = PRODUCTS.slice(0, 6).map(productCard).join(""); bindBuy($("#popular"));
  },
  services() {
    let cat = new URLSearchParams(location.search).get("type") || "boost";
    const draw = () => {
      $("#tabs").innerHTML = Object.entries(TYPES).map(([k, v]) => `<button class="btn btn-outline-brand ${k === cat ? "active" : ""}" data-cat="${k}">${v}</button>`).join("");
      const q = $("#search").value.toLowerCase();
      const list = PRODUCTS.filter(p => p.type === cat && (p.name + p.platform).toLowerCase().includes(q));
      $("#list").innerHTML = list.map(productCard).join("") || `<p class="text-muted">Nothing found.</p>`;
    };
    $("#tabs").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) { cat = b.dataset.cat; draw(); } });
    $("#search").addEventListener("input", draw); bindBuy($("#list")); draw();
  },
  auth() {
    const next = new URLSearchParams(location.search).get("next") || "dashboard.html";
    if (me()) location.href = next;
    $("#login-form").onsubmit = async e => {
      e.preventDefault();
      const email = $("#l-email").value.trim().toLowerCase(), pw = await hash($("#l-pass").value);
      const u = DB.get("users", []).find(x => x.email === email && x.pass === pw);
      if (!u) return toast("Invalid email or password", false);
      DB.set("session", u.email); location.href = /^[\w-]+\.html$/.test(next) ? next : "dashboard.html";
    };
    $("#reg-form").onsubmit = async e => {
      e.preventDefault();
      const email = $("#r-email").value.trim().toLowerCase(), pw = $("#r-pass").value, users = DB.get("users", []);
      if (pw.length < 8) return toast("Password must be 8+ characters", false);
      if (users.some(x => x.email === email)) return toast("Email already registered", false);
      users.push({ email, name: $("#r-name").value.trim(), pass: await hash(pw), balance: 0 });
      DB.set("users", users); DB.set("session", email); location.href = "dashboard.html";
    };
  },
  dashboard() {
    const u = requireLogin(); if (!u) return;
    const ref = new URLSearchParams(location.search).get("funded");
    $("#welcome").textContent = u.name; $("#balance").textContent = money(u.balance);
    $("#fund-form").onsubmit = e => { e.preventDefault(); fund(Number($("#fund-amt").value)); };
    document.querySelectorAll("[data-amt]").forEach(b => b.onclick = () => $("#fund-amt").value = b.dataset.amt);
    const mine = DB.get("orders", []).filter(o => o.email === u.email);
    $("#orders").innerHTML = mine.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.product)}<div class="small text-muted">${esc(o.link)}</div></td><td>${o.qty}</td><td>${money(o.total)}</td>
      <td><span class="badge badge-status ${statusClass(o.status)}">${esc(o.status)}</span></td><td>${o.delivery ? `<pre class="delivery">${esc(o.delivery)}</pre>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="text-muted">No orders yet. <a href="services.html">Browse services</a></td></tr>`;
    $("#tx").innerHTML = DB.get("tx", []).filter(t => t.email === u.email).map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.type)}</td><td class="${t.amount < 0 ? "text-danger" : "text-success"}">${money(t.amount)}</td><td>${esc(t.note)}</td></tr>`).join("");
    if (ref) toast("Payment received!");
  },
  admin() {
    if (!requireLogin(true)) return;
    const orders = DB.get("orders", []), users = DB.get("users", []);
    $("#a-stats").innerHTML = [["Users", users.length], ["Orders", orders.length], ["Open orders", orders.filter(o => ["pending", "processing"].includes(o.status)).length], ["Revenue", money(orders.filter(o => !["cancelled", "refunded"].includes(o.status)).reduce((s, o) => s + o.total, 0))]]
      .map(([k, v]) => `<div class="col-6 col-lg-3"><div class="card"><div class="card-body"><div class="text-muted small">${k}</div><div class="stat">${esc(v)}</div></div></div></div>`).join("");
    const opts = s => ["pending", "processing", "completed", "cancelled", "refunded"].map(v => `<option ${v === s ? "selected" : ""}>${v}</option>`).join("");
    $("#a-orders").innerHTML = orders.map(o => `<tr data-id="${esc(o.id)}"><td>${esc(o.id)}</td><td>${esc(o.email)}</td><td>${esc(o.product)}<div class="small text-muted">${esc(o.link)}</div></td><td>${o.qty}</td><td>${money(o.total)}</td>
      <td style="min-width:200px"><select class="form-select form-select-sm mb-1">${opts(o.status)}</select><input class="form-control form-control-sm mb-1" placeholder="Delivery (number / code)" value="${esc(o.delivery)}"><button class="btn btn-sm btn-brand" data-save>Save</button></td></tr>`).join("") || `<tr><td colspan="6" class="text-muted">No orders.</td></tr>`;
    $("#a-orders").onclick = e => {
      if (!e.target.matches("[data-save]")) return;
      const tr = e.target.closest("tr"), all = DB.get("orders", []), o = all.find(x => x.id === tr.dataset.id), st = tr.querySelector("select").value;
      const was = ["cancelled", "refunded"].includes(o.status);
      if (!was && ["cancelled", "refunded"].includes(st)) { const us = DB.get("users", []).find(x => x.email === o.email); us.balance += o.total; saveUser(us); logTx(o.email, "refund", o.total, "Order " + o.id); }
      if (was && !["cancelled", "refunded"].includes(st)) return toast("Refunded orders can't be reopened", false);
      o.status = st; o.delivery = tr.querySelector("input").value; DB.set("orders", all); toast("Saved");
    };
    $("#credit-form").onsubmit = e => {
      e.preventDefault();
      const us = DB.get("users", []).find(x => x.email === $("#c-email").value.trim().toLowerCase()), amt = Number($("#c-amt").value);
      if (!us || !(amt > 0)) return toast("Valid user and amount required", false);
      us.balance += amt; saveUser(us); logTx(us.email, "deposit", amt, "Manual credit"); toast("Wallet credited"); e.target.reset();
    };
    $("#a-users").innerHTML = users.map(x => `<tr><td>${esc(x.email)}</td><td>${esc(x.name)}</td><td>${money(x.balance)}</td></tr>`).join("");
  },
};
const statusClass = s => ({ completed: "bg-success", pending: "bg-warning text-dark", processing: "bg-info text-dark", cancelled: "bg-danger", refunded: "bg-danger" }[s] || "bg-secondary");

function fund(amount) {
  const u = me();
  if (!(amount >= 100)) return toast("Minimum is " + money(100), false);
  const credit = ref => { u.balance += amount; saveUser(u); logTx(u.email, "deposit", amount, "Paystack " + ref); location.href = "dashboard.html?funded=1"; };
  if (CONFIG.paystackPublicKey && window.PaystackPop) {
    // NOTE: client-side only. For production, verify payments on a server before crediting.
    PaystackPop.setup({ key: CONFIG.paystackPublicKey, email: u.email, amount: amount * 100, currency: "NGN",
      callback: r => credit(r.reference), onClose: () => toast("Payment cancelled", false) }).openIframe();
  } else {
    if (confirm("DEMO MODE: no real payment. Simulate paying " + money(amount) + "?")) credit("DEMO-" + Date.now());
  }
}

seed().then(() => { layout(); pages[document.body.dataset.page]?.(); });

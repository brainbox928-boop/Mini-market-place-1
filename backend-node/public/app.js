(() => {
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  let cfg = {}, me = null, products = [];
  const C = window.SITE_CONFIG || {};
  const CATS = C.categoryLabels || { number: 'Virtual Numbers', account: 'Social Accounts', boost: 'Social Boosting' };

  // Safe DOM builder: text is always set via textContent / text nodes (no HTML injection)
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const money = n => `${cfg.symbol}${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const toast = (m, err) => {
    const t = document.getElementById('toast');
    t.textContent = m; t.className = 'toast' + (err ? ' err' : '');
    setTimeout(() => t.classList.add('hidden'), 3500);
  };
  async function api(path, method = 'GET', body) {
    const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }
  const guard = fn => async e => { try { await fn(e); } catch (x) { toast(x.message, true); } };
  const field = (label, attrs) => [h('label', {}, label), h(attrs.tag || 'input', attrs)];
  const fmtDate = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleString();

  function renderNav() {
    $nav.replaceChildren(
      h('a', { href: '#/' }, 'Shop'),
      ...(me ? [
        h('a', { href: '#/orders' }, 'Orders'),
        h('a', { href: '#/wallet' }, `Wallet ${money(me.balance)}`),
        me.role === 'admin' ? h('a', { href: '#/admin' }, 'Admin') : null,
        h('a', { href: '#/', onclick: guard(async e => { e.preventDefault(); await api('/logout', 'POST', {}); me = null; renderNav(); location.hash = '#/'; route(); }) }, 'Logout'),
      ] : [h('a', { href: '#/login' }, 'Login'), h('a', { href: '#/register' }, 'Sign up')]));
  }

  // ---------- pages ----------
  let activeCat = C.defaultCategory || 'boost';
  function shop() {
    const list = products.filter(p => p.category === activeCat);
    $app.replaceChildren(
      h('section', { class: 'hero' }, h('h1', {}, C.heroTitle || cfg.name), h('p', {}, C.heroText || '')),
      h('div', { class: 'tabs' }, Object.entries(CATS).map(([k, v]) =>
        h('button', { class: 'tab' + (k === activeCat ? ' on' : ''), onclick: () => { activeCat = k; shop(); } }, v))),
      h('div', { class: 'grid' }, list.length ? list.map(productCard) : h('p', { class: 'mut' }, 'Nothing available right now.')),
      h('div', { class: 'grid features' }, (C.features || []).map(([i, t, d]) =>
        h('div', { class: 'card' }, h('div', { class: 'icon' }, i), h('h3', {}, t), h('p', { class: 'mut' }, d)))),
      C.contact && C.contact.url ? h('p', { style: 'text-align:center' }, h('a', { class: 'btn', href: C.contact.url, target: '_blank', rel: 'noopener' }, C.contact.label)) : null);
  }
  function productCard(p) {
    const out = p.category === 'account' && !p.in_stock;
    return h('div', { class: 'card' },
      h('span', { class: 'tag' }, p.platform), h('h3', {}, p.name), h('p', { class: 'mut' }, p.description),
      h('div', { class: 'price' }, money(p.price), p.per > 1 ? ` / ${p.per}` : ''),
      p.in_stock != null ? h('p', { class: 'mut' }, `${p.in_stock} in stock`) : null,
      h('a', { class: 'btn', href: out ? null : `#/buy/${p.id}` }, out ? 'Out of stock' : 'Order now'));
  }

  function authPage(kind) {
    const reg = kind === 'register';
    const f = h('form', { class: 'card form', onsubmit: guard(async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      me = await api(reg ? '/register' : '/login', 'POST', d);
      renderNav(); location.hash = '#/';
    }) },
      h('h2', {}, reg ? 'Create account' : 'Login'),
      reg ? field('Name', { name: 'name', required: true }) : null,
      field('Email', { name: 'email', type: 'email', required: true }),
      field('Password', { name: 'password', type: 'password', required: true, minlength: 8 }),
      h('button', { class: 'btn', type: 'submit' }, reg ? 'Sign up' : 'Login'));
    $app.replaceChildren(f);
  }

  function buy(id) {
    const p = products.find(x => x.id === Number(id));
    if (!p) return shop();
    if (!me) { location.hash = '#/login'; return; }
    const total = h('div', { class: 'price' });
    const qty = h('input', { name: 'qty', type: 'number', min: p.min_qty, max: p.max_qty, value: p.min_qty, required: true });
    const upd = () => { total.textContent = 'Total: ' + money(Math.ceil(p.price * (Number(qty.value) || 0) / p.per)); };
    qty.addEventListener('input', upd); upd();
    const hint = { boost: 'Profile or post link (must be public)', number: 'Notes (optional, e.g. country)', account: 'Notes (optional)' }[p.category];
    const f = h('form', { class: 'card form', onsubmit: guard(async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const r = await api('/orders', 'POST', { productId: p.id, qty: Number(d.qty), link: d.link });
      me.balance = r.balance; renderNav(); toast('Order placed!'); location.hash = '#/orders';
    }) },
      h('h2', {}, p.name), h('p', { class: 'mut' }, p.description),
      h('label', {}, `Quantity (${p.min_qty} - ${p.max_qty})`), qty,
      ...field(hint, { name: 'link', required: p.category === 'boost', maxlength: 500 }),
      total, h('p', { class: 'mut' }, `Your balance: ${money(me.balance)}`),
      h('button', { class: 'btn', type: 'submit' }, 'Place order'));
    $app.replaceChildren(f);
  }

  async function orders() {
    if (!me) { location.hash = '#/login'; return; }
    const rows = await api('/orders');
    $app.replaceChildren(h('h2', {}, 'My orders'), h('div', { class: 'card table-wrap' }, h('table', {},
      h('tr', {}, ['#', 'Product', 'Qty', 'Total', 'Status', 'Details'].map(t => h('th', {}, t))),
      rows.map(o => h('tr', {}, h('td', {}, o.id), h('td', {}, o.product_name), h('td', {}, o.qty), h('td', {}, money(o.total)),
        h('td', { class: 'st-' + o.status }, o.status),
        h('td', {}, o.link || '', o.delivery ? h('pre', {}, o.delivery) : null))))));
  }

  async function wallet(query) {
    if (!me) { location.hash = '#/login'; return; }
    const ref = new URLSearchParams(query).get('ref');
    if (ref) {
      try { const v = await api('/fund/verify/' + encodeURIComponent(ref)); toast(v.status === 'success' ? 'Payment received!' : 'Payment ' + v.status, v.status !== 'success'); me = await api('/me'); renderNav(); }
      catch (x) { toast(x.message, true); }
      history.replaceState(null, '', '#/wallet');
    }
    const tx = await api('/transactions');
    const amt = h('input', { type: 'number', min: 100, step: 1, value: 1000 });
    $app.replaceChildren(
      h('h2', {}, 'Wallet: ' + money(me.balance)),
      h('div', { class: 'card' }, h('h3', {}, 'Add funds'),
        cfg.paystack ? [h('label', {}, `Amount (${cfg.symbol})`), amt,
          h('button', { class: 'btn', onclick: guard(async () => { const r = await api('/fund', 'POST', { amount: Number(amt.value) }); location.href = r.url; }) }, 'Pay online (card / transfer)')] : null,
        cfg.manualInfo ? h('p', { class: 'mut' }, 'Manual transfer: ' + cfg.manualInfo + '. Send proof to support and your wallet will be credited.') : null),
      h('h3', {}, 'Transactions'),
      h('div', { class: 'card table-wrap' }, h('table', {},
        h('tr', {}, ['Date', 'Type', 'Amount', 'Status', 'Note'].map(t => h('th', {}, t))),
        tx.map(t => h('tr', {}, h('td', {}, fmtDate(t.created_at)), h('td', {}, t.type), h('td', {}, money(t.amount)), h('td', { class: 'st-' + t.status }, t.status), h('td', {}, t.note || ''))))));
  }

  // ---------- admin ----------
  async function adminPage() {
    if (!me || me.role !== 'admin') { location.hash = '#/'; return; }
    const [stats, ords, prods, users] = await Promise.all([api('/admin/stats'), api('/admin/orders'), api('/admin/products'), api('/admin/users')]);
    const reload = guard(async () => { await loadProducts(); await adminPage(); });
    const statusSel = o => {
      const s = h('select', {}, ['pending', 'processing', 'completed', 'cancelled', 'failed', 'refunded'].map(v => h('option', { value: v, selected: v === o.status }, v)));
      const d = h('input', { placeholder: 'Delivery info (number/code)', value: o.delivery || '' });
      return h('td', {}, s, d, h('button', { class: 'btn sm', onclick: guard(async () => { await api('/admin/orders/' + o.id, 'PUT', { status: s.value, delivery: d.value || undefined }); toast('Updated'); adminPage(); }) }, 'Save'));
    };
    const pf = h('form', { class: 'card', onsubmit: guard(async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(pf));
      d.price = Math.round(Number(d.price) * 100);
      await api('/admin/products', 'POST', d); toast('Product added'); pf.reset(); reload();
    }) },
      h('h3', {}, 'Add product'),
      h('div', { class: 'row' },
        h('select', { name: 'category' }, Object.entries(CATS).map(([k, v]) => h('option', { value: k }, v))),
        h('input', { name: 'platform', placeholder: 'Platform (Instagram...)' }),
        h('input', { name: 'name', placeholder: 'Name', required: true })),
      h('input', { name: 'description', placeholder: 'Description' }),
      h('div', { class: 'row' },
        h('input', { name: 'price', type: 'number', step: '0.01', min: '0', placeholder: `Price (${cfg.symbol})`, required: true }),
        h('input', { name: 'per', type: 'number', placeholder: 'Per (1 or 1000)', value: 1 }),
        h('input', { name: 'min_qty', type: 'number', placeholder: 'Min qty', value: 1 }),
        h('input', { name: 'max_qty', type: 'number', placeholder: 'Max qty', value: 1 }),
        h('input', { name: 'provider_service', placeholder: 'SMM service ID (optional)' })),
      h('button', { class: 'btn', type: 'submit' }, 'Add'));
    const cf = h('form', { class: 'card', onsubmit: guard(async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(cf));
      await api('/admin/credit', 'POST', { email: d.email, amount: Number(d.amount) }); toast('Wallet credited'); adminPage();
    }) },
      h('h3', {}, 'Credit wallet (manual payment)'),
      h('div', { class: 'row' }, h('input', { name: 'email', type: 'email', placeholder: 'User email', required: true }),
        h('input', { name: 'amount', type: 'number', step: '0.01', min: '1', placeholder: `Amount (${cfg.symbol})`, required: true }),
        h('button', { class: 'btn', type: 'submit' }, 'Credit')));
    $app.replaceChildren(
      h('h2', {}, 'Admin'),
      h('div', { class: 'grid' }, [['Users', stats.users], ['Orders', stats.orders], ['Open orders', stats.pending], ['Revenue', money(stats.revenue)]]
        .map(([k, v]) => h('div', { class: 'card' }, h('div', { class: 'mut' }, k), h('div', { class: 'price' }, v)))),
      h('h3', {}, 'Orders'),
      h('div', { class: 'card table-wrap' }, h('table', {},
        h('tr', {}, ['#', 'User', 'Product', 'Qty', 'Total', 'Link', 'Status / Delivery'].map(t => h('th', {}, t))),
        ords.map(o => h('tr', {}, h('td', {}, o.id), h('td', {}, o.email), h('td', {}, o.product_name), h('td', {}, o.qty), h('td', {}, money(o.total)), h('td', {}, o.link || ''), statusSel(o))))),
      h('h3', {}, 'Products & stock'),
      h('div', { class: 'card table-wrap' }, h('table', {},
        h('tr', {}, ['ID', 'Name', 'Type', 'Price', 'Stock', 'Active', ''].map(t => h('th', {}, t))),
        prods.map(p => h('tr', {}, h('td', {}, p.id), h('td', {}, p.name), h('td', {}, p.category), h('td', {}, money(p.price) + (p.per > 1 ? '/' + p.per : '')),
          h('td', {}, p.category === 'account' ? p.in_stock : '-'), h('td', {}, p.active ? 'yes' : 'no'),
          h('td', {},
            h('button', { class: 'btn sm sec', onclick: guard(async () => { await api('/admin/products/' + p.id, 'PUT', { ...p, active: p.active ? 0 : 1 }); reload(); }) }, p.active ? 'Hide' : 'Show'), ' ',
            p.category === 'account' ? h('button', { class: 'btn sm', onclick: guard(async () => {
              const items = prompt('Paste accounts, one per line (e.g. username:password:email):');
              if (items) { const r = await api(`/admin/products/${p.id}/stock`, 'POST', { items }); toast(`${r.added} added`); reload(); }
            }) }, 'Add stock') : null))))),
      pf, cf,
      h('h3', {}, 'Users'),
      h('div', { class: 'card table-wrap' }, h('table', {},
        h('tr', {}, ['Email', 'Name', 'Balance', 'Role', 'Joined'].map(t => h('th', {}, t))),
        users.map(u => h('tr', {}, h('td', {}, u.email), h('td', {}, u.name), h('td', {}, money(u.balance)), h('td', {}, u.role), h('td', {}, fmtDate(u.created_at)))))));
  }

  // ---------- router ----------
  async function route() {
    const [, page, arg] = location.hash.replace(/\?.*/, '').split('/');
    const query = location.hash.split('?')[1] || '';
    try {
      switch (page) {
        case 'login': return authPage('login');
        case 'register': return authPage('register');
        case 'buy': return buy(arg);
        case 'orders': return await orders();
        case 'wallet': return await wallet(query);
        case 'admin': return await adminPage();
        default: return shop();
      }
    } catch (x) { toast(x.message, true); }
  }
  async function loadProducts() { products = await api('/products'); }

  (async () => {
    cfg = await api('/config');
    document.title = cfg.name;
    document.getElementById('brand').textContent = cfg.name;
    document.getElementById('foot-name').textContent = cfg.name;
    document.getElementById('year').textContent = new Date().getFullYear();
    const fl = document.getElementById('foot-links');
    (C.footerLinks || []).forEach(([t, u]) => fl.append(' · ', h('a', { href: u }, t)));
    try { me = await api('/me'); } catch { me = null; }
    await loadProducts();
    renderNav();
    window.addEventListener('hashchange', route);
    route();
  })();
})();

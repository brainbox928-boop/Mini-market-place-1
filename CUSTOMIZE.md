# Front-end customization guide (no back-end knowledge needed)

| I want to change | Edit |
|---|---|
| Colors, fonts, spacing | `public/style.css` (the `:root` variables at the top) |
| Hero text, category names, feature cards, WhatsApp button, footer links | `public/site.config.js` |
| Site name / currency | `.env` (`SITE_NAME`, `CURRENCY_SYMBOL`) |
| Page layout / new sections | `public/app.js` (functions `shop`, `productCard`, `buy`, `orders`, `wallet`, `adminPage`) |
| Page shell, logo, meta tags | `public/index.html` |
| Products, prices, stock | Log in as admin, open `#/admin` (no code) |

Notes
- Changes to `public/` show on browser refresh. Restart `npm start` only after changing `server.js` or `.env`.
- UI is built with the `h('tag', {attrs}, children)` helper in `app.js`. Always pass user data as children (text), never as HTML, to stay XSS-safe.
- Do not edit `server.js` unless changing business rules (payments, orders, refunds).
- A logo: put `logo.png` in `public/` and add an `img` to the `.brand` link in `index.html`.

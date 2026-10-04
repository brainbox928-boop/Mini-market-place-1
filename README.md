# Mini Marketplace Template

Storefront for virtual numbers, pre-registered social accounts and social boosting.
Node.js + Express + SQLite, vanilla JS frontend.

## Features
- Sign up / login (bcrypt, httpOnly JWT cookie, rate-limited)
- Wallet: Paystack online funding (webhook + verify, idempotent) or manual bank transfer credited by admin
- Orders: accounts auto-delivered from stock; boosting auto-sent to an SMM panel API (auto-refund on failure); virtual numbers fulfilled by admin (type the number/code into the order's Delivery box)
- Admin panel (`#/admin`): stats, orders, products, stock upload, manual credit, users

## Run
1. Install Node.js 18+ (LTS) from nodejs.org
2. `npm install`
3. Copy `.env.example` to `.env` and fill it in (JWT_SECRET, admin login, Paystack keys, branding)
4. `npm start` then open http://localhost:3000 and log in as the admin from `.env`

## Go live
- Set `NODE_ENV=production`, serve over HTTPS (reverse proxy such as Nginx/Caddy), host on a VPS/Render/Railway with a persistent disk for `market.db`.
- Paystack dashboard: set webhook URL to `https://YOURDOMAIN/api/paystack/webhook`.
- Back up `market.db` regularly.
- Automatic virtual-number delivery needs an SMS provider's API; add it in `server.js` next to `submitToProvider`.
- Add Terms of Service and refund policy pages. Check each platform's rules and local laws before selling.

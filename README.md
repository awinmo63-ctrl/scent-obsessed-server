# Scent Obsessed

Luxury perfume e-commerce store. Single full-stack project: an Express server
that serves a React storefront and handles payments, shipping, auth, and an
admin dashboard.

## Stack

| Layer      | Tech                                                        |
|------------|-------------------------------------------------------------|
| Frontend   | React 19 (single-file, no build step, via esm.sh) + Tailwind CDN + `<model-viewer>` for 3D bottles |
| Backend    | Node.js + Express                                           |
| Database   | Supabase (Postgres) — orders, profiles, promo_codes, wheel_leads, exit_survey_responses |
| Auth       | Supabase Google OAuth (customers) + JWT cookie (admin)      |
| Payments   | Cashfree (live)                                             |
| Shipping   | Shiprocket (auto-push on paid + one-click dispatch in admin)|
| AI chat    | Google Gemini 2.5 Flash concierge                           |
| Hosting    | Render (deployed from GitHub)                               |

## Project structure

```
scent-obsessed/
├── server.js            # Express server: checkout, payment verify, chat, admin APIs
├── package.json
├── .env                 # secrets (NOT committed)
├── .env.example         # template for required env vars
├── .gitignore
├── public/              # served statically
│   ├── index.html       # storefront (React app) — the LIVE frontend
│   ├── login.html       # admin login page
│   └── *.glb / *.png    # 3D models + product images
└── private-views/
    └── admin.html       # admin dashboard (behind JWT auth)
```

## Run locally

```bash
npm install
cp .env.example .env    # then fill in real values
npm start               # starts on PORT (default 5000)
```

- Storefront: `http://localhost:5000/`
- Admin: `http://localhost:5000/admin` (redirects to `/login.html` if not authed)

## Key routes

| Route                              | Purpose                                  |
|------------------------------------|------------------------------------------|
| `POST /create-order`               | Create Cashfree order + insert into DB    |
| `GET  /api/verify-payment/:orderId`| Verify payment, update loyalty, push Shiprocket |
| `POST /api/chat`                   | Gemini concierge                          |
| `POST /api/admin/login`            | Admin login (JWT cookie)                  |
| `POST /api/admin/ship-order/:id`   | One-click Shiprocket dispatch (AWB+label) |
| `GET  /api/admin/orders`           | Admin: list orders                        |

## Features

4 Extrait de Parfum products (₹2,499 / 50ml) with 3D bottle viewer, loyalty
"Vessel" (ML-based rewards, 100ml = free bottle), referral codes, spin-to-win
wheel (lead capture), exit-intent discount, promo codes, AI concierge, order
tracking, and an admin dashboard.

## Deployment notes

- Deploys from GitHub → Render. `.env` values are set in Render's dashboard.
- Cashfree return URL is derived from the request host automatically.

# Dukaan Marketplace

Dukaan is a full-stack Indian marketplace demo built with React, Express, Node.js, and MongoDB. The catalog spans electronics, fashion, beauty, home, kitchen, sports, accessories, and books, with prices displayed in INR.

> This repository is a development project. Product prices and sample metrics are demonstration data. Payment, competitor-price, email, and production deployment integrations need valid provider configuration before real use.

## What it includes

- **Marketplace:** 26 sample products, search, category and price filters, sorting, product details, related products, and INR pricing.
- **Shopping:** persistent cart and wishlist, quantity and stock checks, discount-code handling, delivery PIN estimate, and checkout flow.
- **Payments:** Razorpay Checkout integration with server-side payment-signature verification. Use Razorpay test credentials while developing.
- **Customer account:** JWT sign-in, order history and status tracking, and seller application.
- **Seller centre:** approved sellers can submit listings for review, see their products and related orders, and mark eligible orders as shipped.
- **Admin console:** catalog and inventory tools, seller-application decisions, listing/legal review, order status controls, and price-comparison tools.
- **Price intelligence:** optional Gemini search with OpenRouter fallback. Results are automated estimates; verify the exact product variant, seller, availability, and delivery price with the retailer.
- **Security basics:** password hashing, JWT authorization, role checks, rate limits, request validation/sanitization, security headers, and server-only secrets.

## Role walkthrough

| Role | Entry point | Main journey |
| --- | --- | --- |
| Shopper | `/` → `/products/:id` → `/checkout` → `/account` | Browse and compare catalog items, add to bag, check out, and follow order status. |
| Seller | `/seller` | Apply for approval; after approval, submit a legal product listing and manage eligible fulfillment. |
| Admin | `/admin` | Review sellers and listings, maintain inventory, review orders, and run optional competitor-price checks. |

New registrations receive customer access. Seller access requires approval, and admin access must be assigned by the store owner. Do not use real customer data in screenshots, demo accounts, or public issue reports.

## Stack

| Layer | Tools |
| --- | --- |
| Frontend | React 18, Vite, Lucide icons, CSS |
| API | Node.js ES modules, Express 4, Helmet, CORS |
| Data | MongoDB Atlas or local MongoDB, Mongoose |
| Authentication | JWT and bcrypt |
| Payments | Razorpay Node SDK and Checkout |
| Optional search | Gemini and OpenRouter |

## Run locally

### Prerequisites

- Node.js 18 or later and npm.
- MongoDB Atlas or a local MongoDB instance.

### Install and configure

```bash
npm install
cp .env.example .env
```

On Windows PowerShell, copy the template with:

```powershell
Copy-Item .env.example .env
```

Edit `.env` on your machine. Never commit it or paste secret values into tickets or screenshots. Set at least:

- `MONGODB_URI`: local or Atlas connection URI. Keep the database user limited to this app's database.
- `JWT_SECRET`: a fresh random secret of at least 32 bytes for production.
- `CLIENT_URL`: the exact browser origin allowed to call the API.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: test keys for sandbox checkout.
- `RAZORPAY_WEBHOOK_SECRET`: only after configuring the webhook in Razorpay.
- `GEMINI_API_KEY` and `OPENROUTER_API_KEY`: optional price-check providers.

Optional `DEV_DEMO_CUSTOMER_EMAIL` / `DEV_DEMO_CUSTOMER_PASSWORD` and `DEV_DEMO_ADMIN_EMAIL` / `DEV_DEMO_ADMIN_PASSWORD` values enable local-only in-memory demo accounts. These are deliberately unset in the template. Use non-personal test addresses and strong local-only passwords; never configure demo accounts in production.

Start the API and storefront in separate terminals:

```bash
npm run server
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The API normally listens on port `5000`; Vite proxies `/api` to it.

When `MONGODB_URI` is configured, the API requires a successful database connection and will refuse to start if that connection fails. Without a configured URI, development can use the local fallback catalog; this mode is temporary and does not persist users, inventory, or orders. Production requires MongoDB.

## Payments and order lifecycle

1. The API checks the current product price and stock, then creates the Razorpay order.
2. Razorpay Checkout collects the test payment details in its hosted modal.
3. The client returns the payment identifiers; the API verifies the HMAC signature using the server-side key secret before marking payment successful.
4. Razorpay webhooks require `RAZORPAY_WEBHOOK_SECRET` and the configured `/api/orders/webhook` endpoint.
5. Admins manage eligible order statuses; approved sellers can mark their own eligible orders as shipped.

Do not use live keys or accept real payments until the Razorpay merchant account, webhook, catalog, taxes, shipping, refund/return policies, and support process have been reviewed.

## MongoDB and security

- `.env` is ignored by Git. `.env.example` contains placeholders only.
- Never use `0.0.0.0/0` for Atlas in production. Allow only the application host's required egress IPs.
- Prefer a dedicated database user with `readWrite` only on the Dukaan database; do not grant `atlasAdmin` to the application.
- Store API keys and the database URI only in server environment variables. Never prefix server secrets with `VITE_`.
- Rotate any secret that was accidentally committed or shared; removing a value in a later commit does not erase it from Git history.
- `/api/health` reports database connectivity; a disconnected database returns a degraded response.
- Local demo account credentials come from environment variables; the repository contains no default demo email/password pair.

## Project layout

```text
public/                     Product images and static assets
src/                        Storefront, product, checkout, and dashboard UI
server/index.js             Express setup, security middleware, MongoDB startup
server/models/              User, product, and order schemas
server/routes/              Authentication, catalog, checkout, admin, seller APIs
server/services/             Optional competitor-price providers
server/middleware/           Authentication, rate limits, and input sanitization
catalog.json                 Sample marketplace catalog
scripts/                     Image helper and security smoke-check script
DEPLOYMENT.md                Vercel, API host, Atlas, and Razorpay deployment notes
```

## Build and checks

```bash
npm run build
node scripts/test_security.js
```

The security script is a local smoke check; it does not replace a production security review. Use test payment credentials and a non-production database when exercising checkout.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the split frontend/API deployment, environment-variable list, Atlas networking, Razorpay webhook, and verification steps. GitHub stores the source; deployment URLs and environment secrets belong in the hosting provider's private settings, not in repository variables or README screenshots.

## License

No license is currently specified. All rights are reserved unless a license is added by the repository owner.

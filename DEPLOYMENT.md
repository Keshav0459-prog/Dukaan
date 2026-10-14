# Deploy Dukaan

Suggested layout: Vercel for the Vite/React storefront, Render for the Express API, and the existing MongoDB Atlas cluster for data. This keeps the API and its secrets out of the browser bundle.

## 1. Keep the GitHub repository secret-free

The source repository may be public. `.env` and `.env.*` are ignored by Git; keep them that way. Do not upload secrets, personal customer data, or private deployment URLs to GitHub, and never put server secrets in a `VITE_` variable.

## 2. Deploy the API on Render

Create a **Web Service** connected to the repository:

- Root directory: `.`
- Build command: `npm install`
- Start command: `npm run server`
- Health check path: `/api/health`

Add these in Render's Environment settings (do not commit their values):

- `NODE_ENV` = `production`
- `CLIENT_URL` = the final Vercel storefront origin, e.g. `https://dukaan-example.vercel.app` (no trailing slash)
- `MONGODB_URI` = the Atlas connection URI
- `JWT_SECRET` = a fresh, long random secret (at least 32 random bytes)
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` = test keys for initial sandbox verification; later replace with live keys after Razorpay account activation
- `RAZORPAY_WEBHOOK_SECRET` = the signing secret you create for the Razorpay webhook
- `GEMINI_API_KEY` and `OPENROUTER_API_KEY` = optional; only if enabling competitor price checks

Render assigns `PORT` automatically. The app reads it; do not set it to a fixed value.

## 3. Deploy the storefront on Vercel

Import the same repository as a Vite project. Use build command `npm run build` and output directory `dist`. Add this build-time variable:

- `VITE_API_URL` = the Render API origin, e.g. `https://dukaan-api.onrender.com` (no trailing slash)

Deploy once to get the Vercel production domain. Put that exact origin in Render's `CLIENT_URL`, save, and redeploy the API. The included `vercel.json` serves app routes through the SPA so direct product and dashboard links work.

## 4. Allow the API to reach Atlas

In Atlas Network Access, allow the Render API service's outbound IP ranges. Render shows these on the service page under **Connect → Outbound**; a service may use any IP in its listed ranges. Avoid `0.0.0.0/0` where possible: Atlas warns that it permits connections from anywhere. Use a dedicated database user with access limited to this app's database. If the Render region/ranges change, update Atlas's list.

## 5. Set up Razorpay's webhook

In the Razorpay Dashboard's webhook settings, add the HTTPS URL `https://<render-api-host>/api/orders/webhook`, select the `payment.captured` event, and copy the generated signing secret into Render as `RAZORPAY_WEBHOOK_SECRET`. Save the environment variable and redeploy. Keep test keys while validating the sandbox; do not accept real customer payments until the account, live keys, catalog, legal policies, returns/refunds and operational support are ready.

## 6. Verify the deployment

Open `https://<render-api-host>/api/health`; it should return `status: ok` and `database: connected`. If it returns `degraded`, fix the database connection before sending traffic. Then open the Vercel site, sign in, add an in-stock sample item, and run a Razorpay test payment. Confirm the order appears in the customer order history and that the admin can move a paid order through **Processing → Shipped → Delivered**. An approved seller can mark its own eligible processing order as shipped.

Render's free web services are useful for previews, but they sleep after 15 minutes of inactivity and Render says free instances are not for production. Use an always-on paid instance before relying on this store for customers. Vercel's static storefront can remain on its static hosting plan, subject to current account limits.

# NeonKey Reseller Panel — starter source code

A mobile-friendly neon-black digital product storefront with:
- Customer registration and login
- Password hashing with bcrypt
- Server-side sessions stored in PostgreSQL
- Product catalog and admin product controls
- Customer order history
- Admin dashboard, customer list, payment/order status controls
- Delivery note field for manually delivering digital keys or access details
- Render + Neon PostgreSQL support

## Important before launch
This is a starter application, not a fully audited production payment platform. Payment gateway checkout is **not** integrated. Orders start as `pending`; an admin should verify payment independently before marking an order `paid`. Do not put real card details into this app. Add a payment provider's official server-side webhook before automating payments. Delivery notes are visible to the customer who owns the order and admins, so only put the intended digital delivery details there.

## 1. Run locally
Requires Node.js 20+ and a PostgreSQL database.

1. Extract this ZIP.
2. Copy `.env.example` to `.env`.
3. Fill in `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Install and start:
   ```bash
   npm install
   npm start
   ```
5. Open `http://localhost:10000`.

The server creates database tables automatically and creates/promotes the account matching `ADMIN_EMAIL` as an admin on startup. `ADMIN_PASSWORD` is reset for that account at startup, so set it securely.

## 2. Deploy to Render
1. Upload the extracted project to a GitHub repository.
2. In Render choose **New + → Web Service**, connect that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. In the Render service's **Environment** section, add:
   - `DATABASE_URL` = your Neon connection string
   - `SESSION_SECRET` = a unique random string at least 32 characters long
   - `ADMIN_EMAIL` = the email address for the admin account
   - `ADMIN_PASSWORD` = a unique strong admin password
   - `NODE_ENV` = `production`
   - `SUPPORT_CONTACT` = optional contact info
6. Save and deploy. Render's Environment Group is optional; you can add variables directly to the actual web service Environment page. Never put secrets in frontend JavaScript or commit `.env`.

Official docs:
- Render environment variables: https://render.com/docs/configure-environment-variables
- Render web services: https://render.com/docs/web-services
- Neon connection string: https://neon.tech/docs/connect/connect-from-any-app

## 3. Admin use
Visit `https://YOUR-SERVICE.onrender.com/?page=admin` and sign in using `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- Add products and prices.
- View customers and orders.
- Verify payment before changing payment status to `paid`.
- Add the digital key/access details in the order's delivery note and set order status to `completed`.

## 4. Production checklist
- Use a unique strong admin password and long random session secret.
- Turn on multi-factor authentication for hosting and source-control accounts.
- Configure a real payment provider (e.g. Razorpay) with server-side signature/webhook verification before marking payments paid automatically.
- Add terms, refund policy, privacy policy, contact details, and tax/legal information appropriate to your business.
- Consider email verification, password reset, audit logs, backups, and automated tests before accepting real customers.
- Do not sell unauthorized access, stolen credentials, or products that violate the relevant service's terms.

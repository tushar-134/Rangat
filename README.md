# Table Service

A mobile-first QR ordering starter for Rangat Café & Restaurant, inspired by the supplied Nawalgarh interior and brand images. Built with React, Node.js, Express, Socket.IO, and MongoDB Atlas. The included dishes are illustrative placeholders until the restaurant's actual menu is provided.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a long random `JWT_SECRET`.
4. Run `npm run dev` and open `http://localhost:5173`.

The app starts in shared preview mode without MongoDB. The customer menu is at `http://localhost:5173/`; the staff order manager is at `http://localhost:5173/staff`. Both use the same Node API and Socket.IO connection, so a customer order appears on the staff board and staff status changes return to the customer's tracking screen. Preview orders live in server memory and clear when the API restarts.

## MongoDB Atlas setup

Put the Atlas connection URL in `MONGODB_URI` in the ignored `.env` file, set `DEMO_MODE=false`, configure `OWNER_EMAIL`, `OWNER_PASSWORD`, and `JWT_SECRET`, then run `npm run db:seed`. The idempotent seed creates the Rangat restaurant, owner account, illustrative sample menu, signed-token QR records for 20 tables; replace sample menu entries with the restaurant's approved menu when available. The app health endpoint should then report `database: connected`. Restrict Atlas network access to the API host where possible and use a database user with access only to this application's database. Never put the URI or secrets in React environment variables or commit `.env`.

## What is implemented

- Customer menu with categories, search, vegetarian and spicy filters, dish details, ingredients and allergens.
- Cart quantity controls, order submission, status tracking, call waiter/bill confirmation.
- Staff login with signed sessions, an order board, status transitions, and table QR management.
- Separate `/staff` order manager connected to the customer ordering flow through REST and Socket.IO.
- Express API, MongoDB models, Socket.IO event scaffolding, input validation, helmet headers, and health endpoint.
- Demo mode for customer-to-kitchen flow before restaurant configuration.
- Vercel Express function entrypoint with polling for order updates where WebSockets are unavailable.

## Before a live restaurant launch

Staff order reads and status changes require a signed staff session. The app currently bootstraps one owner account; add role-specific permissions, password reset, rate limiting, uploads, payment integration if needed, backups, and monitoring before a full commercial launch. Table QRs use signed, table-specific tokens, with only their hashes stored in Atlas. Customer order tracking uses an order access token.

The sample menu is generic demo content and does not claim to represent a particular restaurant. Replace dishes, prices, allergens, photos, currency, and tax configuration with verified restaurant data.

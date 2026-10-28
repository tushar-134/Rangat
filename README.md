# Table Service

A mobile-first QR ordering starter for Rangat Café & Restaurant, inspired by the supplied Nawalgarh interior and brand images. Built with React, Node.js, Express, Socket.IO, and MongoDB Atlas. The included dishes are illustrative placeholders until the restaurant's actual menu is provided.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a long random `JWT_SECRET`.
4. Run `npm run dev` and open `http://localhost:5173`.

The app starts in shared preview mode without MongoDB. The customer menu is at `http://localhost:5173/`; the staff order manager is at `http://localhost:5173/staff`. Both use the same Node API and Socket.IO connection, so a customer order appears on the staff board and staff status changes return to the customer's tracking screen. Preview orders live in server memory and clear when the API restarts.

## MongoDB Atlas setup

When you share the Atlas connection URL, put it in `MONGODB_URI` in `.env`, replace the placeholder database name, and set `DEMO_MODE=false`. Restrict Atlas network access to the API host where possible and use a database user with access only to this application's database. Never put this URL in React environment variables or commit `.env`.

## What is implemented

- Customer menu with categories, search, vegetarian and spicy filters, dish details, ingredients and allergens.
- Cart quantity controls, order submission, status tracking, call waiter/bill confirmation.
- Staff order-board preview with order status transitions.
- Separate `/staff` order manager connected to the customer ordering flow through REST and Socket.IO.
- Express API, MongoDB models, Socket.IO event scaffolding, input validation, helmet headers, and health endpoint.
- Demo mode for customer-to-kitchen flow before restaurant configuration.

## Before a live restaurant launch

The included demo dashboard is not an authenticated staff product. Add staff login/session middleware and role authorization before exposing order management. In production, generate high-entropy QR tokens per table, store only their hashes, validate the QR token for menu context and order creation, and scope customer tracking with an order access token. Add upload storage, payment provider integration if needed, backups, monitoring, and operational rate limiting. Staff order listing and status changes must be protected by staff authentication before deployment.

The sample menu is generic demo content and does not claim to represent a particular restaurant. Replace dishes, prices, allergens, photos, currency, and tax configuration with verified restaurant data.

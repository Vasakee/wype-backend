# Wype Backend

Wype is a payment application on the [Quai Network](https://qu.ai/) that lets users send money using only an **email address** or a **WhatsApp number** — no wallet addresses required.

This repository is the **backend API**: a modular **NestJS 11** application written in strict **TypeScript**, backed by **MongoDB** (Mongoose). The frontend lives in the sibling `wype-frontend` folder.

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [Testing](#testing)
- [Scripts](#scripts)
- [Design Decisions](#design-decisions)
- [Roadmap](#roadmap)

---

## Features

- **Email or WhatsApp identities** — users register with an email, a WhatsApp number, or both. Emails are normalized (lowercased) and both fields are unique.
- **JWT authentication** — bcrypt-hashed passwords, `passport-jwt` strategy, a reusable `JwtAuthGuard`, and configurable token lifetime.
- **Per-user QUAI wallet** — one wallet per user with the Quai address and an exact string-based balance.
- **Transfers by contact** — create a payment to a recipient resolved by email or WhatsApp number, with a full status lifecycle (`pending → processing → completed | failed`).
- **WhatsApp bot** — a global Twilio-powered module with outbound messages and an inbound webhook endpoint (TwiML) ready to drive a conversational flow.
- **Global health check** — `GET /api/health` for uptime/monitoring probes.
- **Production-oriented setup** — strict TypeScript, validated DTOs, centralized configuration, and lazy-loading of external clients.

---

## How It Works

```
┌────────────┐   register/login    ┌────────────────────┐
│ Frontend   │ ──────────────────▶ │  /api/auth/*       │
│ (sibling)  │   Bearer token      └─────────┬──────────┘
└────────────┘                               │ JWT
                              ┌──────────────▼──────────────┐
                              │  Users  │ Wallet  │ Transfers│
                              └──────────────┬──────────────┘
                                             │
                              ┌──────────────▼──────────────┐
                              │  Whatsapp (Twilio)          │
                              │  - outbound messages        │
                              │  - inbound webhook          │
                              └─────────────────────────────┘
```

1. A user registers via `POST /api/auth/register` with an email and/or WhatsApp number and a password.
2. The API stores the bcrypt hash and returns a signed JWT.
3. The user links a Quai wallet (`POST /api/wallet`).
4. To send money, the user calls `POST /api/transfers` with the recipient's email or WhatsApp number and an amount. The recipient is looked up by identity; if they exist and have WhatsApp linked, they receive a payment notification message.
5. On-chain settlement on Quai (via `contracts/` and `QUAI_RPC_URL`) is the next milestone — see [Roadmap](#roadmap).

---

## Tech Stack

| Concern            | Choice                                                            |
| ------------------ | ----------------------------------------------------------------- |
| Framework          | [NestJS 11](https://nestjs.com/)                                   |
| Language           | TypeScript (strict)                                                |
| Database           | MongoDB via [Mongoose](https://mongoosejs.com/) + `@nestjs/mongoose` |
| Configuration      | `@nestjs/config`                                                   |
| Validation         | `class-validator` + `class-transformer`                            |
| Auth               | `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`        |
| WhatsApp           | [Twilio](https://www.twilio.com/docs/whatsapp)                     |
| Smart contracts    | Solidity (in `contracts/`)                                          |

---

## Project Structure

```
wype-backend/
├── contracts/                  # Solidity contracts (Registry.sol, Escrow.sol — planned)
├── src/
│   ├── main.ts                 # Bootstrap: global /api prefix, CORS, validation pipe
│   ├── app.module.ts           # Root module: ConfigModule + Mongoose connection
│   ├── app.controller.ts       # GET /api/health
│   ├── app.service.ts
│   ├── auth/                   # Registration, login, JWT strategy & guard
│   │   ├── dto/                # register.dto.ts, login.dto.ts
│   │   ├── interfaces/         # jwt-payload, authenticated-request
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── jwt.strategy.ts
│   │   └── jwt-auth.guard.ts
│   ├── users/                  # User accounts (email / WhatsApp number)
│   │   ├── schemas/            # user.schema.ts (password hidden via select:false)
│   │   ├── users.module.ts
│   │   ├── users.controller.ts # GET /users/me
│   │   ├── users.service.ts
│   │   └── users.service.spec.ts
│   ├── wallet/                 # One QUAI wallet per user
│   │   ├── dto/                # create-wallet.dto.ts
│   │   ├── schemas/            # wallet.schema.ts
│   │   ├── wallet.module.ts
│   │   ├── wallet.controller.ts
│   │   └── wallet.service.ts   # create, credit, debit
│   ├── transfer/               # Send money by email or WhatsApp
│   │   ├── dto/                # create-transfer.dto.ts
│   │   ├── schemas/            # transfer.schema.ts
│   │   ├── transfer.module.ts
│   │   ├── transfer.controller.ts
│   │   └── transfer.service.ts
│   └── whatsapp/               # Twilio WhatsApp module (global)
│       ├── dto/                # incoming-message.dto, send-message.dto
│       ├── whatsapp.module.ts
│       ├── whatsapp.controller.ts
│       └── whatsapp.service.ts # lazy Twilio client + sendMessage
└── test/
    └── app.e2e-spec.ts         # e2e health check
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **MongoDB** — running locally (`mongod`), via Docker, or MongoDB Atlas
- **Twilio** (optional) — account with WhatsApp Sandbox or an approved sender for message sending

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Edit .env and set at least:
#    MONGODB_URI, JWT_SECRET
```

### Run

```bash
# Watch mode (development)
npm run start:dev

# Or run the compiled output
npm run build
npm run start:prod
```

The API is served at `http://localhost:3000/api`. Verify with:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","service":"wype-backend","timestamp":"..."}
```

> Note: startup waits for the MongoDB connection (`MongooseModule.forRootAsync`), so ensure `MONGODB_URI` is reachable before calling the API.

---

## Environment Variables

| Variable                 | Description                                   | Required |
| ------------------------ | --------------------------------------------- | -------- |
| `PORT`                   | HTTP port (default `3000`)                    | no       |
| `NODE_ENV`               | Environment name (`development`, `production`) | no       |
| `MONGODB_URI`            | MongoDB connection string                     | **yes**  |
| `JWT_SECRET`             | Secret used to sign JWTs                      | **yes**  |
| `JWT_EXPIRES_IN`         | Token lifetime, e.g. `7d` (default `7d`)      | no       |
| `TWILIO_ACCOUNT_SID`     | Twilio account SID                            | on send  |
| `TWILIO_AUTH_TOKEN`      | Twilio auth token                             | on send  |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp sender (E.164)                | on send  |
| `QUAI_RPC_URL`           | Quai Network RPC endpoint                     | no       |

Generate a strong `JWT_SECRET`, e.g. `openssl rand -base64 48`.

---

## API Reference

All endpoints are prefixed with `/api`. Amounts are **strings in minor units** to avoid floating-point precision issues.

### Health

**`GET /api/health`** — no auth

```json
{ "status": "ok", "service": "wype-backend", "timestamp": "2026-08-13T00:00:00.000Z" }
```

### Auth

**`POST /api/auth/register`** — no auth

Register with an email and/or WhatsApp number (at least one is required).

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "whatsappNumber": "+14155552671",
  "password": "password123"
}
```

Returns a JWT and the sanitized user profile:

```json
{
  "accessToken": "<jwt>",
  "user": {
    "id": "66f1...",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "whatsappNumber": "+14155552671"
  }
}
```

**`POST /api/auth/login`** — no auth

`identifier` is either the email or the WhatsApp number (E.164).

```json
{ "identifier": "ada@example.com", "password": "password123" }
```

Returns the same shape as register.

### Users

**`GET /api/users/me`** — Bearer token

Returns the authenticated user's profile. The password hash is never returned (`select: false`).

### Wallet

**`GET /api/wallet`** — Bearer token

Returns the current user's wallet, or `null` if none is linked.

**`POST /api/wallet`** — Bearer token

Link a Quai wallet address (one per user).

```json
{ "address": "0x1234...abcd" }
```

### Transfers

**`GET /api/transfers`** — Bearer token

Lists the last 50 transfers where the user is sender or recipient.

**`POST /api/transfers`** — Bearer token

Create a transfer to a registered Wype user by email or WhatsApp number.

```json
{
  "recipientEmail": "sam@example.com",
  "amount": "25000",
  "currency": "QUAI"
}
```

or with a WhatsApp recipient:

```json
{
  "recipientWhatsapp": "+15555550100",
  "amount": "25000"
}
```

The recipient is resolved by identity; if they have a WhatsApp number, they are notified automatically. `currency` defaults to `QUAI`.

### WhatsApp

**`POST /api/whatsapp/send`** — Bearer token

Send an outbound WhatsApp message via Twilio.

```json
{ "to": "+15555550100", "body": "You received 25000 QUAI via Wype." }
```

**`POST /api/whatsapp/webhook`** — no auth (Twilio calls this)

Inbound webhook. Twilio posts form-encoded message data; the endpoint replies with **TwiML**. Point your Twilio WhatsApp Sandbox "when a message comes in" URL here.

---

## Authentication

Protected endpoints require a JWT:

```
Authorization: Bearer <accessToken>
```

Obtain a token from `POST /api/auth/register` or `POST /api/auth/login`. The token embeds `sub` (user id), `email`, and `whatsappNumber`, and expires according to `JWT_EXPIRES_IN`.

---

## Testing

```bash
npm run test        # unit tests (Jest)
npm run test:cov    # coverage report
npm run test:e2e    # e2e tests (supertest) — requires MongoDB
```

---

## Scripts

| Command              | Description                        |
| -------------------- | ---------------------------------- |
| `npm run start:dev`  | Watch mode                         |
| `npm run build`      | Compile to `dist/`                 |
| `npm run start`      | Run NestJS from source             |
| `npm run start:prod` | Run compiled output                |
| `npm run start:debug`| Debug watch mode                   |
| `npm run lint`       | ESLint (with `--fix`)              |
| `npm run format`     | Prettier                           |
| `npm run test`       | Unit tests                         |
| `npm run test:e2e`   | End-to-end tests                   |

---

## Design Decisions

- **String amounts** — balances and transfer amounts are strings in minor units (`"25000"`), never floats, to guarantee exact arithmetic for money.
- **Hidden password hashes** — `passwordHash` uses `select: false` so it can never leak through a serialized user.
- **Lazy Twilio client** — the Twilio SDK is initialized on first send, so the API starts without Twilio credentials; message sending fails loudly only when actually used.
- **Global WhatsApp module** — the WhatsApp service is available app-wide so any feature (transfers, auth) can notify users without circular imports.
- **Normalized identities** — emails are lowercased at the schema and service level; WhatsApp numbers are stored as E.164.
- **Strict TypeScript** — `strict: true`, plus `import type` for type-only imports to satisfy `isolatedModules` + `emitDecoratorMetadata`.

---

## Roadmap

- [ ] `contracts/Registry.sol` — on-chain user ↔ wallet mapping
- [ ] `contracts/Escrow.sol` — escrow for email/WhatsApp payouts
- [ ] Settlement flow on Quai Network via `QUAI_RPC_URL`
- [ ] WhatsApp bot conversation for claiming payments
- [ ] Email notifications on transfer status changes
- [ ] Rate limiting and request throttling

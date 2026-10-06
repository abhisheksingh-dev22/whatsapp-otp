# Integration guide: WhatsApp OTP (MSG91) into the Admission Form

This repo is a **verified, working test harness** (Express backend + Angular 18 test form).
It is a reference implementation, not production code. The task is to port the same
behaviour into the existing Admission Form and its production backend.

## Task for Claude Code
Add WhatsApp OTP verification to the existing Admission Form, using this repo as the
reference for behaviour and the MSG91 contract.

Rules:
- Do NOT modify or remove the existing SMS OTP flow. WhatsApp OTP is added alongside it.
- Inspect the Admission Form frontend and backend first and follow their existing
  conventions (project structure, naming, error handling, auth, DI, config).
- Do not copy `backend/server.js` as-is into production (see "Production changes").
- Never log, return or hardcode the OTP, the authkey or the OTP secret.

## Architecture
```
Admission Form (browser)  -->  Production backend (holds secrets, OTP)  -->  MSG91 WhatsApp API
      no secrets
```
The browser never calls MSG91 and never sees the authkey, namespace or OTP.

## Reference files
- `backend/server.js` - exact logic for send/verify and the MSG91 call (the source of truth).
- `frontend/src/app/otp.service.ts` - the two API calls.
- `frontend/src/app/whatsapp-otp-test/` - the UI flow (step 1 mobile, step 2 OTP,
  30s resend countdown, change number, verified state), written with signals + reactive forms.

## API contract (keep identical so the UI ports cleanly)
`POST /api/otp/send`  body `{ "mobile": "9XXXXXXXXX" }`
- 400 invalid mobile (`^[6-9]\d{9}$`), 429 cooldown (30s per mobile), 502 MSG91 failure
- 200 `{ "success": true }`. Never return the OTP.

`POST /api/otp/verify`  body `{ "mobile": "...", "otp": "......" }`
- 400 not requested / expired / wrong OTP (with attempts left), 429 after 5 wrong attempts
- 200 `{ "verified": true }`; OTP is single use (deleted on success)

Error responses carry `{ "message": "..." }`, which the UI displays directly.

## Rules to preserve
- OTP: `crypto.randomInt(100000, 1000000)` equivalent (cryptographically secure, 6 digits).
- Store only `HMAC-SHA256(secret, "mobile:otp")`, never the plain OTP. 10-minute expiry, attempts = 0.
- Compare hashes with a constant-time comparison.
- Max 5 wrong attempts; the 6th attempt returns 429 and invalidates the OTP.
- A new send replaces the previous OTP (old one stops working). Failed MSG91 send clears the record.
- Log only MSG91 `request_id`.

## MSG91 contract (tested and working)
`POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`
Headers: `Content-Type: application/json`, `authkey: <MSG91_AUTHKEY>`
Body: see `sendWhatsApp()` in `backend/server.js`.
- The OTP must be in BOTH `body_1` and `button_1` (Copy Code button). Without `button_1`
  MSG91 returns success but the message fails later.
- `status: success` + `request_id` means queued, not delivered.
- Treat non-2xx or `hasError: true` as failure and return 502.
- Recipient format is `91` + 10-digit mobile.

## Configuration: Railway environment variables
Set these as Railway service variables on the production backend. Do not commit them,
and do not put them in any frontend environment file.

| Variable | Value |
|---|---|
| `MSG91_AUTHKEY` | MSG91 authkey (secret) |
| `MSG91_INTEGRATED_NUMBER` | `919909166223` |
| `MSG91_TEMPLATE_NAME` | `admformotp` |
| `MSG91_NAMESPACE` | WhatsApp template namespace |
| `OTP_SECRET` | long random string (secret), e.g. 64 hex chars |

Read them from the environment through the backend's existing configuration mechanism
(for .NET: `IConfiguration` / `Options` pattern; env var names map via `__` if nested).
Fail fast at startup if any are missing. Railway sets `PORT` itself.

## Production changes required (differences from this harness)
1. **OTP storage**: the harness uses an in-memory Map. On Railway (restarts, redeploys,
   possibly multiple instances) that loses OTPs and breaks cooldown/attempt counts.
   Use the backend's existing database (or Redis if already available) with columns:
   mobile, otp_hash, expires_at, attempts, sent_at. Make the send/verify updates atomic
   so attempts and single-use cannot be raced. Clean up expired rows.
2. **Rate limiting**: add per-IP limiting on `/send` as well as the per-mobile cooldown,
   to prevent abuse and MSG91 cost drain.
3. **Admission form linkage**: after `verified: true`, the form submission must be
   guarded server-side (e.g. server records the verified mobile and checks it on submit,
   or issues a short-lived signed verification token). Do not trust a client-side
   "verified" flag.
4. **CORS / base URL**: use the form's existing API base URL and CORS setup instead of the
   dev proxy (`proxy.conf.json` is dev-only).
5. **Language**: production backend is .NET; port the logic, do not run this Node server.
   (`System.Security.Cryptography`: `RandomNumberGenerator.GetInt32(100000, 1000000)`,
   `HMACSHA256`, `CryptographicOperations.FixedTimeEquals`; `HttpClient` for MSG91.)

## Acceptance checklist
- Full send -> WhatsApp message (same code in text and Copy code button) -> verify works.
- Wrong OTP rejected; 6th attempt locked; reused OTP rejected; expired OTP rejected.
- Resend inside 30s returns 429; resend after cooldown invalidates the old OTP.
- OTP, authkey and secret never appear in responses, logs, network tab or frontend bundle.
- Existing SMS OTP flow and the rest of the Admission Form behave exactly as before.

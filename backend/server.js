require('dotenv').config();
const crypto = require('crypto');
const express = require('express');

const {
  MSG91_AUTHKEY, MSG91_INTEGRATED_NUMBER, MSG91_TEMPLATE_NAME, MSG91_NAMESPACE,
  OTP_SECRET, PORT = 3000,
} = process.env;

const MSG91_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';
const MOBILE_RE = /^[6-9]\d{9}$/;
const COOLDOWN_MS = 30 * 1000;
const EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// mobile -> { hash, expiresAt, attempts, sentAt }
const store = new Map();

const hmac = (mobile, otp) =>
  crypto.createHmac('sha256', OTP_SECRET).update(`${mobile}:${otp}`).digest();

async function sendWhatsApp(mobile, otp) {
  const res = await fetch(MSG91_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: MSG91_AUTHKEY },
    body: JSON.stringify({
      integrated_number: MSG91_INTEGRATED_NUMBER,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: MSG91_TEMPLATE_NAME,
          language: { code: 'en', policy: 'deterministic' },
          namespace: MSG91_NAMESPACE,
          to_and_components: [{
            to: [`91${mobile}`],
            components: {
              body_1: { type: 'text', value: otp },
              button_1: { subtype: 'url', type: 'text', value: otp },
            },
          }],
        },
      },
    }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok || data.hasError === true || data.status === 'fail') {
    throw new Error(`MSG91 error (HTTP ${res.status})`);
  }
  return data.request_id || data.data?.request_id || data.data || null;
}

const app = express();
app.use(express.json());

app.post('/api/otp/send', async (req, res) => {
  const mobile = String(req.body?.mobile ?? '');
  if (!MOBILE_RE.test(mobile)) {
    return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number.' });
  }
  const existing = store.get(mobile);
  if (existing) {
    const wait = Math.ceil((existing.sentAt + COOLDOWN_MS - Date.now()) / 1000);
    if (wait > 0) {
      return res.status(429).json({ success: false, message: `Please wait ${wait}s before requesting another OTP.` });
    }
  }
  const otp = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  // set cooldown before the network call so concurrent requests can't bypass it
  store.set(mobile, { hash: hmac(mobile, otp), expiresAt: now + EXPIRY_MS, attempts: 0, sentAt: now });
  try {
    const requestId = await sendWhatsApp(mobile, otp);
    console.log(`[otp/send] queued request_id=${JSON.stringify(requestId)}`);
    res.json({ success: true });
  } catch (err) {
    store.delete(mobile);
    console.error(`[otp/send] ${err.message}`);
    res.status(502).json({ success: false, message: 'Could not send OTP right now. Please try again.' });
  }
});

app.post('/api/otp/verify', (req, res) => {
  const mobile = String(req.body?.mobile ?? '');
  const otp = String(req.body?.otp ?? '');
  if (!MOBILE_RE.test(mobile) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ verified: false, message: 'Enter a valid mobile number and 6-digit OTP.' });
  }
  const rec = store.get(mobile);
  if (!rec) {
    return res.status(400).json({ verified: false, message: 'No OTP requested for this number. Please request one.' });
  }
  if (Date.now() > rec.expiresAt) {
    store.delete(mobile);
    return res.status(400).json({ verified: false, message: 'OTP has expired. Please request a new one.' });
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    store.delete(mobile);
    return res.status(429).json({ verified: false, message: 'Too many wrong attempts. Please request a new OTP.' });
  }
  const ok = crypto.timingSafeEqual(rec.hash, hmac(mobile, otp));
  if (ok) {
    store.delete(mobile);
    return res.json({ verified: true });
  }
  rec.attempts += 1;
  res.status(400).json({ verified: false, message: `Incorrect OTP. ${MAX_ATTEMPTS - rec.attempts} attempt(s) left.` });
});

app.listen(PORT, () => console.log(`OTP test backend on http://localhost:${PORT}`));

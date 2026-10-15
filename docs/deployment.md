# Deploying Batkle

What has to be done before Batkle goes live on Vercel with real accounts and real payments. Work top to bottom: later steps need the domain, database and keys from earlier ones. Each item is something to do in a dashboard, a DNS panel or Vercel; what's already handled in code is left out.

## 1. Do these first (security)

- [ ] **Change the MongoDB password.** Atlas → Database Access → edit the database user → a new long random password. This repository is public and old commits contain the connection string with the current password, so treat it as known. Then update `MONGO_URL` in `.env.local`.
- [ ] **Revoke the old Groq key.** In the Groq console, delete the key that starts with `gsk_MWq7` (it is in an old `test_result.md`). The key in `.env.local` is a different one.
- [ ] **Stop other sites from framing the app.** `next.config.js` sends `Content-Security-Policy: frame-ancestors *` and `X-Frame-Options: ALLOWALL` on every page, so any website can load the signed-in pages (billing, settings) in a hidden frame and trick people into clicks. Change it to `frame-ancestors 'self'` and remove the `X-Frame-Options` line.
- [ ] Don't paste `.env.local` into Vercel as it is: it has test keys, development Clerk keys and `localhost`.

## 2. Accounts and decisions

- [ ] **A domain.** Clerk's production instance doesn't run on `*.vercel.app`; it needs a domain you own. Add it in Vercel → Settings → Domains and point its DNS at Vercel.
- [ ] **Vercel Pro.** The Hobby plan is for non-commercial use only, and its cron jobs run at most once a day; reminders need a run every few minutes (step 8).
- [ ] **Terms, privacy and refund pages.** The site has none, and Stripe's account review, Google's OAuth consent screen and Twilio's US texting registration all ask for links to them. Cover what each plan includes, the 7-day trial and how to cancel, refunds, what you store (brand details, images, email, phone number) and who processes it (Clerk, Stripe, MongoDB Atlas, Cloudflare R2, Resend, Twilio, Groq, OpenAI, fal). Link them in the footer and on sign-up.
- [ ] **Tax.** Checkout doesn't collect tax. Selling subscriptions to consumers, in the EU especially, usually means charging VAT. Ask an accountant; Stripe Tax can calculate and collect it (it needs a change in the checkout code).
- [ ] **One database or two.** Data belongs to accounts by Clerk user ID, and the production Clerk instance gives everyone a new ID, you included:
  - Brands, posts and galleries made before sign-in existed go to `LEGACY_DATA_OWNER_EMAIL` (step 4).
  - What you made while signed in locally since 13 October belongs to your development account and won't appear in production. Moving it is a one-off database update of its `ownerId`.
  - Recommended: production keeps the current database with the real data, and local development uses another `DB_NAME` (e.g. `kand_dev`), so test checkouts, test accounts and local reminders never mix with real ones. Both count toward the cluster's 512 MB.

## 3. Database and images (MongoDB Atlas, Cloudflare R2)

- [ ] **Network access.** Vercel has no fixed IP addresses, so Atlas → Network Access needs `0.0.0.0/0`. This is why the new password in step 1 matters.
- [ ] **Move the images to R2.** Images are stored in MongoDB, and the free M0 cluster blocks every write at 512 MB (it reached that on 8 October). In Cloudflare, create an R2 bucket and an API token with Object Read & Write on it, put the four `R2_*` values in `.env.local` and Vercel, then:
  ```
  node scripts/migrate-images-to-r2.cjs                      # dry run: counts and sizes
  node scripts/migrate-images-to-r2.cjs --copy               # copies to R2; the MongoDB bytes stay
  node scripts/migrate-images-to-r2.cjs --delete-from-mongo  # frees the space in MongoDB
  ```
  The bucket stays private: images are still served from `/api/uploads/…` and their addresses don't change.
- [ ] **A backup.** M0 has no automatic backups. Run `mongodump` (MongoDB Database Tools) before launch and keep the copy somewhere safe.

## 4. Sign-in (Clerk)

- [ ] Create the **production instance** in the Clerk dashboard (cloning the development settings), give it your domain, add the DNS records it lists and wait until all of them verify.
- [ ] **Google sign-in** needs your own Google OAuth app in production. In Google Cloud Console: set up the OAuth consent screen (app name, home page, privacy policy link), create an OAuth client ID of type *Web application* with the redirect URI Clerk shows, and paste the client ID and secret into Clerk → SSO connections → Google. Publish the consent screen ("In production"), or only listed test users can sign in.
- [ ] In Vercel: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_live_…`), `CLERK_SECRET_KEY` (`sk_live_…`) and `LEGACY_DATA_OWNER_EMAIL`, the email you'll sign in with. On that account's first sign-in it takes over everything made before sign-in existed, once. The email has to be verified (signing in with Google counts).
- [ ] Accounts don't carry over from development: everyone, you included, signs up again.

## 5. Payments (Stripe)

- [ ] **Activate the account** (Dashboard → Activate payments): business or individual details, ID, a bank account for payouts, the business name and support email customers see, and the website, which Stripe reviews (step 2).
- [ ] **Create the plans in live mode** from a terminal you close afterwards, so the live key doesn't stay around:
  ```powershell
  $env:STRIPE_SECRET_KEY="sk_live_…"; $env:NEXT_PUBLIC_BASE_URL="https://your-domain.com"; node scripts/stripe-setup.cjs --live
  ```
  It creates the products, prices, the `NEWSLETTER20` coupon and the Billing Portal settings (returning to your domain). Run it again whenever `lib/billing/plans.ts` changes.
- [ ] **The webhook**, in live mode: Developers → Webhooks → Add destination → events from your account, Snapshot payload, URL `https://your-domain.com/api/stripe/webhook`, and only these events:
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.
- [ ] In Vercel's **Production** environment: `STRIPE_SECRET_KEY` (`sk_live_…`) and `STRIPE_WEBHOOK_SECRET`, the `whsec_…` of that endpoint. Give **Preview** the test key, so preview deployments never charge real cards.

## 6. Email (Resend)

- [ ] Add your domain in Resend, add the DNS records it shows and wait for *Verified*. Until then Resend only sends to your own address.
- [ ] Add a DMARC record: TXT `_dmarc` with `v=DMARC1; p=none;`. Gmail expects one, and without it reminders land in spam more often.
- [ ] `RESEND_API_KEY`; `EMAIL_FROM`, any address on the verified domain (no mailbox needed), e.g. `Batkle <reminders@your-domain.com>`; `NEXT_PUBLIC_CONTACT_EMAIL`, a real inbox that the "Contact us" and footer links open.
- [ ] Replies to reminder emails go to the `EMAIL_FROM` address, which has no inbox. Forward the domain's mail to an inbox you read (e.g. Cloudflare Email Routing or ImprovMX, with a catch-all), so those replies and the contact address reach you.

## 7. Text reminders (Twilio): later

Not needed for launch. Text reminders show as "Coming soon" on the pricing page and in the app, the onboarding doesn't ask for a phone number, and no texts are sent; email reminders work as usual. To launch them, do the steps below, then take `'textReminders'` out of `COMING_SOON` in `lib/billing/plans.ts` (Pro shows 30 texts a month again, Business 100, the trial 5).

- [ ] Upgrade from the trial account: trial accounts only text numbers you verified, and prefix every message.
- [ ] Register before texting US numbers: A2P 10DLC, or a verified toll-free number. Carriers block unregistered traffic. It asks for the business, sample messages, how people opt in and the privacy policy link, and takes days to weeks. Under Messaging → Geo permissions, allow only the countries you serve.
- [ ] Create a Messaging Service with your number, and a Verify service (phone number codes). Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_FROM_NUMBER`) and `TWILIO_VERIFY_SERVICE_SID`.

## 8. The reminders job

`/api/cron/reminders` sends the reminders that are due and settles the credits of posts left half-made. Something has to call it every 5 minutes with `Authorization: Bearer <CRON_SECRET>`; without `CRON_SECRET` it refuses to run.

- [ ] `CRON_SECRET` in Vercel: a long random value, e.g. from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- [ ] On Vercel Pro, add `vercel.json` at the project root. Vercel sends the header itself:
  ```json
  { "crons": [{ "path": "/api/cron/reminders", "schedule": "*/5 * * * *" }] }
  ```
  On Hobby that schedule fails the deployment; use an outside scheduler such as cron-job.org calling `GET https://your-domain.com/api/cron/reminders` with the header.

## 9. The other environment variables

Vercel → Settings → Environment Variables, for Production. `NEXT_PUBLIC_*` values are built into the pages, so redeploy after changing one.

| Variable | Value | Needed for |
|---|---|---|
| `MONGO_URL` | the Atlas connection string, new password | everything |
| `DB_NAME` | the production database | everything |
| `NEXT_PUBLIC_BASE_URL` | `https://your-domain.com`, never localhost | links in emails, texts and Stripe |
| `GROQ_API_KEY` | | ideas, copy and designs |
| `GROQ_API_KEY_2` | a second Groq key | optional: used when the first hits its rate limit |
| `OPENAI_API_KEY` | | the paid plans' high-quality images; without it they fall back to fal/Pollinations |
| `FAL_KEY`, `POLLINATIONS_API_KEY` | at least one | Free plan images, and the fallback |
| `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY` | at least one | stock photos |
| `GLOBAL_DESIGN_ADMIN_KEY` | a long random value | Design Library admin sign-in |
| `DEVELOPER_FREE_CREDITS` | | optional: developer API starter credits (100) |
| `CORS_ORIGINS` | leave empty | |

Plus Clerk (step 4), Stripe (5), Resend (6), R2 (3) and `CRON_SECRET` (8). Leave the `TWILIO_*` values empty until texts launch (7).

## 10. Before pushing

- [ ] `node --test "tests/*.test.cjs"`: all pass (761 on 15 October).
- [ ] `npm run build` succeeds locally (it needs the Clerk keys).
- [ ] Review `git status` (many uncommitted changes, some deleted files), commit, and push to `main`, which Vercel deploys.

## 11. After the first deploy

- [ ] Sign up with a new email, and with Google; finish onboarding.
- [ ] Sign in as `LEGACY_DATA_OWNER_EMAIL`: the old brands appear and Vercel's logs show `[auth] … took over N brands, …`.
- [ ] Create a brand and a post; the images load (from R2).
- [ ] Buy Pro with a real card: the plan changes in Settings and Stripe shows the webhook answered 200. Then cancel in the Billing Portal and refund in Stripe (Stripe keeps its fee).
- [ ] Schedule a post a few minutes ahead: the reminder email arrives, and Vercel → Cron Jobs shows the runs.
- [ ] For the first days, watch the function logs for timeouts on long generations and for `[billing]` errors.

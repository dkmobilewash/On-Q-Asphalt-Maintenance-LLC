# On Q Asphalt Maintenance LLC — website

Static marketing site for On Q Asphalt Maintenance LLC (Rio Rancho, NM): asphalt crack filling & sealing,
sealcoating, driveway and parking lot repair, resurfacing, striping and HOA/private road maintenance.
Built on the same zero-dependency architecture as the Soft Water Albuquerque site.

All messaging comes from the company's real Google reviews, which are shown word for word from
`src/data/reviews.json`.

## Pages
| URL | Source |
|---|---|
| `/` | `src/pages/index.html` — hero + quote form, trust strip, problem cards, residential/commercial split, 3 maintenance levels, comparison table, 3 steps, local climate, reviews, service areas, FAQ |
| `/residential/`, `/commercial/` | Hub pages for homeowners vs. businesses / HOAs |
| `/crack-filling-sealing/`, `/sealcoating/`, `/driveway-repair/`, `/driveway-sealing/`, `/asphalt-resurfacing/`, `/parking-lot-repair/`, `/parking-lot-striping/`, `/hoa-private-roads/`, `/bad-contractor-repair/` | One page per service (each has `Service` schema + matching reviews) |
| `/maintenance-plans/` | 3 maintenance levels + comparison table (no prices — free quote buttons) |
| `/free-quote/` | Quote form |
| `/reviews/` | All 16 Google reviews in full, with owner responses |
| `/our-work/` | Before/after gallery (placeholder cards until photos arrive) |
| `/service-areas/` | Sandoval, Bernalillo, Valencia & Torrance Counties, each town with an `#id` anchor |
| `/about/`, `/military-discount/`, `/faq/` (FAQPage schema), `/contact/`, `/thank-you/` (noindex) | |

## Editing
- **Business info:** `site.config.json`. Keys listed in `_placeholders` (email, domain, hours, license, year founded, Facebook URL, Google review link) are not real yet.
- **Reviews:** `src/data/reviews.json`. Never edit `text` or `reply` — they're verbatim from Google. Short excerpts live in `excerpts` and must be exact substrings of the review (the build fails otherwise); the site joins them with "…".
- **Shared pieces:** `src/partials/` — `layout`, `header`, `footer`, `cta`, `packages` (maintenance levels), `quote-form`, `logo`, `stripe`, `reviews-google`.
- **Page content:** `src/pages/*.html`. The comment at the top sets `title`, `description`, and optionally `crumb`, `parent` (breadcrumb), `service` (adds Service schema), `faq: true` (FAQPage schema from the `<details>` on the page), `robots`, `sitemap: false`.
- **Logo:** `brand/logo-original.webp` is the original artwork. The site uses `assets/img/logo-mark.svg` (a vector trace of it, also the favicon), plus `logo.png` (512px, for schema and social sharing) and `apple-touch-icon.png`.
- **Styles:** `assets/css/styles.css`. Colors are CSS variables at the top.

### Markers you can use in pages
| Marker | Renders |
|---|---|
| `<!-- @cta -->`, `<!-- @packages -->`, `<!-- @quote-form -->` … | Any partial in `src/partials/` by file name |
| `<!-- @reviews:michael-hogue,jamie -->` | Grid of review excerpts (`id#key` picks a named excerpt) |
| `<!-- @review-full:dru-tagliapietra -->` | One complete review with chips and owner response |
| `<!-- @reviews-all -->` | Every review in full |
| `<!-- @quote:matthew-soto#hero -->` | A short pull quote |

### Things to confirm
Owner-facing notes are HTML comments in `src/` and are stripped from the built site:
```bash
grep -rn "CONFIRM\|PLACEHOLDER" src site.config.json
```
`CONFIRM` = stated in a review but not yet confirmed by the owner (military discount, free quotes,
references/photos on request, scheduling around business hours, follow-up after the job, service areas).

## Build, check & preview
```bash
npm run build     # outputs dist/
npm run check     # build + verify every review matches reviews.json + test the lead API
npm start         # build + serve at http://localhost:3000
```
No dependencies.

## Deploying on Vercel
1. Import this repo in Vercel. `vercel.json` already sets the build command (`node build.js`) and output folder (`dist`).
   Don't add `trailingSlash` — it redirects POSTs to `/api/lead`.
2. Form submissions go to the serverless function `api/lead.js`, which emails each lead through [Resend](https://resend.com).
   In **Project → Settings → Environment Variables** (Production), add:

   | Variable | Example |
   |---|---|
   | `RESEND_API_KEY` | `re_xxxxxxxx` (from Resend → API Keys) |
   | `LEAD_TO_EMAIL` | `vincent@onqasphalt.com` (comma-separate for several) |
   | `LEAD_FROM_EMAIL` | `On Q Asphalt Website <leads@onqasphalt.com>` (the domain must be verified in Resend) |

3. Redeploy after adding the variables. Until they're set, the form shows a "please call us" error instead of silently losing leads.
4. In Resend, verify the sending domain, then add a DMARC TXT record at your DNS host:
   name `_dmarc`, value `v=DMARC1; p=none;` — this keeps Gmail from spam-foldering the leads.
5. Test: open `/api/lead?check` (shows which settings are present, never their values), then
   `/api/lead?check&send=<your LEAD_TO_EMAIL address>` to send a test email. `send=` only works with an address in `LEAD_TO_EMAIL`.

Spam protection is a hidden `company` honeypot field; name and phone are required.

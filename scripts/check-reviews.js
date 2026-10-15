// Verifies that every review shown on the built site matches src/data/reviews.json
// character for character. Run after `node build.js`:  node scripts/check-reviews.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const { reviews } = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/reviews.json'), 'utf8'));
const byId = Object.fromEntries(reviews.map((r) => [r.id, r]));

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
let checked = 0;

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'assets' ? [] : htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

const fullOnReviewsPage = new Map();

for (const file of htmlFiles(DIST)) {
  const rel = path.relative(DIST, file);
  const html = fs.readFileSync(file, 'utf8');

  // Each rendered review (card or pull quote) carries data-review-id / data-review-mode.
  const re = /<(figure|blockquote) [^>]*data-review-id="([^"]+)" data-review-mode="(full|excerpt)"[^>]*>([\s\S]*?)<\/\1>/g;
  for (const [, tag, id, mode, inner] of html.matchAll(re)) {
    checked++;
    const where = `${rel} [${id}/${mode}]`;
    const review = byId[id];
    if (!review) { fail(where, 'unknown review id'); continue; }

    const textM = inner.match(/<p class="review__text">([\s\S]*?)<\/p>/);
    const nameM = inner.match(/class="review__name">([\s\S]*?)<\//);
    if (!textM) { fail(where, 'no review text'); continue; }
    const shown = decode(textM[1]);
    if (!nameM || decode(nameM[1]) !== review.name) fail(where, `name mismatch: ${nameM && decode(nameM[1])}`);
    if (!/Google review/.test(inner)) fail(where, 'missing "Google review" label');

    if (mode === 'full') {
      if (shown !== review.text) {
        const i = [...shown].findIndex((c, k) => c !== [...review.text][k]);
        fail(where, `full text differs at char ${i}: "${shown.slice(i, i + 40)}" vs "${review.text.slice(i, i + 40)}"`);
      }
      const replyM = inner.match(/<p class="review__reply-text">([\s\S]*?)<\/p>/);
      if (review.reply) {
        if (!replyM || decode(replyM[1]) !== review.reply) fail(where, 'owner reply missing or different');
        if (!/Response from On Q Asphalt/.test(inner)) fail(where, 'reply label missing');
      } else if (replyM) fail(where, 'shows a reply that should not be there');
      for (const t of [...(review.tags || []), ...(review.positive || []), ...(review.services || [])]) {
        if (!inner.includes(`<span class="chip">${t.replace(/&/g, '&amp;')}</span>`)) fail(where, `missing chip "${t}"`);
      }
      if (rel === path.join('reviews', 'index.html')) fullOnReviewsPage.set(id, (fullOnReviewsPage.get(id) || 0) + 1);
    } else {
      // Excerpts may only be trimmed with "…": every remaining piece must appear, in order, in the original.
      const pieces = shown.split('…').map((s) => s.trim()).filter(Boolean);
      let pos = 0;
      for (const piece of pieces) {
        const at = review.text.indexOf(piece, pos);
        if (at < 0) { fail(where, `excerpt piece not word for word: "${piece}"`); break; }
        pos = at + piece.length;
      }
      if (shown !== review.text && !shown.includes('…')) fail(where, 'shortened without "…"');
    }
  }

  if (/AggregateRating|"@type":\s*"Review"/.test(html)) fail(rel, 'contains Review/AggregateRating schema');
}

// The Reviews page shows every review in full, once.
for (const r of reviews) {
  const n = fullOnReviewsPage.get(r.id) || 0;
  if (n !== 1) fail('reviews/index.html', `${r.id} shown in full ${n} times (expected 1)`);
}
const george = fs.readFileSync(path.join(DIST, 'reviews/index.html'), 'utf8');
if (/Harold/.test(george)) fail('reviews/index.html', 'the omitted reply to George Gagliarti USMC appears');
if (reviews.length !== 16) fail('reviews.json', `expected 16 reviews, found ${reviews.length}`);

if (errors.length) {
  console.error(`✘ ${errors.length} review problem(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`✔ ${checked} rendered reviews match reviews.json character for character (${reviews.length} reviews, all on /reviews/ in full).`);

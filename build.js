// Zero-dependency static site builder.
// Reads src/pages/*.html, wraps each in src/partials/layout.html, fills {{tokens}}
// from site.config.json, renders reviews from src/data/reviews.json, and writes
// clean URLs to dist/ (e.g. dist/about/index.html).
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const { reviews } = JSON.parse(fs.readFileSync(path.join(SRC, 'data/reviews.json'), 'utf8'));
const reviewById = Object.fromEntries(reviews.map((r) => [r.id, r]));

// Every file in src/partials/ can be pulled into a page with <!-- @file-name -->
const partials = Object.fromEntries(
  fs.readdirSync(path.join(SRC, 'partials'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), fs.readFileSync(path.join(SRC, 'partials', f), 'utf8')])
);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const decodeHtml = (s) =>
  s.replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&rsquo;/g, '’').replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const stripTags = (s) => decodeHtml(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// {{name}}, {{price.x}}, {{year}} ...
function fill(str, vars) {
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    return val == null ? m : String(val);
  });
}

// Page front matter lives in a leading HTML comment: <!-- title: ... \n description: ... -->
function parsePage(raw) {
  const meta = {};
  const m = raw.match(/^<!--([\s\S]*?)-->\s*/);
  if (m) {
    m[1].split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    raw = raw.slice(m[0].length);
  }
  return { meta, body: raw };
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

/* ---------------- Reviews ---------------- */

// Excerpts are trimmed only with "…": every segment must be an exact substring of the review.
function excerptText(review, key) {
  const segs = review.excerpts && review.excerpts[key || 'default'];
  if (!segs) {
    if (key) throw new Error(`Review "${review.id}" has no excerpt "${key}"`);
    return { text: review.text, trimmed: false };
  }
  segs.forEach((s) => {
    if (!review.text.includes(s)) throw new Error(`Excerpt for "${review.id}" is not word for word: ${s}`);
  });
  let out = segs.join(' … ');
  if (!review.text.startsWith(segs[0])) out = '…' + out;
  if (!review.text.endsWith(segs[segs.length - 1])) out += '…';
  return { text: out, trimmed: true };
}

function chips(review) {
  const group = (label, items) =>
    items && items.length
      ? `<div class="chips">${label ? `<span class="chips__label">${label}</span>` : ''}${items
          .map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
  return group('', review.tags) + group('Positive', review.positive) + group('Services', review.services);
}

function reviewCard(review, { full = false, key } = {}) {
  const { text, trimmed } = full ? { text: review.text, trimmed: false } : excerptText(review, key);
  const id = full ? ` id="${review.id}"` : '';
  return `<figure class="review${full ? ' review--full' : ''}"${id} data-review-id="${review.id}" data-review-mode="${full ? 'full' : 'excerpt'}">
  <blockquote class="review__quote"><p class="review__text">${escapeHtml(text)}</p></blockquote>
  <figcaption class="review__by"><strong class="review__name">${escapeHtml(review.name)}</strong><span class="review__source">Google review</span></figcaption>
  ${full ? chips(review) : ''}
  ${full && review.reply ? `<div class="review__reply"><span class="review__reply-label">Response from On Q Asphalt</span><p class="review__reply-text">${escapeHtml(review.reply)}</p></div>` : ''}
  ${trimmed ? `<a class="review__more" href="/reviews/#${review.id}">Read the full review</a>` : ''}
</figure>`;
}

function renderReviews(html) {
  // <!-- @reviews:id,id#excerptKey --> → grid of excerpt cards
  html = html.replace(/<!--\s*@reviews:([\w#,\s-]+?)\s*-->/g, (m, list) => {
    const items = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [id, key] = s.split('#');
      if (!reviewById[id]) throw new Error(`Unknown review id "${id}"`);
      return reviewCard(reviewById[id], { key });
    });
    const cols = items.length >= 3 ? 'grid--3' : items.length === 2 ? 'grid--2' : 'grid--1';
    return `<div class="grid ${cols} reviews-grid">\n${items.join('\n')}\n</div>`;
  });
  // <!-- @quote:id#excerptKey --> → short pull quote (hero, callouts)
  html = html.replace(/<!--\s*@quote:([\w-]+)(?:#([\w-]+))?\s*-->/g, (m, id, key) => {
    const review = reviewById[id];
    if (!review) throw new Error(`Unknown review id "${id}"`);
    const { text } = excerptText(review, key);
    return `<blockquote class="pull-quote" data-review-id="${id}" data-review-mode="excerpt"><p class="review__text">${escapeHtml(text)}</p><cite>&mdash; <span class="review__name">${escapeHtml(review.name)}</span>, Google review</cite></blockquote>`;
  });
  // <!-- @review-full:id --> → one complete review with chips and owner reply
  html = html.replace(/<!--\s*@review-full:([\w-]+)\s*-->/g, (m, id) => {
    if (!reviewById[id]) throw new Error(`Unknown review id "${id}"`);
    return reviewCard(reviewById[id], { full: true });
  });
  // <!-- @reviews-all --> → every review, full text
  html = html.replace(/<!--\s*@reviews-all\s*-->/g, () =>
    `<div class="reviews-wall">\n${reviews.map((r) => reviewCard(r, { full: true })).join('\n')}\n</div>`);
  return html;
}

/* ---------------- Schema (JSON-LD) ---------------- */

const base = config.domain.replace(/\/$/, '');
const isPlaceholder = (v) => /PLACEHOLDER/i.test(String(v));
const jsonLd = (obj) =>
  `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2).replace(/</g, '\\u003c')}\n</script>`;

const postalAddress = {
  '@type': 'PostalAddress',
  streetAddress: config.address,
  addressLocality: config.city,
  addressRegion: config.state,
  postalCode: config.zip,
  addressCountry: 'US',
};
const areaServed = config.areaServed.map((name) => ({ '@type': 'City', name: `${name}, NM` }));

const business = {
  '@context': 'https://schema.org',
  '@type': 'HomeAndConstructionBusiness',
  '@id': `${base}/#business`,
  name: config.name,
  alternateName: config.shortName,
  slogan: config.tagline,
  telephone: config.phoneHref,
  email: config.email,
  url: `${base}/`,
  logo: `${base}/assets/img/logo.png`,
  image: `${base}/assets/img/logo.png`,
  address: postalAddress,
  founder: { '@type': 'Person', name: config.owner },
  areaServed,
  ...(isPlaceholder(config.facebookUrl) ? {} : { sameAs: [config.facebookUrl] }),
};

function pageSchemas(meta, url, content, vars) {
  const out = [business];
  if (url !== '/') {
    const crumbs = [{ name: 'Home', url: '/' }];
    if (meta.parent) {
      const [name, href] = meta.parent.split('|').map((s) => s.trim());
      crumbs.push({ name, url: href });
    }
    crumbs.push({ name: fill(meta.crumb || (meta.title || '').split('|')[0].trim(), vars), url });
    out.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: base + c.url })),
    });
  }
  if (meta.service) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: meta.service,
      serviceType: meta.service,
      description: fill(meta.description || '', vars),
      url: base + url,
      provider: { '@id': `${base}/#business`, '@type': 'HomeAndConstructionBusiness', name: config.name, telephone: config.phoneHref, address: postalAddress },
      areaServed,
    });
  }
  if (meta.faq === 'true') {
    const qa = [...content.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)];
    out.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: qa.map(([, q, a]) => ({
        '@type': 'Question',
        name: stripTags(fill(q, vars)),
        acceptedAnswer: { '@type': 'Answer', text: stripTags(fill(a, vars)) },
      })),
    });
  }
  return out.map(jsonLd).join('\n  ');
}

/* ---------------- Build ---------------- */

fs.rmSync(DIST, { recursive: true, force: true });
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

const vars = { ...config, year: new Date().getFullYear() };
const pagesDir = path.join(SRC, 'pages');
const urls = [];

function includePartials(str, depth = 0) {
  return str.replace(/<!--\s*@([\w-]+)\s*-->/g, (m, name) => {
    if (name === 'reviews-all') return m;
    if (!(name in partials)) throw new Error(`Unknown partial <!-- @${name} -->`);
    return depth < 4 ? includePartials(partials[name], depth + 1) : partials[name];
  });
}

for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()) {
  const slug = file.replace(/\.html$/, '');
  const url = slug === 'index' ? '/' : `/${slug}/`;
  const { meta, body } = parsePage(fs.readFileSync(path.join(pagesDir, file), 'utf8'));

  const content = renderReviews(includePartials(body));

  // Mark the current nav link
  const header = includePartials(partials.header).replace(
    new RegExp(`href="${url.replace(/\//g, '\\/')}"`, 'g'),
    `href="${url}" aria-current="page"`
  );

  let html = partials.layout
    .replace('{{> header}}', header)
    .replace('{{> footer}}', includePartials(partials.footer))
    .replace('{{> content}}', content)
    .replace('{{> schema}}', pageSchemas(meta, url, content, vars));

  html = fill(html, {
    ...vars,
    pageTitle: escapeHtml(fill(meta.title || config.name, vars)),
    pageDescription: escapeHtml(fill(meta.description || config.tagline, vars)),
    canonical: base + url,
    robots: meta.robots || 'index, follow',
  });

  // Owner-facing notes (<!-- CONFIRM ... -->, <!-- PLACEHOLDER ... -->) stay in src/ only.
  html = html.replace(/[ \t]*<!--\s*(CONFIRM|PLACEHOLDER)[\s\S]*?-->\n?/g, '');

  const leftover = html.match(/\{\{[^}]*\}\}|<!--\s*@[\w-]/);
  if (leftover) throw new Error(`${file}: unresolved token ${leftover[0]}`);

  const outDir = slug === 'index' ? DIST : path.join(DIST, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  if (meta.sitemap !== 'false') urls.push(url);
}

// sitemap + robots
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${base}${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`
);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);

console.log(`Built ${fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).length} pages → dist/ (${urls.length} in sitemap)`);

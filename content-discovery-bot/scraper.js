const axios = require('axios');
const cheerio = require('cheerio');

// ─── Retry Helper ─────────────────────────────────────────────────────────────
async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        maxRedirects: 5,
      });
      return response;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, delay * attempt));
    }
  }
}

// ─── Clean Text Helper ────────────────────────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

// ─── Main Scraper ─────────────────────────────────────────────────────────────
async function scrapeWebsite(url) {
  const response = await fetchWithRetry(url);
  const $ = cheerio.load(response.data);

  // Remove noise
  $('script, style, nav, footer, header, noscript, iframe, svg').remove();

  const parts = [];

  // Meta description
  const metaDesc =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  if (metaDesc) parts.push(`Meta: ${cleanText(metaDesc)}`);

  // Page title
  const title = $('title').text();
  if (title) parts.push(`Title: ${cleanText(title)}`);

  // OG title
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  if (ogTitle) parts.push(`OG Title: ${cleanText(ogTitle)}`);

  // Headings (h1–h3)
  $('h1, h2, h3').each((_, el) => {
    const text = cleanText($(el).text());
    if (text.length > 5 && text.length < 200) parts.push(text);
  });

  // Paragraphs
  $('p').each((_, el) => {
    const text = cleanText($(el).text());
    if (text.length > 30 && text.length < 600) parts.push(text);
  });

  // List items (often feature/benefit lists)
  $('li').each((_, el) => {
    const text = cleanText($(el).text());
    if (text.length > 15 && text.length < 200) parts.push(text);
  });

  // Deduplicate
  const unique = [...new Set(parts)];

  // Limit to ~3000 chars to avoid token overload
  let combined = '';
  for (const part of unique) {
    if ((combined + part).length > 3000) break;
    combined += part + '\n';
  }

  return combined.trim();
}

// ─── Engagement Scraper ───────────────────────────────────────────────────────
// Fetches the actual social media URL and tries to pull view/like counts from:
//   1. og:description  (TikTok reliably puts "123K views · 4.5K likes" here)
//   2. page <title>    (TikTok also embeds counts in the title)
//   3. JSON-LD VideoObject interactionStatistic
// Returns null silently on any error (login wall, rate-limit, network error).
async function scrapeEngagement(url) {
  try {
    const response = await fetchWithRetry(url, 2, 800);
    const html = response.data;
    const $ = cheerio.load(html);

    // ── 1. og:description (best source for TikTok & sometimes Instagram) ──
    const ogDesc =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    // ── 2. Page title ──
    const pageTitle = $('title').text() || '';

    const candidateText = `${ogDesc} ${pageTitle}`;

    const engagementPatterns = [
      // "1.2M views", "125K views", "1,234 views"
      /(\d[\d,.]*\.?\d*[KkMmBb]?)\s*views?/i,
      // "45.6K likes", "2.1M likes"
      /(\d[\d,.]*\.?\d*[KkMmBb]?)\s*likes?/i,
      // "3.2M plays"
      /(\d[\d,.]*\.?\d*[KkMmBb]?)\s*plays?/i,
      // "890K hearts"
      /(\d[\d,.]*\.?\d*[KkMmBb]?)\s*hearts?/i,
    ];

    for (const pattern of engagementPatterns) {
      const match = candidateText.match(pattern);
      if (match) {
        // Return e.g. "1.2M views"
        return `${match[1]} ${match[0].replace(match[1], '').trim()}`;
      }
    }

    // ── 3. JSON-LD VideoObject interactionStatistic ──
    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      try {
        const data = JSON.parse($(scripts[i]).html());
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const stats = item?.interactionStatistic || [];
          for (const stat of stats) {
            const count = stat?.userInteractionCount;
            const type = stat?.interactionType || '';
            if (count && (type.includes('Watch') || type.includes('View'))) {
              return `${count} views`;
            }
          }
        }
      } catch (_) {
        // malformed JSON — skip
      }
    }

    return null;
  } catch (_) {
    // Page blocked (login wall, 403, timeout, etc.) — silently return null
    return null;
  }
}

module.exports = { scrapeWebsite, scrapeEngagement };

const axios = require('axios');
const { scrapeEngagement } = require('./scraper');

const SERP_API_URL = 'https://serpapi.com/search.json';

// ─── Platform Detection ───────────────────────────────────────────────────────
function detectPlatform(link) {
  if (link.includes('tiktok.com')) return 'TikTok';
  if (link.includes('instagram.com')) return 'Instagram';
  if (link.includes('facebook.com') || link.includes('fb.com')) return 'Facebook';
  return 'Unknown';
}

// ─── Format Detection via Keyword Heuristics ─────────────────────────────────
const FORMAT_KEYWORDS = {
  Slideshow: ['slideshow', 'slides', 'swipe', 'carousel', 'part 1', 'part 2', 'gallery'],
  'Text-on-Screen': ['text on screen', 'text over', 'words on', 'caption', 'subtitles', 'on screen text'],
  Meme: ['meme', 'funny', 'lol', 'relatable', 'when you', 'pov:', 'nobody:', 'me when'],
  Animation: ['animation', 'animated', 'motion graphic', 'cartoon', 'explainer'],
  'Screen Recording': [
    'screen recording',
    'screen record',
    'screencast',
    'tutorial',
    'how to',
    'step by step',
    'walkthrough',
    'demo',
  ],
};

const REJECT_KEYWORDS = [
  'talking head',
  'talking to camera',
  'face cam',
  'vlog',
  'cinematic',
  'b-roll',
  'drone footage',
  'professional video',
  'high quality production',
  'watermark',
  'copyright',
  'studio',
  'film',
];

function detectFormat(title = '', snippet = '') {
  const text = `${title} ${snippet}`.toLowerCase();

  for (const kw of REJECT_KEYWORDS) {
    if (text.includes(kw)) return null;
  }

  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return format;
    }
  }

  return 'Text-on-Screen';
}

// ─── Parse Engagement ─────────────────────────────────────────────────────────
// Accepts a full result object so we can check structured video fields first,
// then fall back to snippet regex for organic results.
function parseEngagement(result = {}) {
  // 1. Direct structured fields from video search results (tbm=vid)
  if (result.views) return result.views;
  if (result.view_count) return `${result.view_count} views`;

  // 2. Snippet-based regex — use proper decimal pattern to avoid "51." bug
  const snippet = result.snippet || '';
  const num = '(\\d[\\d,]*(?:\\.\\d+)?[KkMmBb]?)';
  const patterns = [
    new RegExp(`${num}\\s*(likes?|views?|hearts?|reactions?)`, 'i'),
    new RegExp(`${num}\\s*💕`),
    new RegExp(`${num}\\s*❤`),
  ];
  for (const pattern of patterns) {
    const match = snippet.match(pattern);
    if (match) {
      const label = (match[2] || '').trim();
      return label ? `${match[1]} ${label}` : match[1];
    }
  }

  return null;
}

// ─── Extract cross-niche search keywords from an angle ────────────────────────
// Fix #2: Strips stopwords so the emotional hook finds content from ANY niche,
// not just the website's own niche (e.g. crypto → also fitness, coaching, etc.)
function buildSearchKeywords(angle) {
  const STOPWORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','are','was','were','be','been','that','this','your','our','their',
    'my','we','you','it','its','can','will','how','what','why','when','who','not',
    'no','do','did','does','has','have','had','get','up','out','all','any','now',
    'just','even','more','most','than','then','also','very','too','so','as','if',
  ]);
  const words = angle
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return words.slice(0, 4).join(' ');
}

// ─── Validate that a link is a direct post/video, not a search page ───────────
// Fix #3: Rejects Facebook watch/search URLs — only allows real post/reel links.
function isValidPostLink(link) {
  if (link.includes('/search/') || link.includes('/search?')) return false;

  if (link.includes('facebook.com') || link.includes('fb.com')) {
    const isBadFBUrl =
      /facebook\.com\/watch\/?$/.test(link) ||
      /facebook\.com\/watch\?(?!v=\d)/.test(link) ||
      link.includes('/watch/search') ||
      (link.includes('?q=') && !link.includes('/reel/') && !link.includes('/video/'));
    if (isBadFBUrl) return false;

    return (
      /facebook\.com\/reel\/\d+/.test(link) ||
      /facebook\.com\/video\/\d+/.test(link) ||
      /facebook\.com\/[^/?]+\/videos?\/\d+/.test(link) ||
      /facebook\.com\/watch\/\?v=\d+/.test(link)
    );
  }

  return true; // TikTok and Instagram links are always direct post URLs
}

// ─── Enforce angle diversity in final results ─────────────────────────────────
// Fix #4: Round-robins across angles so no single angle dominates the top 10.
function diversifyByAngle(results, maxPerAngle = 2) {
  const buckets = new Map();
  for (const r of results) {
    if (!buckets.has(r.angle)) buckets.set(r.angle, []);
    buckets.get(r.angle).push(r);
  }

  const diverse = [];
  const keys = [...buckets.keys()];
  for (let slot = 0; slot < maxPerAngle && diverse.length < 15; slot++) {
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (slot < bucket.length) diverse.push(bucket[slot]);
    }
  }
  return diverse;
}

// ─── Build Queries ────────────────────────────────────────────────────────────
// Fix #2: Uses KEYWORD-BASED queries (no quoted angle text) so results come
// from any niche — fitness, coaching, lifestyle, etc. — not just the source site.
function buildQueries(angles) {
  // Use ALL 6 angles (one per emotional category from the AI prompt)
  const topAngles = angles.slice(0, 6);
  const videoQueries = [];
  const organicQueries = [];

  const platforms = [
    { site: 'site:tiktok.com', label: 'tiktok' },
    { site: 'site:instagram.com', label: 'instagram' },
    { site: 'site:facebook.com/reel OR site:facebook.com/video', label: 'facebook' },
  ];

  // Each angle gets its own video + organic query on a different platform
  topAngles.forEach((angle, i) => {
    const keywords = buildSearchKeywords(angle);
    const platform = platforms[i % platforms.length];
    videoQueries.push({ query: `${platform.site} ${keywords}`, angle, platform: platform.label, mode: 'video' });
    organicQueries.push({ query: `${platform.site} ${keywords}`, angle, platform: platform.label, mode: 'organic' });
  });

  return { videoQueries, organicQueries };
}

// ─── Fetch One Query via SerpAPI ──────────────────────────────────────────────
async function fetchQuery({ query, angle, mode }, retries = 2, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const params = {
        q: query,
        api_key: process.env.SERP_API_KEY,
        num: 8,   // Fetch more candidates per query for better pool
        hl: 'en',
        gl: 'us',
      };


      // Video search mode: returns structured view counts
      if (mode === 'video') params.tbm = 'vid';

      const response = await axios.get(SERP_API_URL, { params, timeout: 15000 });

      // Video search returns video_results; organic returns organic_results
      const items =
        response.data?.video_results ||
        response.data?.organic_results ||
        [];

      return items
        .map((r) => {
          const link = r.link || '';
          const title = r.title || '';
          const snippet = r.snippet || '';
          const platform = detectPlatform(link);

          if (platform === 'Unknown') return null;

          // Fix #3: Reject Facebook search/index URLs — only allow direct post links
          if (!isValidPostLink(link)) return null;

          const format = detectFormat(title, snippet);
          if (!format) return null;

          return {
            link,
            platform,
            engagement: parseEngagement(r),   // pass full object
            format,
            angle,
          };
        })
        .filter(Boolean);
    } catch (err) {
      if (attempt === retries) {
        console.error(`SerpAPI error [${mode}] for "${query}":`, err.message);
        return [];
      }
      await new Promise((res) => setTimeout(res, delay * attempt));
    }
  }
  return [];
}

// ─── Main Search Orchestrator ─────────────────────────────────────────────────
async function searchContent(angles) {
  const { videoQueries, organicQueries } = buildQueries(angles);
  const allResults = [];
  const seenLinks = new Set();

  const addResults = (results) => {
    for (const result of results) {
      if (!seenLinks.has(result.link)) {
        seenLinks.add(result.link);
        allResults.push(result);
      }
    }
  };

  // Helper to test how many diverse results we currently have
  const getCurrentDiverseCount = () => {
    const uniqueAngles = new Set(allResults.map((r) => r.angle)).size || 1;
    const maxPerAngle = Math.max(2, Math.ceil(10 / uniqueAngles));
    return diversifyByAngle(allResults, maxPerAngle).length;
  };

  // ── Phase 1: Video search (best engagement data) ──
  // Loop through ALL video queries for all angles so we don't skew to the first few.
  for (const queryObj of videoQueries) {
    const results = await fetchQuery(queryObj);
    addResults(results);
    await new Promise((res) => setTimeout(res, 500));
  }

  // ── Phase 2: Organic fallback if not enough diverse results ──
  if (getCurrentDiverseCount() < 10) {
    for (const queryObj of organicQueries) {
      if (getCurrentDiverseCount() >= 10) break;
      const results = await fetchQuery(queryObj);
      addResults(results);
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  // ── Phase 3: Scrape engagement directly from URLs (fills in N/A gaps) ──
  // Run in batches of 3 to avoid hammering platforms.
  // Wrapped in try/catch — a scrape failure must NEVER crash the bot.
  try {
    const needsEngagement = allResults.filter((r) => !r.engagement);
    const CONCURRENCY = 3;
    for (let i = 0; i < needsEngagement.length; i += CONCURRENCY) {
      const batch = needsEngagement.slice(i, i + CONCURRENCY);
      const scraped = await Promise.all(batch.map((r) => scrapeEngagement(r.link)));
      scraped.forEach((eng, idx) => {
        if (eng) batch[idx].engagement = eng;
      });
      if (i + CONCURRENCY < needsEngagement.length) {
        await new Promise((res) => setTimeout(res, 600));
      }
    }
  } catch (err) {
    console.warn('Engagement scrape phase failed (non-fatal):', err.message);
  }


  // Enforce angle diversity: prioritize 2 per angle, but allow more if we lack unique angles.
  const uniqueAngleCount = new Set(allResults.map((r) => r.angle)).size || 1;
  const maxPerAngleFinal = Math.max(2, Math.ceil(10 / uniqueAngleCount));
  const diverse = diversifyByAngle(allResults, maxPerAngleFinal);

  // Sort: results with real engagement data first
  diverse.sort((a, b) => (b.engagement ? 1 : 0) - (a.engagement ? 1 : 0));

  return diverse.slice(0, 10);
}

module.exports = { searchContent };

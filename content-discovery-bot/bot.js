require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { scrapeWebsite } = require('./scraper');
const { extractAngles } = require('./ai');
const { searchContent } = require('./search');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// ─── URL Validation ───────────────────────────────────────────────────────────
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── HTML escape for dynamic content ─────────────────────────────────────────
// Prevents special chars in angles/URLs/platform names from breaking HTML mode.
function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Format Results for Telegram (HTML mode) ──────────────────────────────────
function formatResults(results) {
  if (!results || results.length === 0) {
    return '❌ No replicable content found. Try another URL.';
  }

  const lines = ['✅ <b>Top 10 Replicable Content Pieces</b>\n'];

  results.slice(0, 10).forEach((item, i) => {
    lines.push(
      `<b>${i + 1}.</b> 🔗 ${item.link}\n` +
      `   📱 <b>Platform:</b> ${h(item.platform)}\n` +
      `   ❤️ <b>Engagement:</b> ${h(item.engagement || '📊 Not public')}\n` +
      `   🎬 <b>Format:</b> ${h(item.format)}\n` +
      `   🎯 <b>Angle:</b> ${h(item.angle)}\n`
    );
  });

  return lines.join('\n');
}

// ─── /start Command ───────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `👋 <b>Welcome to Content Discovery Bot!</b>\n\n` +
    `Send me any website URL and I'll find 10 high-performing, replicable content pieces from TikTok, Instagram, and Facebook.\n\n` +
    `📌 <b>Example:</b> https://example.com`,
    { parse_mode: 'HTML' }
  );
});

// ─── Handle URL Input ─────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || text.startsWith('/')) return;

  if (!isValidUrl(text)) {
    return bot.sendMessage(
      chatId,
      '⚠️ That doesn\'t look like a valid URL. Please send a full URL starting with http:// or https://',
      { parse_mode: 'HTML' }
    );
  }

  // Step 1: Loading message
  const loadingMsg = await bot.sendMessage(chatId, '🔍 <b>Scraping website...</b>', { parse_mode: 'HTML' });

  try {
    // Step 2: Scrape
    const siteContent = await scrapeWebsite(text);
    if (!siteContent || siteContent.length < 50) {
      return bot.editMessageText(
        '❌ Could not extract meaningful content from this URL. Try another one.',
        { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML' }
      );
    }

    // Step 3: Extract angles
    await bot.editMessageText('🤖 <b>Analyzing angles...</b>', {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'HTML',
    });

    const angles = await extractAngles(siteContent);
    if (!angles || angles.length === 0) {
      return bot.editMessageText(
        '❌ Could not extract marketing angles. Try another URL.',
        { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML' }
      );
    }

    // Step 4: Search content
    await bot.editMessageText('📡 <b>Searching for replicable content...</b>', {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'HTML',
    });

    const results = await searchContent(angles);

    // Step 5: Send results
    const formatted = formatResults(results);
    await bot.editMessageText(formatted, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

  } catch (err) {
    console.error('Bot error:', err.message);

    const status = err?.response?.status;
    let userMsg = h(err.message);

    if (status === 403) {
      userMsg = '⛔ <b>Website blocked access (403)</b>\n\nThis site uses bot-protection. Try a landing page or blog URL instead.';
    } else if (status === 404) {
      userMsg = '❌ <b>Page not found (404)</b>\n\nDouble-check the URL and try again.';
    } else if (status === 429) {
      userMsg = '⏳ <b>Rate limited</b>\n\nThe website is throttling requests. Wait a minute and try again.';
    } else if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      userMsg = '⌛ <b>Request timed out</b>\n\nThe website took too long to respond. Try a faster/simpler URL.';
    }

    await bot.editMessageText(userMsg, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'HTML',
    });
  }

});

console.log('🤖 Content Discovery Bot is running...');




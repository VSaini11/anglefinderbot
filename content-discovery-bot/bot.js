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

// ─── Format Results for Telegram ─────────────────────────────────────────────
function formatResults(results) {
  if (!results || results.length === 0) {
    return '❌ No replicable content found. Try another URL.';
  }

  const lines = ['✅ *Top 10 Replicable Content Pieces*\n'];

  results.slice(0, 10).forEach((item, i) => {
    lines.push(
      `*${i + 1}.* 🔗 ${item.link}\n` +
      `   📱 *Platform:* ${item.platform}\n` +
      `   ❤️ *Engagement:* ${item.engagement || '📊 Not public'}\n` +
      `   🎬 *Format:* ${item.format}\n` +
      `   🎯 *Angle:* ${item.angle}\n`
    );
  });


  return lines.join('\n');
}

// ─── /start Command ───────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `👋 *Welcome to Content Discovery Bot!*\n\n` +
    `Send me any website URL and I'll find 10 high-performing, replicable content pieces from TikTok, Instagram, and Facebook.\n\n` +
    `📌 *Example:* https://example.com`,
    { parse_mode: 'Markdown' }
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
      { parse_mode: 'Markdown' }
    );
  }

  // Step 1: Loading message
  const loadingMsg = await bot.sendMessage(chatId, '🔍 *Scraping website...*', { parse_mode: 'Markdown' });

  try {
    // Step 2: Scrape
    const siteContent = await scrapeWebsite(text);
    if (!siteContent || siteContent.length < 50) {
      return bot.editMessageText(
        '❌ Could not extract meaningful content from this URL. Try another one.',
        { chat_id: chatId, message_id: loadingMsg.message_id }
      );
    }

    // Step 3: Extract angles
    await bot.editMessageText('🤖 *Analyzing angles...*', {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
    });

    const angles = await extractAngles(siteContent);
    if (!angles || angles.length === 0) {
      return bot.editMessageText(
        '❌ Could not extract marketing angles. Try another URL.',
        { chat_id: chatId, message_id: loadingMsg.message_id }
      );
    }

    // Step 4: Search content
    await bot.editMessageText('📡 *Searching for replicable content...*', {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
    });

    const results = await searchContent(angles);

    // Step 5: Send results
    const formatted = formatResults(results);
    await bot.editMessageText(formatted, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

  } catch (err) {
    console.error('Bot error:', err.message);

    // If we threw a clean user-facing message ourselves, show it directly.
    // Otherwise map common HTTP errors to friendly text.
    const status = err?.response?.status;
    let userMsg = err.message;

    if (status === 403) {
      userMsg =
        '⛔ *Website blocked access (403)*\n\nThis site uses bot-protection. Try a landing page or blog URL instead.';
    } else if (status === 404) {
      userMsg = '❌ *Page not found (404)*\n\nDouble-check the URL and try again.';
    } else if (status === 429) {
      userMsg = '⏳ *Rate limited*\n\nThe website is throttling requests. Wait a minute and try again.';
    } else if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      userMsg = '⌛ *Request timed out*\n\nThe website took too long to respond. Try a faster/simpler URL.';
    }

    await bot.editMessageText(userMsg, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
    });
  }

});

console.log('🤖 Content Discovery Bot is running...');

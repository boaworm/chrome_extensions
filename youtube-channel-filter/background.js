const cache = new Map(); // channelUrl -> { count, timestamp }
const CACHE_TTL_MS = 60 * 60 * 1000;

function parseSubscriberCount(text) {
  if (!text) return null;
  const m = text.match(/([\d,.]+)\s*([KMBkmb]?)\s*subscriber/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') return Math.round(num * 1_000);
  if (suffix === 'M') return Math.round(num * 1_000_000);
  if (suffix === 'B') return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

// Find a subscriber string inside a header section. YouTube has used several shapes:
//   "subscriberCountText":{..."simpleText":"15.3M subscribers"}   (c4TabbedHeaderRenderer)
//   "metadataParts":[...{"text":{"content":"15.3M subscribers"}}]  (pageHeaderRenderer)
function findSubscriberTextInSection(section) {
  const patterns = [
    /"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/,
    /"subscriberCountText":\{"accessibility":\{"accessibilityData":\{"label":"[^"]*"\}\},"simpleText":"([^"]+)"/,
    /"content":"([^"]*?subscribers?)"/i,
  ];
  for (const re of patterns) {
    const m = section.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractCount(html) {
  // Only trust the channel's own header. Other "subscribers" strings on the page
  // belong to recommended/featured channels and must not be used.
  const headerKeys = ['"c4TabbedHeaderRenderer"', '"pageHeaderRenderer"'];
  for (const key of headerKeys) {
    let keyIdx = -1;
    while ((keyIdx = html.indexOf(key, keyIdx + 1)) !== -1) {
      const section = html.slice(keyIdx, keyIdx + 8000);
      const raw = findSubscriberTextInSection(section);
      if (!raw) continue;
      const count = parseSubscriberCount(raw);
      if (count !== null) {
        console.log(`[YCF bg] ${key} raw="${raw}" count=${count}`);
        return count;
      }
    }
  }
  console.warn('[YCF bg] no subscriber count found in channel header');
  return null;
}

async function fetchSubscriberCount(channelUrl) {
  const cached = cache.get(channelUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[YCF bg] cache hit ${channelUrl} → ${cached.count}`);
    return cached.count;
  }

  console.log(`[YCF bg] fetching ${channelUrl}`);
  try {
    const res = await fetch(channelUrl, { credentials: 'include' });
    console.log(`[YCF bg] fetch status ${res.status} for ${channelUrl}`);
    const html = await res.text();
    const count = extractCount(html);
    cache.set(channelUrl, { count, timestamp: Date.now() });
    return count;
  } catch (e) {
    console.error(`[YCF bg] fetch failed for ${channelUrl}`, e);
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_SUBSCRIBER_COUNT') {
    fetchSubscriberCount(msg.channelUrl).then(count => sendResponse({ count }));
    return true;
  }
});

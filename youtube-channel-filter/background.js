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

function extractCount(html) {
  const subPatterns = [
    /"subscriberCountText":\{"simpleText":"([^"]+)"\}/,
    /"subscriberCountText":\{"accessibility":[^}]+,"simpleText":"([^"]+)"\}/,
    /"subscriberCountText":\{"runs":\[\{"text":"([^"]+)"\}/,
  ];

  // Search within the channel header section to avoid matching recommended channels
  const headerKeys = ['"c4TabbedHeaderRenderer"', '"pageHeaderRenderer"', '"channelMetadataRenderer"'];
  for (const key of headerKeys) {
    const idx = html.indexOf(key);
    if (idx === -1) continue;
    const section = html.slice(idx, idx + 5000);
    for (const re of subPatterns) {
      const m = section.match(re);
      if (m) {
        const count = parseSubscriberCount(m[1]);
        if (count !== null) {
          console.log(`[YCF bg] ${key} raw="${m[1]}" count=${count}`);
          return count;
        }
      }
    }
  }

  // Fall back to the largest count found anywhere on the page
  const allCounts = [];
  for (const re of subPatterns) {
    for (const m of html.matchAll(new RegExp(re.source, 'g'))) {
      const count = parseSubscriberCount(m[1]);
      if (count !== null) allCounts.push(count);
    }
  }
  if (allCounts.length > 0) {
    const max = Math.max(...allCounts);
    console.log(`[YCF bg] all counts ${allCounts}, using max=${max}`);
    return max;
  }

  // Last resort: any "X subscribers" string in the page
  const fallback = html.match(/([\d,.]+[KMB]?) subscribers/i);
  if (fallback) {
    const count = parseSubscriberCount(fallback[0]);
    console.log(`[YCF bg] fallback raw="${fallback[0]}" count=${count}`);
    return count;
  }
  console.warn('[YCF bg] no subscriber count found in page HTML');
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

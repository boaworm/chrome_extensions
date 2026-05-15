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

function findSimpleTextNear(html, fromIndex) {
  // Look for "simpleText":"..." within 400 chars of fromIndex
  const slice = html.slice(fromIndex, fromIndex + 400);
  const m = slice.match(/"simpleText":"([^"]+)"/);
  return m ? m[1] : null;
}

function extractCount(html) {
  // Prefer the channel header sections to avoid picking up sidebar recommendations
  const headerKeys = ['"c4TabbedHeaderRenderer"', '"pageHeaderRenderer"', '"channelMetadataRenderer"'];
  for (const key of headerKeys) {
    const keyIdx = html.indexOf(key);
    if (keyIdx === -1) continue;
    const section = html.slice(keyIdx, keyIdx + 8000);
    const subIdx = section.indexOf('"subscriberCountText"');
    if (subIdx === -1) continue;
    const raw = findSimpleTextNear(section, subIdx);
    if (raw) {
      const count = parseSubscriberCount(raw);
      if (count !== null) {
        console.log(`[YCF bg] ${key} raw="${raw}" count=${count}`);
        return count;
      }
    }
  }

  // Fall back to all occurrences, take the largest
  const allCounts = [];
  let pos = 0;
  while (true) {
    const subIdx = html.indexOf('"subscriberCountText"', pos);
    if (subIdx === -1) break;
    const raw = findSimpleTextNear(html, subIdx);
    if (raw) {
      const count = parseSubscriberCount(raw);
      if (count !== null) allCounts.push(count);
    }
    pos = subIdx + 1;
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

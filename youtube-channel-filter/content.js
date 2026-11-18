const ATTR = 'data-ycf';
const OVERLAY_CLASS = 'ycf-overlay';
const PLAYER_OVERLAY_ID = 'ycf-player-overlay';
const BADGE_CLASS = 'ycf-sub-badge';

let subThreshold = 10000;
let viewThreshold = 50000;
let removeShorts = true;
let watchPageDismissed = false;
let watchPageVersion = 0;
let lastWatchKey = null;

async function loadSettings() {
  const r = await chrome.storage.sync.get({ subThreshold: 10000, viewThreshold: 50000, removeShorts: true });
  subThreshold = r.subThreshold;
  viewThreshold = r.viewThreshold;
  removeShorts = r.removeShorts;
  document.documentElement.classList.toggle('ycf-hide-shorts', removeShorts);
}

const CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'yt-lockup-view-model',
].join(', ');

const WATCH_CHANNEL_SELECTORS = [
  'ytd-video-owner-renderer ytd-channel-name a',
  '#owner ytd-channel-name a',
  'ytd-watch-metadata ytd-channel-name a',
  '#above-the-fold ytd-channel-name a',
];

// --- Helpers ---

function normalizeChannelUrl(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://www.youtube.com');
    return 'https://www.youtube.com' + u.pathname;
  } catch { return null; }
}

function normalizeVideoUrl(href) {
  if (!href) return null;
  try {
    const v = new URL(href).searchParams.get('v');
    return v ? `https://www.youtube.com/watch?v=${v}` : null;
  } catch { return null; }
}

function parseCount(text) {
  if (!text) return null;
  const m = text.match(/([\d,.]+)\s*([KMBkmb]?)/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') return Math.round(num * 1_000);
  if (suffix === 'M') return Math.round(num * 1_000_000);
  if (suffix === 'B') return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

// Extract view count from card's visible text ("134K views", "134,134 views")
function getViewCountFromCard(card) {
  const m = card.textContent.match(/([\d,.]+[KMBkmb]?)\s+views/i);
  return m ? parseCount(m[1]) : null;
}

// Extract view count from the watch page DOM
function getWatchPageViewCount() {
  const el = document.querySelector('ytd-video-view-count-renderer');
  if (!el) return null;
  const m = el.textContent.match(/([\d,.]+[KMBkmb]?)\s*views/i);
  return m ? parseCount(m[1]) : null;
}

// Extract subscriber count from the watch page DOM (already rendered by YouTube).
// Only reads the metadata block of the current video: YouTube is an SPA and keeps
// stale/hidden owner elements around, so a bare '#owner' query can return the
// previous video's channel.
function getWatchPageSubCount() {
  const videoId = new URLSearchParams(window.location.search).get('v');
  const flexy = document.querySelector('ytd-watch-flexy');
  if (!flexy || !videoId || flexy.getAttribute('video-id') !== videoId) return null;
  const ownerEl = flexy.querySelector('ytd-watch-metadata #owner');
  if (!ownerEl) return null;
  const subEl = ownerEl.querySelector('#owner-sub-count') || ownerEl;
  const m = subEl.textContent.match(/([\d,.]+[KMBkmb]?)\s+subscribers?/i);
  return m ? parseCount(m[1]) : null;
}

// --- Lookup URL for subscriber count ---

function getChannelUrlFromPolymer(card) {
  try {
    const d = card.data;
    if (!d) return null;
    const renderer =
      d.compactVideoRenderer ||
      d.videoRenderer ||
      d.richItemRenderer?.content?.videoRenderer ||
      d.richItemRenderer?.content?.reelItemRenderer;
    if (!renderer) return null;
    const runs =
      renderer.longBylineText?.runs ||
      renderer.shortBylineText?.runs ||
      renderer.ownerText?.runs;
    const base = runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
    if (base) return 'https://www.youtube.com' + base;
  } catch { /* ignore */ }
  return null;
}

function getLookupUrl(card) {
  // Set by page-world.js for new-style lockup cards, which have no channel link.
  const tagged = card.getAttribute('data-ycf-channel') ||
    card.querySelector('[data-ycf-channel]')?.getAttribute('data-ycf-channel');
  if (tagged) return tagged;
  const polymer = getChannelUrlFromPolymer(card);
  if (polymer) return polymer;
  const channelAnchor = card.querySelector(
    'ytd-channel-name a, #channel-name a, a[href^="/@"], a[href^="/channel/"], a[href^="/user/"]'
  );
  if (channelAnchor) return normalizeChannelUrl(channelAnchor.href);
  return null;
}

// --- Overlays ---

function getThumbnail(card) {
  return card.querySelector('ytd-thumbnail, yt-thumbnail-view-model');
}

function applyCardOverlay(thumbnail, failingReasons) {
  let el = thumbnail.querySelector(`.${OVERLAY_CLASS}`);
  if (!el) {
    if (getComputedStyle(thumbnail).position === 'static') thumbnail.style.position = 'relative';
    el = document.createElement('div');
    el.className = OVERLAY_CLASS;
    const title = document.createElement('div');
    title.className = 'ycf-title';
    title.textContent = 'Likely garbage';
    el.appendChild(title);
    el.appendChild(document.createElement('div')).className = 'ycf-reasons';
    thumbnail.appendChild(el);
  }
  el.querySelector('.ycf-reasons').textContent = failingReasons.join('\n');
}

function removeCardOverlay(thumbnail) {
  thumbnail.querySelector(`.${OVERLAY_CLASS}`)?.remove();
  thumbnail.style.position = '';
}

function applyPlayerOverlay(failingReasons) {
  const reasonsText = failingReasons.join('\n');
  let el = document.getElementById(PLAYER_OVERLAY_ID);
  if (el) {
    const reasonsEl = el.querySelector('div');
    if (reasonsEl.textContent !== reasonsText) reasonsEl.textContent = reasonsText;
    return;
  }
  const player = document.querySelector('#movie_player');
  if (!player) return;
  if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
  el = document.createElement('div');
  el.id = PLAYER_OVERLAY_ID;
  const label = document.createElement('span');
  label.textContent = 'Likely garbage';
  const reasonsEl = document.createElement('div');
  reasonsEl.style.cssText = 'font-size:14px;opacity:0.7;text-align:center;line-height:1.8;white-space:pre';
  const btn = document.createElement('button');
  btn.textContent = 'Watch anyway';
  btn.addEventListener('click', () => { watchPageDismissed = true; el.remove(); });
  el.appendChild(label);
  el.appendChild(reasonsEl);
  el.appendChild(btn);
  reasonsEl.textContent = reasonsText;
  player.appendChild(el);
}

function removePlayerOverlay() {
  document.getElementById(PLAYER_OVERLAY_ID)?.remove();
}

// --- Subscriber badge next to channel name ---

function formatCount(n) {
  if (n >= 1_000_000_000) return +(n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return +(n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return +(n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function isVisible(el) {
  return el.getClientRects().length > 0 && !el.closest('[hidden]');
}

// Returns { el, where } describing where to insert the badge, or null.
// Tries, in order: visible channel-name element, first part of the first
// metadata row (new lockup cards), and finally right before the "N views" text.
function getBadgePlacement(card) {
  for (const el of card.querySelectorAll('ytd-channel-name')) {
    if (isVisible(el)) return { el, where: 'afterend' };
  }
  // New lockup cards: "Channel ✓ · ▶ 1k · 2 hr ago" in one metadata row.
  // Put the badge before the delimiter that precedes the views part, i.e. right
  // after the channel name(s) and verified icon.
  const row = card.querySelector('.ytContentMetadataViewModelMetadataRow, [class*="metadata-row"]');
  if (row && isVisible(row)) {
    const views = row.querySelector('[aria-label$=" views"], [aria-label$=" view"]');
    if (views) {
      let el = views;
      while (el.previousElementSibling && !/Delimiter/i.test(el.previousElementSibling.className)) {
        el = el.previousElementSibling;
      }
      const delim = el.previousElementSibling;
      return delim ? { el: delim, where: 'beforebegin' } : { el, where: 'beforebegin' };
    }
    const first = row.querySelector('.ytContentMetadataViewModelMetadataText, [class*="metadata-text"]');
    if (first) {
      const next = first.nextElementSibling;
      const afterIcon = next && /Icon/.test(next.className) && !/LeadingIcon/.test(next.className);
      return { el: afterIcon ? next : first, where: 'afterend' };
    }
  }
  for (const el of card.querySelectorAll('span, div, yt-formatted-string')) {
    if (el.children.length === 0 && /^\s*[\d,.]+\s*[KMB]?\s+views?\s*$/i.test(el.textContent) && isVisible(el)) {
      return { el, where: 'beforebegin' };
    }
  }
  return null;
}

// Color tier for the badge.
function subTier(count) {
  if (count < 10_000) return 'red';
  if (count < 100_000) return 'orange';
  if (count < 1_000_000) return 'yellow';
  return 'green';
}

function setBadgeTier(badge, count) {
  const tier = subTier(count);
  const cls = tier ? `${BADGE_CLASS} ycf-sub-${tier}` : BADGE_CLASS;
  if (badge.className !== cls) badge.className = cls;
}

// DEBUG: compact text dump of a card's element tree (tag, classes, notable
// attributes, visibility, own text) for diagnosing badge placement failures.
function dumpStructure(root, maxLines = 400) {
  const lines = [];
  const walk = (el, depth) => {
    if (lines.length >= maxLines) return;
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    const attrs = ['id', 'aria-label', 'href', 'hidden', 'title']
      .filter(a => el.hasAttribute(a))
      .map(a => `${a}="${(el.getAttribute(a) || '').slice(0, 80)}"`)
      .join(' ');
    const ownText = [...el.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 80);
    const vis = el.getClientRects().length > 0 ? '' : ' [not-rendered]';
    lines.push(`${'  '.repeat(depth)}<${tag}${cls}${attrs ? ' ' + attrs : ''}>${vis}${ownText ? ` "${ownText}"` : ''}`);
    if (tag === 'svg') return; // icon internals are noise
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(root, 0);
  if (lines.length >= maxLines) lines.push(`... truncated at ${maxLines} lines`);
  return lines.join('\n');
}

function applySubBadge(card, count) {
  const text = `[${formatCount(count)} sub]`;
  const existing = card.querySelector(`.${BADGE_CLASS}`);
  if (existing) {
    if (existing.textContent !== text) existing.textContent = text;
    setBadgeTier(existing, count);
    return;
  }
  const placement = getBadgePlacement(card);
  if (!placement) {
    console.warn('[YCF] no place for sub badge on card', card.tagName, card);
    console.log('[YCF DEBUG] card structure:\n' + dumpStructure(card));
    return;
  }
  const badge = document.createElement('span');
  setBadgeTier(badge, count);
  badge.textContent = text;
  placement.el.insertAdjacentElement(placement.where, badge);
  console.log(`[YCF] badge ${text} placed ${placement.where} <${placement.el.tagName.toLowerCase()} class="${placement.el.className}">`);
}

// --- Processing ---

async function processCard(card) {
  const current = card.getAttribute(ATTR);
  if (current === 'pending') return;
  // Playlists/mixes are hidden by content.css; nothing to look up.
  if (card.querySelector('a[href*="list="]')) return;

  const lookupUrl = getLookupUrl(card);
  if (!lookupUrl) {
    // DEBUG: log once per video why this card gets no badge.
    const href = card.querySelector('a[href*="/watch"]')?.getAttribute('href') || '(no watch link)';
    if (card.dataset.ycfDebugged !== href) {
      card.dataset.ycfDebugged = href;
      console.log(`[YCF DEBUG] no channel URL for card ${card.tagName} ${href}\n` + dumpStructure(card, 150));
    }
    return;
  }

  // Already processed for this channel + threshold. YouTube recycles card
  // elements, so the key includes the channel URL. Re-insert the badge if
  // YouTube re-rendered the metadata and dropped it.
  const doneKey = `${subThreshold}|${lookupUrl}`;
  if (current === doneKey) {
    const known = card.dataset.ycfSubs;
    if (known) applySubBadge(card, Number(known));
    return;
  }

  card.setAttribute(ATTR, 'pending');

  let subCount = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_SUBSCRIBER_COUNT', channelUrl: lookupUrl });
    subCount = resp?.count ?? null;
  } catch (e) {
    console.warn('[YCF] sendMessage failed', e);
  }

  card.setAttribute(ATTR, doneKey);
  if (subCount !== null) {
    card.dataset.ycfSubs = String(subCount);
    applySubBadge(card, subCount);
  } else {
    delete card.dataset.ycfSubs;
    card.querySelector(`.${BADGE_CLASS}`)?.remove();
  }

  const viewCount = getViewCountFromCard(card);
  const failing = [];
  const viewsFailing = viewCount !== null && viewCount < viewThreshold;
  const subsFailing = subCount !== null && subCount < subThreshold;
  if (viewsFailing && subsFailing) { failing.push('Too few views'); failing.push('Too few subscribers'); }
  else if (subsFailing) failing.push('Too few subscribers');

  console.log(`[YCF] card views=${viewCount} subs=${subCount} failing=${failing}`);

  const thumbnail = getThumbnail(card);
  if (!thumbnail) return;

  if (failing.length > 0) {
    applyCardOverlay(thumbnail, failing);
  } else {
    removeCardOverlay(thumbnail);
  }
}

function processWatchPage() {
  if (window.location.pathname !== '/watch') { removePlayerOverlay(); lastWatchKey = null; return; }
  if (watchPageDismissed) return;

  const subCount = getWatchPageSubCount();
  const viewCount = getWatchPageViewCount();

  // DOM not ready yet — MutationObserver will retry when content loads
  if (subCount === null) return;

  // Re-evaluate whenever the video or the counts change (e.g. the owner block
  // finishes updating after an SPA navigation), but do nothing if unchanged so
  // we don't loop on our own DOM mutations.
  const key = `${window.location.href}|${subCount}|${viewCount}`;
  if (key === lastWatchKey) return;
  lastWatchKey = key;

  const failing = [];
  const viewsFailing = viewCount !== null && viewCount < viewThreshold;
  const subsFailing = subCount < subThreshold;
  if (viewsFailing && subsFailing) { failing.push('Too few views'); failing.push('Too few subscribers'); }
  else if (subsFailing) failing.push('Too few subscribers');

  const title = document.querySelector('h1.ytd-watch-metadata, h1[class*="title"] yt-formatted-string')?.textContent?.trim() ?? '?';
  console.log(`[YCF] [${title}] views=${viewCount} subs=${subCount} failing=${failing}`);

  if (failing.length > 0) {
    applyPlayerOverlay(failing);
  } else {
    removePlayerOverlay();
  }
}

function processAll() {
  document.querySelectorAll(CARD_SELECTOR).forEach(card => processCard(card));
  processWatchPage();
}

// --- Observers & init ---

let debounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(processAll, 300);
});

function resetAndProcess() {
  document.querySelectorAll(`[${ATTR}]`).forEach(el => el.removeAttribute(ATTR));
  processAll();
}

window.addEventListener('yt-page-data-updated', resetAndProcess);

window.addEventListener('yt-navigate-finish', async () => {
  watchPageDismissed = false;
  await loadSettings();
  resetAndProcess();
  setTimeout(processAll, 800);
  setTimeout(processAll, 2000);
});

// DEBUG: every 3s, log (once per video) any visible card that has no badge,
// with the state processCard left it in. Catches the silent paths.
const auditLogged = new Set();
setInterval(() => {
  const seen = new Set();
  document.querySelectorAll('ytd-rich-item-renderer, ' + CARD_SELECTOR).forEach(el => {
    const card = el.closest('ytd-rich-item-renderer') || el;
    if (seen.has(card)) return;
    seen.add(card);
    if (!isVisible(card) || card.querySelector(`.${BADGE_CLASS}`)) return;
    const href = card.querySelector('a[href*="/watch"]')?.getAttribute('href');
    if (!href || auditLogged.has(href)) return;
    auditLogged.add(href);
    const inner = card.querySelector(CARD_SELECTOR);
    const state = c => c ? `<${c.tagName.toLowerCase()} matchesSelector=${c.matches(CARD_SELECTOR)} ycf="${c.getAttribute(ATTR)}" subs="${c.dataset.ycfSubs ?? ''}" channel="${c.getAttribute('data-ycf-channel') ?? ''}">` : '(none)';
    console.log(`[YCF DEBUG] card without badge ${href}\n  outer: ${state(card)}\n  inner: ${state(inner)}\n  lookupUrl: ${getLookupUrl(card)}\n` + dumpStructure(card, 150));
  });
}, 3000);

async function init() {
  await loadSettings();
  processAll();
  observer.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['data-ycf-channel'],
  });
}

init();

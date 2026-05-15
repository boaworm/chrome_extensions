const ATTR = 'data-ycf';
const OVERLAY_CLASS = 'ycf-overlay';
const PLAYER_OVERLAY_ID = 'ycf-player-overlay';

let subThreshold = 10000;
let viewThreshold = 50000;
let removeShorts = true;
let watchPageDismissed = false;
let watchPageVersion = 0;
let lastWatchVideoUrl = null;

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

// Extract subscriber count directly from the watch page DOM (already rendered by YouTube)
function getWatchPageSubCount() {
  const ownerEl = document.querySelector('#owner, ytd-video-owner-renderer');
  if (!ownerEl) return null;
  const m = ownerEl.textContent.match(/([\d,.]+[KMBkmb]?)\s+subscribers?/i);
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

// --- Processing ---

async function processCard(card) {
  const current = card.getAttribute(ATTR);
  if (current === 'pending' || current === String(subThreshold)) return;

  const lookupUrl = getLookupUrl(card);
  if (!lookupUrl) return;

  card.setAttribute(ATTR, 'pending');

  let subCount = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_SUBSCRIBER_COUNT', channelUrl: lookupUrl });
    subCount = resp?.count ?? null;
  } catch (e) {
    console.warn('[YCF] sendMessage failed', e);
  }

  card.setAttribute(ATTR, String(subThreshold));

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
  if (window.location.pathname !== '/watch') { removePlayerOverlay(); lastWatchVideoUrl = null; return; }
  if (watchPageDismissed) return;

  const videoUrl = window.location.href;
  if (videoUrl === lastWatchVideoUrl) return;

  const subCount = getWatchPageSubCount();
  const viewCount = getWatchPageViewCount();

  // DOM not ready yet — MutationObserver will retry when content loads
  if (subCount === null) return;

  lastWatchVideoUrl = videoUrl;

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

async function init() {
  await loadSettings();
  processAll();
  observer.observe(document.body, { childList: true, subtree: true });
}

init();

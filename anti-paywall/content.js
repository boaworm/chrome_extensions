const SITE_CONFIGS = {
  'cnn.com': {
    overlaySelectors: [
      '.user-account-reg-wall__overlay',
      '.user-account-reg-wall__modal',
    ],
    fixBodyScroll: true,
  },
  'bbc.com': {
    overlaySelectors: [
      '[data-component="sign-in-wall"]',
      '#sign-in-prompt',
      '.sign-in-prompt',
      '.tp-modal',
      '.tp-backdrop',
      '#subscription-banner',
      '#subliminal-banner',
    ],
    fixBodyScroll: true,
  },
};

let enabled = true;

function getSiteConfig() {
  const host = location.hostname;
  const key = Object.keys(SITE_CONFIGS).find(k => host.endsWith(k));
  return key ? SITE_CONFIGS[key] : null;
}

function removePaywalls(config) {
  if (!enabled) return;
  for (const sel of config.overlaySelectors) {
    document.querySelectorAll(sel).forEach(el => el.remove());
  }
  if (config.fixBodyScroll) {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }
}

async function loadSettings() {
  const r = await chrome.storage.sync.get({ enabled: true });
  enabled = r.enabled;
}

let debounceTimer = null;

function init() {
  const config = getSiteConfig();
  if (!config) return;

  removePaywalls(config);

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => removePaywalls(config), 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

loadSettings().then(init);

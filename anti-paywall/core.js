function removeElements(config) {
  for (const sel of config.overlaySelectors) {
    document.querySelectorAll(sel).forEach(el => el.remove());
  }
  if (config.fixBodyScroll) {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }
}

function initSite(config) {
  function run() {
    chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
      if (!enabled) return;

      removeElements(config);

      let debounceTimer;
      const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => removeElements(config), 100);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}

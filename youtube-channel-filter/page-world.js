// Runs in the page's MAIN world (not the isolated content-script world), because
// YouTube's per-element data (el.data on Polymer elements) is only visible here.
// For each lockup card it finds the channel URL and writes it to the element as
// data-ycf-channel, which content.js (isolated world) can read from the DOM.
(function () {
  const ATTR_CHANNEL = 'data-ycf-channel';
  const ATTR_FOR = 'data-ycf-channel-for';

  function getContentId(lockup) {
    const host = lockup.querySelector('[class*="content-id-"]');
    const m = host?.className.match(/content-id-([\w-]+)/);
    return m ? m[1] : null;
  }

  // Depth-first search for an object with contentId === id.
  function findLockupData(obj, id, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 14) return null;
    if (obj.contentId === id) return obj;
    for (const k in obj) {
      const r = findLockupData(obj[k], id, depth + 1);
      if (r) return r;
    }
    return null;
  }

  // Depth-first search for the first browseEndpoint pointing at a channel.
  function findChannelUrl(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return null;
    const be = obj.browseEndpoint;
    if (be) {
      if (be.canonicalBaseUrl) return 'https://www.youtube.com' + be.canonicalBaseUrl;
      if (typeof be.browseId === 'string' && be.browseId.startsWith('UC')) {
        return 'https://www.youtube.com/channel/' + be.browseId;
      }
    }
    for (const k in obj) {
      const r = findChannelUrl(obj[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  function tagLockup(lockup) {
    const id = getContentId(lockup);
    if (!id || lockup.getAttribute(ATTR_FOR) === id) return;
    // Card element was recycled for another video: drop the stale channel.
    lockup.removeAttribute(ATTR_CHANNEL);
    lockup.removeAttribute(ATTR_FOR);
    // Walk up to the nearest ancestor carrying Polymer data that contains this lockup.
    let el = lockup;
    for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
      const data = el.data || el.__data?.data;
      if (!data) continue;
      const lockupData = findLockupData(data, id);
      if (!lockupData) continue;
      const url = findChannelUrl(lockupData);
      if (url) {
        lockup.setAttribute(ATTR_CHANNEL, url);
        lockup.setAttribute(ATTR_FOR, id);
      }
      return;
    }
  }

  function tagAll() {
    document.querySelectorAll('yt-lockup-view-model').forEach(tagLockup);
  }

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(tagAll, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
  tagAll();
})();

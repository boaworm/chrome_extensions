const SUPPORTED_SITES = ['bbc.com'];

const enabledInput = document.getElementById('enabled');
const sitesList = document.getElementById('sites');

SUPPORTED_SITES.forEach(site => {
  const li = document.createElement('li');
  li.textContent = site;
  sitesList.appendChild(li);
});

chrome.storage.sync.get({ enabled: true }, r => {
  enabledInput.checked = r.enabled;
});

enabledInput.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

const subInput = document.getElementById('subThreshold');
const viewInput = document.getElementById('viewThreshold');
const removeShortsInput = document.getElementById('removeShorts');
const btn = document.getElementById('save');
const savedMsg = document.getElementById('saved-msg');

chrome.storage.sync.get({ subThreshold: 10000, viewThreshold: 50000, removeShorts: true }, r => {
  subInput.value = r.subThreshold;
  viewInput.value = r.viewThreshold;
  removeShortsInput.checked = r.removeShorts;
});

btn.addEventListener('click', () => {
  const subThreshold = parseInt(subInput.value, 10);
  const viewThreshold = parseInt(viewInput.value, 10);
  if (isNaN(subThreshold) || isNaN(viewThreshold)) return;
  chrome.storage.sync.set({ subThreshold, viewThreshold, removeShorts: removeShortsInput.checked }, () => {
    savedMsg.classList.add('show');
    setTimeout(() => savedMsg.classList.remove('show'), 2500);
  });
});

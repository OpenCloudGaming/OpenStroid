(function bootstrapOpenStroidCapture() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-hook.js');
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  function notifyPageVisit() {
    chrome.runtime.sendMessage({
      type: 'openstroid:page-visit',
      url: window.location.href,
    });
    chrome.runtime.sendMessage({
      type: 'openstroid:storage-snapshot',
      storageItems: collectStorageItems(),
    });
  }

  function shouldCaptureStorageValue(key, value) {
    if (/access|refresh|token|auth|session|user/i.test(key)) {
      return true;
    }

    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
      return true;
    }

    try {
      const parsed = JSON.parse(value);
      return hasTokenLikeJsonKey(parsed);
    } catch {
      return false;
    }
  }

  function hasTokenLikeJsonKey(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 4) {
      return false;
    }

    return Object.entries(value).some(([nestedKey, nestedValue]) =>
      /access|refresh|token|auth|session|user/i.test(nestedKey) ||
      hasTokenLikeJsonKey(nestedValue, depth + 1)
    );
  }

  function collectAreaStorage(area, storage) {
    const items = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      const value = storage.getItem(key);
      if (!value || !shouldCaptureStorageValue(key, value)) continue;
      items.push({
        area,
        key,
        value: value.slice(0, 10000),
      });
    }
    return items;
  }

  function collectStorageItems() {
    try {
      return [
        ...collectAreaStorage('localStorage', window.localStorage),
        ...collectAreaStorage('sessionStorage', window.sessionStorage),
      ];
    } catch {
      return [];
    }
  }

  window.addEventListener('openstroid:network-event', (event) => {
    const detail = event.detail;
    if (!detail) return;
    chrome.runtime.sendMessage({
      type: 'openstroid:network-event',
      event: detail,
    });
    chrome.runtime.sendMessage({
      type: 'openstroid:storage-snapshot',
      storageItems: collectStorageItems(),
    });
  });

  window.addEventListener('storage', () => {
    chrome.runtime.sendMessage({
      type: 'openstroid:storage-snapshot',
      storageItems: collectStorageItems(),
    });
  });

  notifyPageVisit();
  window.addEventListener('load', notifyPageVisit, { once: true });
})();

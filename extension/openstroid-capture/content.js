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
  }

  window.addEventListener('openstroid:network-event', (event) => {
    const detail = event.detail;
    if (!detail) return;
    chrome.runtime.sendMessage({
      type: 'openstroid:network-event',
      event: detail,
    });
  });

  notifyPageVisit();
  window.addEventListener('load', notifyPageVisit, { once: true });
})();

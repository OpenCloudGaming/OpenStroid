(() => {
  if (window.__OPENSTROID_CAPTURE_HOOKED__) {
    return;
  }
  window.__OPENSTROID_CAPTURE_HOOKED__ = true;

  const RELEVANT_PATH_PATTERNS = [
    '/api/v1/auth/login',
    '/api/v1/auth/refresh-token',
    '/api/v2/auth/logout',
    '/api/v1/user',
    '/api/v1/boostore/applications/installed',
    '/auth',
    '/login',
    '/session',
  ];

  function isRelevantUrl(url) {
    const value = String(url);
    return RELEVANT_PATH_PATTERNS.some((pattern) => value.includes(pattern)) ||
      (value.includes('/api/') && value.includes('boosteroid')) ||
      value.includes('/graphql') ||
      value.includes('/sanctum') ||
      value.includes('/oauth');
  }

  function dispatchNetworkEvent(event) {
    window.dispatchEvent(new CustomEvent('openstroid:network-event', { detail: event }));
  }

  function safeParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const request = args[0];
      const method = args[1]?.method || (request && typeof request === 'object' && 'method' in request ? request.method : 'GET');
      const url = typeof request === 'string' ? request : request?.url || response.url;
      if (url && isRelevantUrl(url)) {
        const cloned = response.clone();
        const contentType = cloned.headers.get('content-type') || '';
        let payload = null;
        if (contentType.includes('application/json')) {
          payload = await cloned.json().catch(() => null);
        }
        dispatchNetworkEvent({
          timestamp: new Date().toISOString(),
          type: 'response',
          source: 'extension',
          method,
          url,
          status: response.status,
          headers: {
            'content-type': contentType,
          },
          payload,
          message: 'Observed relevant fetch response from page context.',
        });
      }
    } catch {}
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__openstroidMethod = method;
    this.__openstroidUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    this.addEventListener('loadend', () => {
      try {
        const url = this.__openstroidUrl || this.responseURL;
        if (!url || !isRelevantUrl(url)) {
          return;
        }

        const contentType = this.getResponseHeader('content-type') || '';
        let payload = null;
        if (contentType.includes('application/json') && typeof this.responseText === 'string') {
          payload = safeParseJson(this.responseText);
        }

        dispatchNetworkEvent({
          timestamp: new Date().toISOString(),
          type: 'response',
          source: 'extension',
          method: this.__openstroidMethod || 'GET',
          url,
          status: this.status,
          headers: {
            'content-type': contentType,
          },
          payload,
          message: 'Observed relevant XHR response from page context.',
        });
      } catch {}
    }, { once: true });

    return originalSend.call(this, body);
  };
})();

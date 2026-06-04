/**
 * Injected Script — runs in MAIN world (page context).
 * Monitors fetch POST requests to capture Zoho Desk comments being submitted.
 * Sends captured data to content script via window.postMessage.
 */
(function () {
  'use strict';

  const COMMENT_POST_PATTERN = /\/supportapi\/zd\/[\w-]+\/api\/v1\/tickets\/\d+\/comments/;

  // --- Fetch Interceptor (stealth) ---
  const originalFetch = window.fetch;

  const patchedFetch = function (...args) {
    const [input, options] = args;
    const url = (typeof input === 'string') ? input : (input instanceof Request ? input.url : '');
    const method = (options && options.method) || (input instanceof Request ? input.method : 'GET');

    // DEBUG: Log all POSTs and any comment-related URLs
    if (method.toUpperCase() === 'POST' && COMMENT_POST_PATTERN.test(url)) {
      console.log('[ZD Tracker] Comment URL detected! Method:', method, 'URL:', url);
      console.log('[ZD Tracker] input type:', typeof input, input instanceof Request ? 'Request' : 'not Request');
      console.log('[ZD Tracker] options:', options ? Object.keys(options) : 'none');
      if (options && options.body) {
        console.log('[ZD Tracker] body type:', typeof options.body, options.body instanceof FormData ? 'FormData' : '');
        console.log('[ZD Tracker] body preview:', typeof options.body === 'string' ? options.body.substring(0, 200) : 'not a string');
      }
    }

    const result = originalFetch.apply(this, args);

    // Capture only POST requests to /comments (user submitting a comment)
    if (method.toUpperCase() === 'POST' && COMMENT_POST_PATTERN.test(url)) {
      // Extract content from request body if it's a POST
      let requestBody = null;
      if (options && options.body) {
        try {
          if (typeof options.body === 'string') {
            requestBody = JSON.parse(options.body);
          }
        } catch (e) { console.log('[ZD Tracker] Body parse error:', e); }
      }

      // Read response
      result.then(response => {
        console.log('[ZD Tracker] Response status:', response.status);
        try {
          response.clone().json().then(data => {
            console.log('[ZD Tracker] Response data keys:', Object.keys(data));
            dispatch(data, url, requestBody);
          }).catch((e) => console.log('[ZD Tracker] JSON error:', e));
        } catch (e) { console.log('[ZD Tracker] Clone error:', e); }
      }).catch((e) => console.log('[ZD Tracker] Fetch error:', e));
    }

    return result;
  };

  // Make patched fetch look native to toString() checks
  Object.defineProperty(patchedFetch, 'toString', {
    value: () => 'function fetch() { [native code] }',
    writable: true,
    configurable: true
  });
  Object.defineProperty(patchedFetch, 'name', { value: 'fetch', configurable: true });

  window.fetch = patchedFetch;

  // --- XHR Interceptor (stealth) ---
  // Zoho likely uses XMLHttpRequest for comment submission
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function (method, url, ...rest) {
    this._zdMethod = method;
    this._zdUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.send = function (body) {
    // Only capture POST requests (user submitting a comment), not GET (loading existing comments)
    if (this._zdMethod && this._zdMethod.toUpperCase() === 'POST' && this._zdUrl && COMMENT_POST_PATTERN.test(this._zdUrl)) {
      console.log('[ZD Tracker XHR] Comment POST detected! URL:', this._zdUrl);
      console.log('[ZD Tracker XHR] body type:', typeof body, body instanceof FormData ? 'FormData' : '');
      if (typeof body === 'string') {
        console.log('[ZD Tracker XHR] body preview:', body.substring(0, 300));
      }

      // Listen for response
      this.addEventListener('load', function () {
        console.log('[ZD Tracker XHR] Response status:', this.status);
        console.log('[ZD Tracker XHR] Response preview:', this.responseText.substring(0, 300));
        try {
          const data = JSON.parse(this.responseText);
          let requestBody = null;
          if (typeof body === 'string') {
            try { requestBody = JSON.parse(body); } catch (e) {}
          }
          dispatch(data, this._zdUrl, requestBody);
        } catch (e) {
          console.log('[ZD Tracker XHR] Parse error:', e);
        }
      });
    }

    return origSend.call(this, body);
  };

  // Stealth: make XHR methods look native
  Object.defineProperty(XHR.open, 'toString', {
    value: () => 'function open() { [native code] }',
    configurable: true
  });
  Object.defineProperty(XHR.send, 'toString', {
    value: () => 'function send() { [native code] }',
    configurable: true
  });

  // --- Dispatch to content script ---
  function dispatch(responseData, url, requestBody) {
    // Response from POST typically returns the created comment object
    const comment = responseData.data || responseData;

    // Content can come from request body or response
    const content = comment.content || (requestBody && requestBody.content) || '';

    console.log('[ZD Tracker] Dispatching capture! id:', comment.id, 'content length:', content.length);

    window.postMessage({
      type: '__ZD_COMMENT_CAPTURED__',
      payload: {
        id: comment.id || Date.now().toString(),
        content: content,
        commentedTime: comment.commentedTime || comment.createdTime || new Date().toISOString(),
        commenter: comment.commenter || comment.commentedBy || null,
        isPublic: comment.isPublic !== undefined ? comment.isPublic : (requestBody && requestBody.isPublic),
        url: url
      }
    }, '*');
  }
})();

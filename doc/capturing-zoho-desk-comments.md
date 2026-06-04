# Capturing Zoho Desk Comment Responses

## Key Discovery

Zoho Desk uses **XMLHttpRequest (XHR)**, not the Fetch API, to submit comments. This is critical because intercepting only `fetch` will miss comment submissions entirely.

## API Endpoint

```
POST /supportapi/zd/{org-name}/api/v1/tickets/{ticketId}/comments
```

- The `{org-name}` segment varies per organization (e.g., `manageengine`)
- Regex pattern used: `/\/supportapi\/zd\/[\w-]+\/api\/v1\/tickets\/\d+\/comments/`

## How the Interception Works

### 1. Script runs in MAIN world

The injected content script must run in the **MAIN** world (page context), not the ISOLATED world. This is because we need access to the page's actual `XMLHttpRequest` and `fetch` objects.

```json
// manifest.json
"content_scripts": [{
  "world": "MAIN",
  "js": ["src/injected/index.js"]
}]
```

### 2. Patch XMLHttpRequest.prototype

We override `open()` to store the method and URL, then override `send()` to check if the URL matches our pattern and attach a `load` event listener to read the response.

```js
const XHR = XMLHttpRequest.prototype;
const origOpen = XHR.open;
const origSend = XHR.send;

XHR.open = function (method, url, ...rest) {
  this._zdMethod = method;
  this._zdUrl = url;
  return origOpen.call(this, method, url, ...rest);
};

XHR.send = function (body) {
  if (this._zdUrl && COMMENT_POST_PATTERN.test(this._zdUrl)) {
    this.addEventListener('load', function () {
      const data = JSON.parse(this.responseText);
      // Process captured data...
    });
  }
  return origSend.call(this, body);
};
```

### 3. Stealth (avoid detection)

Zoho has anti-tampering checks that call `.toString()` on native methods. Override `toString` to return the expected native string:

```js
Object.defineProperty(XHR.open, 'toString', {
  value: () => 'function open() { [native code] }',
  configurable: true
});
Object.defineProperty(XHR.send, 'toString', {
  value: () => 'function send() { [native code] }',
  configurable: true
});
```

### 4. Communication bridge

Since the MAIN world script can't directly use Chrome extension APIs, it sends data via `window.postMessage` to a content script running in ISOLATED world, which then forwards it to the background service worker via `chrome.runtime.sendMessage`.

```
MAIN world (injected) --postMessage--> ISOLATED world (content) --sendMessage--> Background (service worker)
```

## Request Body Format

When a user posts a comment, the XHR body is a JSON string:

```json
{
  "attachmentIds": [],
  "content": "<p>Comment HTML content here</p>",
  "isPublic": false
}
```

## Response Format

The API returns the created comment object with metadata:

```json
{
  "id": "123456789",
  "content": "<p>Comment HTML content</p>",
  "commentedTime": "2026-05-25T10:30:00.000Z",
  "commenter": { "name": "User Name", ... },
  "isPublic": false
}
```

## Gotchas

| Issue | Cause | Fix |
|-------|-------|-----|
| Fetch interceptor catches nothing | Zoho uses XHR, not fetch, for comments | Intercept both `fetch` and `XMLHttpRequest` |
| Console warnings about "restriction rules" | Zoho detects prototype tampering via `.toString()` | Override `.toString()` to return native-looking string |
| PowerShell BOM in JSON files | `-Encoding UTF8` adds BOM by default | Use `[System.Text.UTF8Encoding]::new($false)` |
| GET `/conversations` vs POST `/comments` | Loading existing comments uses a different endpoint | Only intercept `/comments` for user-submitted comments |

## Why Not Fetch?

Some parts of Zoho Desk (like LiveChat) do use `fetch`, but the ticket comment submission specifically uses `XMLHttpRequest`. Always check DevTools Network tab to confirm which API a specific action uses — the "Fetch/XHR" filter in Chrome groups both together, so you can't tell from the filter alone.

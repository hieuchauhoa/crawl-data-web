const API_BASE = "http://127.0.0.1:17321";

type LocalFetchMessage = {
  type: "LOCAL_FETCH";
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
};

// A content script's own fetch() can't read file:// pages at all — Chrome treats a page-context fetch
// to file:// as cross-origin with no way to satisfy CORS, so it fails outright with "Failed to fetch"
// even on a page that IS itself file://. This runs the fetch here in the background service worker
// instead, which — once the extension has "Allow access to file URLs" enabled — is allowed to read
// file:// content; the same relay works unchanged for a normal http(s) list page too.
type FetchTextMessage = { type: "FETCH_TEXT"; url: string };

chrome.runtime.onMessage.addListener((message: LocalFetchMessage | FetchTextMessage, _sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "FETCH_TEXT") {
    fetch(message.url)
      .then(async response => sendResponse({ ok: response.ok, status: response.status, data: await response.text() }))
      .catch(error => sendResponse({ ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type !== "LOCAL_FETCH") return false;

  const method = message.method || "GET";
  fetch(`${API_BASE}${message.path}`, {
    method,
    headers: method !== "GET" ? { "content-type": "application/json" } : undefined,
    body: method !== "GET" ? JSON.stringify(message.body ?? {}) : undefined
  })
    .then(async response => {
      const text = await response.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      sendResponse({ ok: response.ok, status: response.status, data });
    })
    .catch(error => {
      sendResponse({ ok: false, status: 0, error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});

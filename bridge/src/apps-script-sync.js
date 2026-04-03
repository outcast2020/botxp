const { nowIso } = require("./utils");

async function syncToAppsScript(config, payload) {
  if (!config.appsScriptSyncUrl) {
    return { ok: false, skipped: true, reason: "sync_url_not_configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.appsScriptSyncTimeoutMs);

  try {
    const response = await fetch(config.appsScriptSyncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        event: "bridge_sync",
        sentAt: nowIso(),
        syncToken: config.appsScriptSyncToken || ""
      }),
      signal: controller.signal
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        payload: json
      };
    }

    return {
      ok: true,
      payload: json
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  syncToAppsScript
};

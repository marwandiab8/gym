const { readConfig } = require("./config");

function assertConfig(config) {
  const missing = [];
  if (!config.calendarId) missing.push("TIME_LEFT_CALENDAR_ID");
  if (!config.connectionId) missing.push("TIME_LEFT_CONNECTION_ID");
  if (!config.singleEndpoint) missing.push("TIME_LEFT_SINGLE_INGEST_ENDPOINT");
  if (!config.ownerUid) missing.push("GYM_TIME_LEFT_OWNER_UID");
  if (!config.token) missing.push("TIME_LEFT_INGESTION_TOKEN");
  if (missing.length) {
    const error = new Error(`GYM-K2 Time Left sync is not configured: ${missing.join(", ")}`);
    error.code = "time-left-gym-not-configured";
    throw error;
  }
}

async function parseResponse(response) {
  const bodyText = await response.text();
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch (_) {
    return { raw: bodyText.slice(0, 1000) };
  }
}

async function sendTimeLeftGymItem(item, options = {}) {
  const config = readConfig();
  try {
    assertConfig(config);
    const response = await fetch(config.singleEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        calendarId: config.calendarId,
        connectionId: config.connectionId,
        item,
      }),
    });
    const body = await parseResponse(response);
    if (!response.ok) {
      const error = new Error(body.error || body.message || `Time Left ingestion failed with HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  } catch (error) {
    console.warn("GYM-K2 Time Left ingestion failed", {
      sourceDocumentPath: item && item.sourceDocumentPath,
      sourceProjectId: item && item.sourceProjectId,
      category: item && item.category,
      dateId: item && item.dateId,
      status: error.status || null,
      code: error.code || null,
      message: String(error.message || error).slice(0, 300),
    });
    if (options.throwOnError) throw error;
    return { ok: false, error: error.message, status: error.status || null };
  }
}

module.exports = {
  sendTimeLeftGymItem,
};

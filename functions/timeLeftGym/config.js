const DEFAULT_SINGLE_INGEST_ENDPOINT =
  "https://northamerica-northeast1-timelefttolive.cloudfunctions.net/ingestExternalDailyItem";

function readConfig() {
  return {
    appBaseUrl: String(process.env.GYM_APP_BASE_URL || "https://gym-k2.web.app").trim().replace(/\/+$/, ""),
    calendarId: String(process.env.TIME_LEFT_CALENDAR_ID || "").trim(),
    connectionId: String(process.env.TIME_LEFT_CONNECTION_ID || "").trim(),
    ownerUid: String(process.env.GYM_TIME_LEFT_OWNER_UID || "").trim(),
    singleEndpoint: String(process.env.TIME_LEFT_SINGLE_INGEST_ENDPOINT || DEFAULT_SINGLE_INGEST_ENDPOINT).trim(),
    sourceFirebaseProjectId: String(process.env.GYM_FIREBASE_PROJECT_ID || "gym-k2").trim(),
    sourceProjectId: String(process.env.GYM_SOURCE_PROJECT_ID || "gym-k2").trim(),
    token: String(process.env.TIME_LEFT_INGESTION_TOKEN || "").trim(),
  };
}

module.exports = {
  DEFAULT_SINGLE_INGEST_ENDPOINT,
  readConfig,
};

const fs = require("fs");
function load(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
load(".env.local");
load(".env");

const propertyId = process.env.GA4_PROPERTY_ID || "289575590";

async function token() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const json = await res.json();
  if (!json.access_token) throw new Error(JSON.stringify(json));
  return json.access_token;
}

async function runReport(accessToken, body) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 500));
  return json;
}

function rows(report) {
  return (report.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value) || 0),
  }));
}

(async () => {
  const accessToken = await token();
  const dateRanges = [{ startDate: "28daysAgo", endDate: "yesterday" }];
  const unassignedFilter = {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      stringFilter: { matchType: "EXACT", value: "Unassigned" },
    },
  };

  const reports = {};

  reports.bySourceMedium = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "averageSessionDuration" },
      { name: "screenPageViewsPerSession" },
    ],
    dimensionFilter: unassignedFilter,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 20,
  }));

  reports.byHostname = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "hostName" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "averageSessionDuration" }],
    dimensionFilter: unassignedFilter,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 20,
  }));

  reports.byCountry = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "country" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
    dimensionFilter: unassignedFilter,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  }));

  reports.byDevice = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "deviceCategory" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
    dimensionFilter: unassignedFilter,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  }));

  reports.byLanding = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "landingPagePlusQueryString" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "averageSessionDuration" }],
    dimensionFilter: unassignedFilter,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  }));

  reports.byDate = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "averageSessionDuration" }],
    dimensionFilter: unassignedFilter,
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 40,
  }));

  reports.byPlatform = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "platform" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
    dimensionFilter: unassignedFilter,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  }));

  // Compare: all traffic source (not set)
  reports.notSetAllChannels = rows(await runReport(accessToken, {
    dateRanges,
    dimensions: [{ name: "sessionDefaultChannelGroup" }, { name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "EXACT", value: "(not set)" } } },
          { filter: { fieldName: "sessionMedium", stringFilter: { matchType: "EXACT", value: "(not set)" } } },
        ],
      },
    },
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  }));

  fs.writeFileSync("scripts/output-ga4-unassigned-research.json", JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

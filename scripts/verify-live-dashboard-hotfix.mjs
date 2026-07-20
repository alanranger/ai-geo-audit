const url = 'https://ai-geo-audit.vercel.app/audit-dashboard.html?cb=' + Date.now();
const res = await fetch(url);
const html = await res.text();
const checks = {
  status: res.status,
  bytes: html.length,
  truncStillPresent: /LLM step\s*\n\s*\n\s*async function postGlobalRunRefresh/.test(html),
  footnoteIntact: html.includes('last collect $') && html.includes('This is NOT Google AI Overviews'),
  summaryReturn: html.includes("return parts.join('')") || html.includes('return parts.join("")'),
  commitHint: (html.match(/cddb278|77d8cf8|b1e6f2b/g) || []).slice(0, 5),
};
console.log(JSON.stringify(checks, null, 2));
if (checks.truncStillPresent || !checks.footnoteIntact || !checks.summaryReturn) process.exit(1);

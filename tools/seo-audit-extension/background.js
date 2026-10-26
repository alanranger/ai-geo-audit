const DASHBOARD = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';

function auditUrlFor(pageUrl) {
  const u = new URL(pageUrl);
  if (!/^https?:$/.test(u.protocol) || !/(^|\.)alanranger\.com$/i.test(u.hostname)) return null;
  return `${DASHBOARD}?seoPage=${encodeURIComponent(u.origin + u.pathname)}&reaudit=1`;
}

// Reuse one dashboard tab so two stale tabs never save over each other.
chrome.action.onClicked.addListener(async (tab) => {
  let target = null;
  try { target = tab?.url ? auditUrlFor(tab.url) : null; } catch (e) { target = null; }
  if (!target) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '✕' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Open an alanranger.com page first' });
    return;
  }
  const [existing] = await chrome.tabs.query({ url: `${DASHBOARD}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { url: target, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target, index: tab.index + 1 });
  }
});

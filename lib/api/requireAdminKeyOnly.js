// lib/api/requireAdminKeyOnly.js
// Admin gate without origin enforcement (for trusted dashboards).

export function requireAdminKeyOnly(req, res, sendJSON) {
  const expected = process.env.ARP_ADMIN_KEY;
  if (!expected || !String(expected).trim()) {
    sendJSON(res, 500, { error: "Server misconfigured: ARP_ADMIN_KEY missing." });
    return false;
  }

  const provided = req.headers["x-arp-admin-key"] || "";
  if (!provided || provided !== expected) {
    sendJSON(res, 401, { error: "Unauthorized" });
    return false;
  }

  return true;
}

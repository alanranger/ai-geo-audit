// lib/client/adminKey.js
// Client-side utilities for admin key management

/**
 * Get admin key from sessionStorage
 */
export function getAdminKey() {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("arp_admin_key") || "";
}

/**
 * Set admin key in sessionStorage
 */
export function setAdminKey(key) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem("arp_admin_key", key);
}

/**
 * Check if admin key is set
 */
export function hasAdminKey() {
  return getAdminKey().length > 0;
}

/**
 * Clear admin key from sessionStorage
 */
export function clearAdminKey() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem("arp_admin_key");
}

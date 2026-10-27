/**
 * Weekly plan: every top-level money/landing page + one rotation slot (25%)
 * of blog posts and deeper pages, so everything is rendered every 4 weeks.
 */
import { classifyPageSegment, PageSegment } from '../../api/aigeo/pageSegment.js';
import { ACADEMY_PATH, BLOG_ROTATION_SLOTS } from './monitor-config.js';

export function pathOfUrl(url) {
  try { return new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { return '/'; }
}

/** blog | money | landing | other */
export function pageTypeOf(url) {
  const path = pathOfUrl(url);
  if (path.startsWith('/blog-on-photography/')) return 'blog';
  const depth = path.split('/').filter(Boolean).length;
  if (depth > 1) return 'other';
  const seg = classifyPageSegment(url);
  if (seg === PageSegment.MONEY) return 'money';
  return seg === PageSegment.SYSTEM && path !== '/' ? 'other' : 'landing';
}

export function slugHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rotationSlot(weekStartYmd) {
  const days = Math.floor(Date.parse(`${weekStartYmd}T12:00:00Z`) / 86400000);
  return Math.floor(days / 7) % BLOG_ROTATION_SLOTS;
}

/** @returns {{ slot: number, items: { u: string, t: string }[] }} */
export function buildPlan(siteUrls, weekStartYmd) {
  const slot = rotationSlot(weekStartYmd);
  const items = [];
  const seen = new Set();
  for (const u of siteUrls || []) {
    const path = pathOfUrl(u);
    if (seen.has(path)) continue;
    seen.add(path);
    const t = pageTypeOf(u);
    const always = t === 'money' || t === 'landing';
    if (always || slugHash(path) % BLOG_ROTATION_SLOTS === slot) items.push({ u, t });
  }
  items.sort((a, b) => Number(b.t === 'money') - Number(a.t === 'money'));
  return { slot, items };
}

export function isAcademyUrl(url) {
  return pathOfUrl(url) === ACADEMY_PATH;
}

/** page_indexability_policy rows → what is intended for this URL. */
export function policyFor(url, rows) {
  const path = pathOfUrl(url);
  const out = { intentionalNoindex: false, redirectTarget: null };
  for (const r of rows || []) {
    const p = String(r.url_or_prefix || '').replace(/\/+$/, '');
    const hit = r.match_type === 'prefix' ? (path === p || path.startsWith(`${p}/`)) : path === p;
    if (!hit) continue;
    if (r.policy === 'intentional_noindex') out.intentionalNoindex = true;
    if (r.policy === 'retired_redirect') out.redirectTarget = r.redirect_target || null;
  }
  return out;
}

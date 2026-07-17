/**
 * Alan-signed 15-cluster LLM taxonomy (Jul 2026).
 * Members = tracked keywords on cluster target_page; split pages use theme filters.
 */
export const LLM_CLUSTER_TAXONOMY = [
  { cluster_id: 'COMMERCIAL-Local-general', rep: 'commercial photographer', target_page: '/professional-commercial-photographer-coventry', split: 'general' },
  { cluster_id: 'COMMERCIAL-Local-headshots', rep: 'professional headshots', target_page: '/professional-photographer-near-me' },
  { cluster_id: 'COMMERCIAL-Local-hire', rep: 'photographer for hire', target_page: '/hire-a-professional-photographer-in-coventry' },
  { cluster_id: 'COMMERCIAL-Local-product', rep: 'product photography', target_page: '/professional-commercial-photographer-coventry', split: 'product' },
  { cluster_id: 'COMMERCIAL-Local-property', rep: 'property photographer', target_page: '/property-photographer-coventry' },
  { cluster_id: 'COURSES-Local-beginners', rep: 'beginners photography classes', target_page: '/beginners-photography-classes' },
  { cluster_id: 'COURSES-Local-editing', rep: 'photo editing course', target_page: '/photo-editing-course-coventry' },
  { cluster_id: 'COURSES-Local-general', rep: 'photography courses coventry', target_page: '/photography-courses-coventry' },
  { cluster_id: 'COURSES-Local-private', rep: 'private photography lessons', target_page: '/private-photography-lessons' },
  { cluster_id: 'COURSES-National-online', rep: 'online photography course', target_page: '/free-online-photography-course' },
  { cluster_id: 'GIFTS-National', rep: 'photography gift vouchers', target_page: '/photography-gift-vouchers' },
  { cluster_id: 'HOLIDAYS-National', rep: 'photography holidays uk', target_page: '/photography-workshops-near-me' },
  { cluster_id: 'MENTORING-National', rep: 'photography mentoring', target_page: '/rps-courses-mentoring-distinctions' },
  { cluster_id: 'WORKSHOPS-National-general', rep: 'photography workshops uk', target_page: '/photography-workshops' },
  { cluster_id: 'WORKSHOPS-National-landscape', rep: 'landscape photography workshops uk', target_page: '/landscape-photography-workshops' },
];

const PRODUCT_THEME_RE = /\b(product|packshot|ecommerce)\b|food\s*photo/i;

export function isProductThemeKeyword(keyword) {
  return PRODUCT_THEME_RE.test(String(keyword || ''));
}

/** @param {object} row locked-config row */
export function rowBelongsToCluster(row, cluster) {
  if (!row?.target_page || row.target_page !== cluster.target_page) return false;
  if (cluster.split === 'product') return isProductThemeKeyword(row.keyword);
  if (cluster.split === 'general') return !isProductThemeKeyword(row.keyword);
  return true;
}

export function clusterMembers(lockedRows, cluster) {
  return lockedRows
    .filter((r) => rowBelongsToCluster(r, cluster))
    .map((r) => r.keyword)
    .sort((a, b) => a.localeCompare(b));
}

export function sortedClusterTaxonomy() {
  return [...LLM_CLUSTER_TAXONOMY].sort((a, b) => a.cluster_id.localeCompare(b.cluster_id));
}

/**
 * Schema QA gate evaluation (pure).
 * Service: per full entity (id-only refs skipped).
 * Other types: HEAD type-group behaviour (any same-type node may supply a field).
 */

const QA_DATE_FIELDS = ['datePublished', 'dateModified', 'startDate', 'endDate', 'validFrom', 'validThrough'];
const QA_REQUIRED_FIELDS_BY_TYPE = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'address', 'telephone'],
  Product: ['name', 'offers'],
  Event: ['name', 'startDate', 'location'],
  FAQPage: ['mainEntity'],
  Service: ['name', 'provider']
};
const QA_SUPPORTED_TYPES = new Set(Object.keys(QA_REQUIRED_FIELDS_BY_TYPE));
const QA_OPTIONAL_ID_TYPES = new Set(['FAQPage', 'Organization']);
const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
const QA_MAX_ISSUES_PER_ROW = 50;

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getPathValue(obj, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => {
      if (!acc || typeof acc !== 'object') return undefined;
      return acc[key];
    }, obj);
}

function isValidIsoDateString(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!ISO_DATE_ONLY_PATTERN.test(normalized) && !ISO_DATE_TIME_PREFIX_PATTERN.test(normalized)) {
    return false;
  }
  return !Number.isNaN(Date.parse(normalized));
}

/** True when node is only a pointer (@id [+ @type]) — not a full entity to validate. */
function isIdOnlySchemaReference(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const atId = typeof node['@id'] === 'string' ? node['@id'].trim() : '';
  if (!atId) return false;
  const keys = Object.keys(node).filter((key) => {
    if (String(key).startsWith('_')) return false;
    if (key === '@context') return false;
    return true;
  });
  return keys.every((key) => key === '@id' || key === '@type');
}

function collectTypedNodes(node, bucket = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return bucket;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypedNodes(item, bucket, depth + 1));
    return bucket;
  }

  const atType = node['@type'];
  if (atType) {
    const typeValues = Array.isArray(atType) ? atType : [atType];
    typeValues
      .filter((typeName) => typeof typeName === 'string' && typeName.trim())
      .forEach((typeName) => {
        bucket.push({ type: typeName.trim(), node });
      });
  }

  Object.keys(node).forEach((key) => {
    if (key === '@type') return;
    collectTypedNodes(node[key], bucket, depth + 1);
  });
  return bucket;
}

function isServiceIntentUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (!pathname || pathname === '/') return false;
    return (
      pathname.includes('/photo-workshops-uk')
      || pathname.includes('/macro-workshops-uk')
      || pathname.includes('/photography-services-near-me')
    );
  } catch {
    return false;
  }
}

function shouldEvaluateQaTypeForTier(typeName, pageTier, pageUrl) {
  if (typeName === 'Service') {
    return isServiceIntentUrl(pageUrl) || pageTier === 'product';
  }
  return true;
}

function detailForMissingField(typeName, fieldPath) {
  if (typeName === 'Service' && fieldPath === 'name') {
    return 'Service.name is missing (block). Full Service entity needs a name.';
  }
  if (typeName === 'Service' && fieldPath === 'provider') {
    return 'Service.provider is missing (block).';
  }
  return `${typeName}: missing required field "${fieldPath}"`;
}

function detailForMissingId(typeName) {
  if (typeName === 'Service') {
    return 'Service.@id is missing (warning). Schema entity id — not the HTML canonical.';
  }
  return `${typeName}: missing @id`;
}

function detailForNonAbsoluteId(typeName) {
  if (typeName === 'Service') {
    return 'Service.@id is not an absolute URL (warning). Schema entity id — not the HTML canonical.';
  }
  return `${typeName}: @id is not absolute URL`;
}

function skippedServiceReason() {
  return 'Service present but not scored on this page type (workshop/service-intent or product tier only).';
}

function filterActionableSchemaNodes(schemaNodes = []) {
  return (Array.isArray(schemaNodes) ? schemaNodes : []).filter((schemaNode) => {
    if (!schemaNode || typeof schemaNode !== 'object') return false;
    return schemaNode._recovered !== true && schemaNode._parseError !== true;
  });
}

/** HEAD behaviour: field/id/date satisfied if any actionable same-type node has it. */
function evaluateTypedSchemaTypeGroupLegacy(typeName, actionableNodes = []) {
  const issues = [];
  const requiredFields = QA_REQUIRED_FIELDS_BY_TYPE[typeName] || [];
  if (!actionableNodes.length) return issues;

  requiredFields.forEach((fieldPath) => {
    const hasFieldInAnyNode = actionableNodes.some((schemaNode) => hasValue(getPathValue(schemaNode, fieldPath)));
    if (!hasFieldInAnyNode) {
      issues.push({
        severity: 'block_deploy',
        code: 'missing_required_field',
        detail: `${typeName}: missing required field "${fieldPath}"`,
        typeName,
        fieldPath
      });
    }
  });

  const idValues = actionableNodes
    .map((schemaNode) => (typeof schemaNode?.['@id'] === 'string' ? schemaNode['@id'].trim() : ''))
    .filter(Boolean);
  const hasAnyId = idValues.length > 0;
  const hasAnyAbsoluteId = idValues.some((atId) => /^https?:\/\//i.test(atId));
  const idRequiredForType = !QA_OPTIONAL_ID_TYPES.has(typeName);

  if (!hasAnyId && idRequiredForType) {
    issues.push({
      severity: 'warning',
      code: 'missing_id',
      detail: `${typeName}: missing @id`,
      typeName,
      fieldPath: '@id'
    });
  } else if (!hasAnyAbsoluteId && idRequiredForType) {
    issues.push({
      severity: 'warning',
      code: 'non_absolute_id',
      detail: `${typeName}: @id is not absolute URL`,
      typeName,
      fieldPath: '@id'
    });
  }

  QA_DATE_FIELDS.forEach((dateField) => {
    const dateValues = actionableNodes
      .map((schemaNode) => getPathValue(schemaNode, dateField))
      .filter((rawDate) => hasValue(rawDate) && typeof rawDate === 'string');
    if (!dateValues.length) return;
    const hasValidDate = dateValues.some((rawDate) => isValidIsoDateString(rawDate));
    if (!hasValidDate) {
      issues.push({
        severity: 'block_deploy',
        code: 'invalid_iso_date',
        detail: `${typeName}: "${dateField}" is not valid ISO date`,
        typeName,
        fieldPath: dateField
      });
    }
  });

  return issues;
}

/** Service only: each full entity checked; id-only references skipped. */
function evaluateServiceEntitiesPerNode(entityNodes = []) {
  const issues = [];
  const requiredFields = QA_REQUIRED_FIELDS_BY_TYPE.Service || [];
  const typeName = 'Service';

  entityNodes.forEach((schemaNode) => {
    requiredFields.forEach((fieldPath) => {
      if (!hasValue(getPathValue(schemaNode, fieldPath))) {
        issues.push({
          severity: 'block_deploy',
          code: 'missing_required_field',
          detail: detailForMissingField(typeName, fieldPath),
          typeName,
          fieldPath
        });
      }
    });

    const atId = typeof schemaNode?.['@id'] === 'string' ? schemaNode['@id'].trim() : '';
    if (!atId) {
      issues.push({
        severity: 'warning',
        code: 'missing_id',
        detail: detailForMissingId(typeName),
        typeName,
        fieldPath: '@id'
      });
    } else if (!/^https?:\/\//i.test(atId)) {
      issues.push({
        severity: 'warning',
        code: 'non_absolute_id',
        detail: detailForNonAbsoluteId(typeName),
        typeName,
        fieldPath: '@id'
      });
    }

    QA_DATE_FIELDS.forEach((dateField) => {
      const rawDate = getPathValue(schemaNode, dateField);
      if (!hasValue(rawDate) || typeof rawDate !== 'string') return;
      if (isValidIsoDateString(rawDate)) return;
      issues.push({
        severity: 'block_deploy',
        code: 'invalid_iso_date',
        detail: `${typeName}: "${dateField}" is not valid ISO date`,
        typeName,
        fieldPath: dateField
      });
    });
  });

  return issues;
}

/**
 * Service → per-entity. Other types → HEAD type-group (any-node masking).
 */
function evaluateTypedSchemaTypeGroup(typeName, schemaNodes = []) {
  const actionableNodes = filterActionableSchemaNodes(schemaNodes);
  if (!actionableNodes.length) return [];

  if (typeName === 'Service') {
    const entityNodes = actionableNodes.filter((schemaNode) => !isIdOnlySchemaReference(schemaNode));
    if (!entityNodes.length) return [];
    return evaluateServiceEntitiesPerNode(entityNodes);
  }

  return evaluateTypedSchemaTypeGroupLegacy(typeName, actionableNodes);
}

function buildSchemaQaGate(results = [], source = 'unknown', mode = 'full', tier = 'all', tierLookup = null, getTierForUrl = null) {
  const resolveTier = typeof getTierForUrl === 'function'
    ? getTierForUrl
    : () => 'unmapped';

  const rows = results.map((result) => {
    const pageUrl = result?.url || '';
    const pageTier = resolveTier(pageUrl, tierLookup);
    const pageIssues = [];
    const notEvaluated = [];

    if (!result?.success) {
      pageIssues.push({
        severity: 'warning',
        code: 'crawl_failed',
        detail: `Crawl failed: ${result?.error || 'Unknown error'}`,
        typeName: 'Crawler',
        fieldPath: null
      });
    } else if (!Array.isArray(result.schemas) || result.schemas.length === 0) {
      pageIssues.push({
        severity: 'block_deploy',
        code: 'missing_jsonld',
        detail: 'No JSON-LD schema detected on page HTML (static crawl).',
        typeName: 'Page',
        fieldPath: null
      });
    } else {
      const typedNodeMap = new Map();
      result.schemas.forEach((schemaBlock) => {
        collectTypedNodes(schemaBlock).forEach(({ type, node }) => {
          if (!QA_SUPPORTED_TYPES.has(type)) return;
          if (!typedNodeMap.has(type)) typedNodeMap.set(type, []);
          typedNodeMap.get(type).push(node);
        });
      });
      typedNodeMap.forEach((nodes, typeName) => {
        if (!shouldEvaluateQaTypeForTier(typeName, pageTier, pageUrl)) {
          if (typeName === 'Service') {
            notEvaluated.push({ typeName, reason: skippedServiceReason() });
          }
          return;
        }
        pageIssues.push(...evaluateTypedSchemaTypeGroup(typeName, nodes));
      });
    }

    const dedupedIssues = [];
    const seenIssueKeys = new Set();
    pageIssues.forEach((issue) => {
      const issueKey = `${issue.severity}|${issue.code}|${issue.detail}`;
      if (seenIssueKeys.has(issueKey)) return;
      seenIssueKeys.add(issueKey);
      dedupedIssues.push(issue);
    });

    const blockIssues = dedupedIssues.filter((issue) => issue.severity === 'block_deploy');
    const warningIssues = dedupedIssues.filter((issue) => issue.severity === 'warning');
    let status = 'pass';
    if (blockIssues.length > 0) status = 'block_deploy';
    else if (warningIssues.length > 0) status = 'warning';

    let summary = 'Schema QA checks passed';
    if (dedupedIssues.length > 0) {
      summary = dedupedIssues.slice(0, 3).map((issue) => issue.detail).join(' | ');
    } else if (notEvaluated.length > 0) {
      summary = notEvaluated.map((item) => item.reason).join(' | ');
    }

    return {
      url: pageUrl,
      pageTier,
      statusCode: Number.isFinite(result?.statusCode) ? result.statusCode : null,
      status,
      blockIssueCount: blockIssues.length,
      warningIssueCount: warningIssues.length,
      summary,
      issueCodes: [...new Set(dedupedIssues.map((issue) => issue.code))],
      issueDetails: dedupedIssues.slice(0, QA_MAX_ISSUES_PER_ROW).map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        detail: issue.detail,
        typeName: issue.typeName || null,
        fieldPath: issue.fieldPath || null
      })),
      issueDetailsTruncated: dedupedIssues.length > QA_MAX_ISSUES_PER_ROW,
      notEvaluated: notEvaluated.length ? notEvaluated : undefined
    };
  });

  const pagesChecked = rows.length;
  const blockPages = rows.filter((row) => row.status === 'block_deploy').length;
  const warningPages = rows.filter((row) => row.status === 'warning').length;
  const passPages = rows.filter((row) => row.status === 'pass').length;
  const passRate = pagesChecked > 0 ? Math.round((passPages / pagesChecked) * 100) : 0;

  return {
    source,
    mode,
    tier,
    pagesChecked,
    passPages,
    warningPages,
    blockPages,
    passRate,
    rows
  };
}

export {
  QA_REQUIRED_FIELDS_BY_TYPE,
  QA_SUPPORTED_TYPES,
  isIdOnlySchemaReference,
  isServiceIntentUrl,
  shouldEvaluateQaTypeForTier,
  evaluateTypedSchemaTypeGroup,
  evaluateTypedSchemaTypeGroupLegacy,
  collectTypedNodes,
  buildSchemaQaGate
};

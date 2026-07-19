export const config = { runtime: 'nodejs' };

import {
  fetchLatestIntegrityRun,
  runIntegrityCheck,
  PROPERTY
} from '../../lib/configIntegrity/runIntegrityCheck.mjs';

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function formatPayload(run) {
  if (!run) {
    return {
      latestRun: null,
      stats: { findingCount: 0, structuralCount: 0, advisoryCount: 0 },
      findings: [],
      chipRag: 'green'
    };
  }
  const findings = Array.isArray(run.findings) ? run.findings : [];
  const stats = run.stats && typeof run.stats === 'object'
    ? run.stats
    : {
      findingCount: run.finding_count || findings.length,
      structuralCount: run.structural_count || 0,
      advisoryCount: Math.max(0, (run.finding_count || findings.length) - (run.structural_count || 0))
    };
  return {
    latestRun: {
      id: run.id,
      run_at: run.run_at,
      run_source: run.run_source,
      chip_rag: run.chip_rag
    },
    stats,
    findings,
    chipRag: run.chip_rag || 'green'
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  const propertyUrl = String(req.query?.propertyUrl || req.body?.propertyUrl || PROPERTY).trim() || PROPERTY;

  try {
    if (req.method === 'POST') {
      const runSource = String(req.body?.runSource || req.query?.runSource || 'api_post').trim();
      const result = await runIntegrityCheck({ propertyUrl, runSource, persist: true });
      return sendJson(res, 200, {
        status: 'ok',
        data: formatPayload(result.latestRun),
        meta: { generatedAt: new Date().toISOString(), triggered: true }
      });
    }

    if (req.method !== 'GET') {
      return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET or POST.' });
    }

    const latest = await fetchLatestIntegrityRun({ propertyUrl });
    if (latest) {
      return sendJson(res, 200, {
        status: 'ok',
        data: formatPayload(latest),
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    return sendJson(res, 200, {
      status: 'ok',
      data: formatPayload(null),
      meta: {
        generatedAt: new Date().toISOString(),
        warning: 'No config_integrity_runs yet — POST to run first check'
      }
    });
  } catch (error) {
    const msg = String(error?.message || error);
    if (msg.includes('does not exist') || msg.includes('config_integrity_runs')) {
      return sendJson(res, 200, {
        status: 'ok',
        data: formatPayload(null),
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'Apply migrations/20260719_config_integrity_runs.sql then POST to run'
        }
      });
    }
    return sendJson(res, 500, { status: 'error', message: msg });
  }
}

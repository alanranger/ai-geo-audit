/**
 * One honest result for the channels audit (dashboard modal; also loaded by tests). Each pull either worked or is a
 * problem with its plain reason; the run is "complete" only when every pull worked.
 */
(function () {
  function stepReason(r) {
    if (!r) return 'did not run';
    return r.plain || r.error || r.error_message || 'failed';
  }

  function problemText(p) {
    return /^[A-Z][\w ]{1,30}: /.test(p.reason) ? p.reason : `${p.label} (${p.reason})`;
  }

  function acqAuditOutcome(labels, results) {
    const problems = [];
    (labels || []).forEach((label, i) => {
      const r = (results || [])[i];
      if (!r || r.ok === false) problems.push({ label, reason: stepReason(r) });
    });
    if (!problems.length) return { ok: true, title: 'Channels audit complete', line: 'Channels audit complete', problems };
    const title = `Done with ${problems.length} problem${problems.length === 1 ? '' : 's'}`;
    return { ok: false, title, line: `${title}: ${problems.map(problemText).join('; ')}`, problems };
  }

  globalThis.acqAuditOutcome = acqAuditOutcome;
})();

/**
 * Quarter actions with an evidence rule tick themselves from that evidence (Alan, 8 Nov 2026: tick automatically where
 * the dashboard can see evidence; manual ticks only for things it can't see). For those actions
 * strategy_quarter_actions.is_ticked / ticked_at are derived on every summary read: ticked from the first collected
 * Squarespace send report that matches the rule, unticked while there is none. A schedule, a draft or a provider id is
 * never evidence: only a row in sqs_email_campaigns (collected send reports) dated in the past with recipients.
 * Only is_ticked and ticked_at are written; no other column changes. api/aigeo/strategy-actions.js refuses manual
 * ticks on these actions.
 */

export const QUARTER_EVIDENCE = [
  {
    id: 'pick-n-mix-launch', action_keys: ['q1-pnm-newsletter'], action: /pick\s*['’]?\s*n\s*['’]?\s*mix.*(launch|newsletter)/i,
    subject: /pick\s*['’]?\s*n\s*['’]?\s*mix/i, campaign_key: 'theme|pick-n-mix-kick-starter-2026-11', from: '2026-11-10',
    label: 'the Pick n Mix relaunch Squarespace email, collected as sent (on or after Tue 10 Nov)'
  }
];

/** The rule for an action (by its stable action_key, else its label / step text), or null = ticked by hand. */
export function evidenceRuleFor(a) {
  const text = String(a?.label || a?.step || '');
  return QUARTER_EVIDENCE.find((r) => r.action_keys.includes(a?.action_key)) || QUARTER_EVIDENCE.find((r) => r.action.test(text)) || null;
}
/** A collected send report: dated now or earlier and sent to at least one recipient. */
export function isSentReport(c, nowIso) {
  const d = String(c?.sent_at || c?.sent_on || '');
  return !!d && d <= nowIso && (Number(c.message_count) > 0 || Number(c.delivered) > 0);
}
const linkedElsewhere = (c, rule) => !!c.campaign_key && c.campaign_key !== rule.campaign_key;
const ruleMatch = (c, rule) => c.campaign_key === rule.campaign_key || (rule.subject.test(c.subject || '') && !linkedElsewhere(c, rule));
/** First matching send report on or after the rule's day. */
export function evidenceHit(rule, sqs, nowIso) {
  return (sqs || []).filter((c) => isSentReport(c, nowIso) && String(c.sent_on).slice(0, 10) >= rule.from && ruleMatch(c, rule))
    .sort((a, b) => String(a.sent_on).localeCompare(String(b.sent_on)))[0] || null;
}
/** Derived tick for an evidence-ruled action; null when the action has no rule (manual). */
export function evidenceTick(a, sqs, nowIso) {
  const rule = evidenceRuleFor(a);
  if (!rule) return null;
  const hit = evidenceHit(rule, sqs, nowIso);
  return { rule, hit, is_ticked: !!hit, ticked_at: hit ? new Date(hit.sent_at || hit.sent_on).toISOString() : null };
}
/** Rows whose stored tick disagrees with the evidence: { id, before, after } with only is_ticked / ticked_at. */
export function tickChanges(actions, sqs, nowIso) {
  const out = [];
  for (const a of actions || []) {
    const d = evidenceTick(a, sqs, nowIso);
    if (!d || !!a.is_ticked === d.is_ticked) continue;
    out.push({ id: a.id, action_key: a.action_key, before: { is_ticked: !!a.is_ticked, ticked_at: a.ticked_at || null }, after: { is_ticked: d.is_ticked, ticked_at: d.ticked_at } });
  }
  return out;
}
/** `evidence` on each ruled action: what it waits for, or the send that ticked it. */
export function annotateEvidence(actions, sqs, nowIso) {
  return (actions || []).map((a) => {
    const d = evidenceTick(a, sqs, nowIso);
    if (!d) return a;
    const sent = d.hit ? { email_id: d.hit.email_id, subject: d.hit.subject, sent_on: d.hit.sent_on } : null;
    return { ...a, evidence: { rule: d.rule.id, label: d.rule.label, from: d.rule.from, state: d.hit ? 'done' : 'waiting', sent } };
  });
}

async function sentReports(supabase, from) {
  const { data, error } = await supabase.from('sqs_email_campaigns').select('email_id, subject, sent_on, message_count, delivered, campaign_key')
    .gte('sent_on', from).order('sent_on', { ascending: true }).limit(500);
  return error ? null : (data || []);
}
/** Actions for the summary / API, with evidence-ruled ticks brought in line (only is_ticked + ticked_at written). */
export async function loadActionsWithEvidence(supabase, propertyUrl, now = new Date()) {
  const { data, error } = await supabase.from('strategy_quarter_actions').select('*').eq('property_url', propertyUrl).order('quarter_key').order('sort_order');
  if (error) throw error;
  const actions = data || [];
  const ruled = actions.filter((a) => evidenceRuleFor(a));
  if (!ruled.length) return actions;
  const sqs = await sentReports(supabase, ruled.map((a) => evidenceRuleFor(a).from).sort()[0]);
  if (!sqs) return actions;
  const nowIso = now.toISOString();
  for (const ch of tickChanges(ruled, sqs, nowIso)) {
    const { error: e2 } = await supabase.from('strategy_quarter_actions').update(ch.after).eq('id', ch.id).eq('property_url', propertyUrl);
    if (!e2) Object.assign(actions.find((a) => a.id === ch.id), ch.after);
  }
  return annotateEvidence(actions, sqs, nowIso);
}

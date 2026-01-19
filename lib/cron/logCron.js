import { createClient } from '@supabase/supabase-js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    throw new Error(`missing_env:${key}`);
  }
  return value;
};

const buildMessage = ({ jobKey, status, propertyUrl, durationMs, details }) => {
  return JSON.stringify({
    cronJob: jobKey,
    status,
    propertyUrl: propertyUrl || null,
    durationMs: durationMs ?? null,
    details: details || null
  });
};

const resolveType = (status) => {
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'success' || status === 'ok') return 'success';
  return 'info';
};

export const logCronEvent = async ({ jobKey, status, propertyUrl, durationMs, details }) => {
  try {
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    await supabase.from('debug_logs').insert({
      timestamp: new Date().toISOString(),
      type: resolveType(status),
      message: buildMessage({ jobKey, status, propertyUrl, durationMs, details }),
      property_url: propertyUrl || null
    });
  } catch (err) {
    console.warn('[logCronEvent] Failed to write debug log:', err.message);
  }
};

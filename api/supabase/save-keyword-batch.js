/**
 * Save a batch of keyword rankings incrementally to Supabase
 * This allows partial results to be saved even if later batches fail
 */

import { resolveTrackingLocation } from '../../lib/keyword-ranking/tracking-location.js';
import { resolveKeywordClass } from '../../lib/keyword-ranking/tracking-class.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { keywordRows, auditDate, propertyUrl } = req.body;

    if (!keywordRows || !Array.isArray(keywordRows) || keywordRows.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'keywordRows must be a non-empty array',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    if (!auditDate || !propertyUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: auditDate, propertyUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Process each row: try PATCH (update) first, then POST (insert) if it doesn't exist
    let savedCount = 0;
    let errors = [];

    for (const row of keywordRows) {
      // Ensure required fields for unique constraint are present
      if (!row.audit_date || !row.property_url || !row.keyword) {
        errors.push(`Row missing required fields: ${JSON.stringify(row)}`);
        continue;
      }

      // Never leave location_name NULL on new/updated rows — NULL is legacy only.
      if (!row.location_name) {
        const loc = resolveTrackingLocation(row.keyword);
        row.location_name = loc.location_name;
        row.location_unmapped = loc.unmapped === true;
      }
      // Always stamp locked class (lookup-only).
      if (!row.keyword_class) {
        const cls = resolveKeywordClass(row.keyword);
        row.keyword_class = cls.keyword_class;
        row.class_unmapped = cls.class_unmapped;
      }

      // Try to update existing row first using PATCH
      const filterParams = new URLSearchParams({
        audit_date: `eq.${row.audit_date}`,
        property_url: `eq.${row.property_url}`,
        keyword: `eq.${row.keyword}`
      });

      const patchResponse = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings?${filterParams}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(row)
      });

      if (patchResponse.ok) {
        const patchText = await patchResponse.text();
        const patchResult = patchText ? JSON.parse(patchText) : [];
        if (patchResult.length > 0) {
          savedCount++;
          continue; // Successfully updated, move to next row
        }
      }

      // If PATCH didn't update anything (row doesn't exist), try POST (insert)
      const postResponse = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(row)
      });

      if (postResponse.ok) {
        savedCount++;
      } else {
        const errorText = await postResponse.text();
        // If it's a duplicate key error (409), that's okay - row already exists and was updated by PATCH
        if (postResponse.status === 409) {
          savedCount++; // Count as saved since it exists
        } else {
          errors.push(`Failed to save keyword "${row.keyword}": ${postResponse.status} - ${errorText}`);
        }
      }
    }

    if (savedCount > 0) {
      console.log(`[Save Keyword Batch] ✓ Successfully saved ${savedCount}/${keywordRows.length} keyword rows`);
      
      return res.status(200).json({
        status: 'ok',
        message: 'Keyword batch saved successfully',
        data: {
          saved: savedCount,
          attempted: keywordRows.length,
          errors: errors.length > 0 ? errors : undefined
        },
        meta: { generatedAt: new Date().toISOString() }
      });
    } else {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to save any keyword rows',
        details: errors.length > 0 ? errors.join('; ') : 'Unknown error',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
  } catch (error) {
    console.error('[Save Keyword Batch] Exception:', error.message);
    console.error('[Save Keyword Batch] Stack:', error.stack);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}



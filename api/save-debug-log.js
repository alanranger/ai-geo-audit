/**
 * Save Debug Log API
 * 
 * Saves debug logs from audit runs to a file in the repo for easy access
 * Uses GitHub API to create/update files in the repository
 */

import fs from 'fs';
import path from 'path';

const GITHUB_OWNER = 'alanranger';
const GITHUB_REPO = 'ai-geo-audit';
const GITHUB_BRANCH = 'main';

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
      source: 'save-debug-log',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { propertyUrl, auditDate, debugLogEntries } = req.body;
    
    if (!debugLogEntries || !Array.isArray(debugLogEntries)) {
      return res.status(400).json({
        status: 'error',
        source: 'save-debug-log',
        message: 'Missing or invalid debugLogEntries array',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Generate filename with timestamp
    const timestamp = auditDate || new Date().toISOString().split('T')[0];
    const propertySlug = propertyUrl 
      ? propertyUrl.replace(/https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').toLowerCase()
      : 'unknown';
    const filename = `debug-log-${propertySlug}-${timestamp}.txt`;
    const filepath = `debug-logs/${filename}`;
    
    // Format log entries
    const logText = debugLogEntries.map(entry => 
      `[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}`
    ).join('\n');
    
    // Add header
    const header = `=== DEBUG LOG ===
Property URL: ${propertyUrl || 'N/A'}
Audit Date: ${timestamp}
Total Entries: ${debugLogEntries.length}
Generated: ${new Date().toISOString()}

`;
    
    const fullLogText = header + logText;
    const contentBase64 = Buffer.from(fullLogText, 'utf8').toString('base64');
    
    // Try GitHub API first (for production/Vercel)
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      try {
        // Check if file exists to get SHA for update
        let fileSha = null;
        try {
          const getFileResponse = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filepath}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            }
          );
          
          if (getFileResponse.ok) {
            const fileData = await getFileResponse.json();
            fileSha = fileData.sha;
          }
        } catch (e) {
          // File doesn't exist, will create new
        }
        
        // Create or update file via GitHub API
        const githubResponse = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filepath}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `token ${githubToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: `Save debug log: ${filename}`,
              content: contentBase64,
              branch: GITHUB_BRANCH,
              ...(fileSha ? { sha: fileSha } : {})
            })
          }
        );
        
        if (githubResponse.ok) {
          const result = await githubResponse.json();
          console.log(`[save-debug-log] Saved debug log to GitHub: ${filepath} (${debugLogEntries.length} entries)`);
          
          return res.status(200).json({
            status: 'ok',
            source: 'save-debug-log',
            message: 'Debug log saved successfully to GitHub',
            data: {
              filename,
              filepath,
              entriesCount: debugLogEntries.length,
              timestamp,
              githubUrl: result.content.html_url
            },
            meta: {
              generatedAt: new Date().toISOString(),
              propertyUrl: propertyUrl || 'N/A',
              method: 'github'
            }
          });
        } else {
          const errorText = await githubResponse.text();
          console.error(`[save-debug-log] GitHub API error: ${githubResponse.status} - ${errorText}`);
          throw new Error(`GitHub API failed: ${githubResponse.status}`);
        }
      } catch (githubError) {
        console.error('[save-debug-log] GitHub API error:', githubError);
        // Fall through to file system write for local dev
      }
    }
    
    // Fallback: Try file system write (for local development)
    try {
      const debugLogsDir = path.join(process.cwd(), 'debug-logs');
      if (!fs.existsSync(debugLogsDir)) {
        fs.mkdirSync(debugLogsDir, { recursive: true });
      }
      
      const localFilepath = path.join(debugLogsDir, filename);
      fs.writeFileSync(localFilepath, fullLogText, 'utf8');
      
      console.log(`[save-debug-log] Saved debug log to local file: ${localFilepath} (${debugLogEntries.length} entries)`);
      
      return res.status(200).json({
        status: 'ok',
        source: 'save-debug-log',
        message: 'Debug log saved successfully to local file',
        data: {
          filename,
          filepath: localFilepath.replace(process.cwd(), ''),
          entriesCount: debugLogEntries.length,
          timestamp
        },
        meta: {
          generatedAt: new Date().toISOString(),
          propertyUrl: propertyUrl || 'N/A',
          method: 'local'
        }
      });
    } catch (fsError) {
      console.error('[save-debug-log] File system error:', fsError);
      throw new Error(`Failed to save debug log: ${fsError.message}`);
    }
    
  } catch (error) {
    console.error('[save-debug-log] Error:', error);
    return res.status(500).json({
      status: 'error',
      source: 'save-debug-log',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}


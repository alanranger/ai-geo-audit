// API endpoint to get the previous commit hash (one version back from current)
// This is used by the version pill to show the deployed version

import { execSync } from 'child_process';

export default async function handler(req, res) {
  try {
    // Get previous commit hash (HEAD~1)
    const previousCommit = execSync('git rev-parse HEAD~1', { encoding: 'utf-8' }).trim();
    const shortHash = previousCommit.substring(0, 7);
    
    return res.status(200).json({
      status: 'ok',
      commitHash: shortHash,
      fullHash: previousCommit
    });
  } catch (error) {
    // Fallback if git command fails (e.g., in production without git)
    console.warn('[Git API] Error getting previous commit:', error.message);
    return res.status(200).json({
      status: 'ok',
      commitHash: '3eae317', // Fallback to known previous commit
      fullHash: null,
      error: 'Git command failed, using fallback'
    });
  }
}

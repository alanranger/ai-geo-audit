// API endpoint to get the previous commit hash (one version back from current)
// This is used by the version pill to show the deployed version
// Uses Vercel API to get the previous deployment's commit hash

export default async function handler(req, res) {
  try {
    // Get current deployment's commit from environment variable
    const currentCommit = process.env.VERCEL_GIT_COMMIT_SHA;
    
    // Try to get previous deployment from Vercel API
    const vercelToken = process.env.VERCEL_TOKEN || process.env.VERCEL_AUTH_TOKEN;
    const vercelTeamId = process.env.VERCEL_TEAM_ID;
    const vercelProjectId = process.env.VERCEL_PROJECT_ID;
    
    if (vercelToken && vercelProjectId) {
      try {
        // Get deployments for this project
        const teamParam = vercelTeamId ? `?teamId=${vercelTeamId}` : '';
        const deploymentsUrl = `https://api.vercel.com/v6/deployments${teamParam}`;
        
        const deploymentsResponse = await fetch(deploymentsUrl, {
          headers: {
            'Authorization': `Bearer ${vercelToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (deploymentsResponse.ok) {
          const deploymentsData = await deploymentsResponse.json();
          
          // Filter to this project and production deployments
          const projectDeployments = deploymentsData.deployments
            ?.filter(d => d.projectId === vercelProjectId && d.target === 'production')
            ?.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) || [];
          
          // Get the second deployment (one deployment ago)
          if (projectDeployments.length > 1) {
            const previousDeployment = projectDeployments[1];
            const previousCommit = previousDeployment.meta?.git?.commitSha || previousDeployment.meta?.githubCommitSha;
            
            if (previousCommit) {
              const shortHash = previousCommit.substring(0, 7);
              return res.status(200).json({
                status: 'ok',
                commitHash: shortHash,
                fullHash: previousCommit,
                source: 'vercel_api'
              });
            }
          }
        }
      } catch (vercelApiError) {
        console.warn('[Git API] Vercel API call failed:', vercelApiError.message);
      }
    }
    
    // Fallback 1: Try git command if available
    try {
      const { execSync } = require('child_process');
      const previousCommit = execSync('git rev-parse HEAD~1', { encoding: 'utf-8' }).trim();
      const shortHash = previousCommit.substring(0, 7);
      
      return res.status(200).json({
        status: 'ok',
        commitHash: shortHash,
        fullHash: previousCommit,
        source: 'git_command'
      });
    } catch (gitError) {
      console.warn('[Git API] Git command failed:', gitError.message);
    }
    
    // Fallback 2: Use hardcoded previous commit (will be updated with each deployment)
    // This should be the commit that was deployed before the current one
    return res.status(200).json({
      status: 'ok',
      commitHash: '497151d', // Updated to one deployment ago (497151d is before 923d567)
      fullHash: null,
      source: 'fallback',
      currentCommit: currentCommit,
      note: 'Using fallback - update this value with each deployment or configure VERCEL_TOKEN'
    });
  } catch (error) {
    // Final fallback
    console.error('[Git API] Error getting previous commit:', error);
    return res.status(200).json({
      status: 'ok',
      commitHash: '497151d', // One deployment ago
      fullHash: null,
      error: error.message,
      source: 'error_fallback'
    });
  }
}

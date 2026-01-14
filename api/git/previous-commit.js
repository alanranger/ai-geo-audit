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
    const vercelProjectName = process.env.VERCEL_PROJECT_NAME || 'ai-geo-audit';
    
    if (vercelToken) {
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
          // Try projectId first, then fall back to project name
          let projectDeployments = deploymentsData.deployments || [];
          
          if (vercelProjectId) {
            projectDeployments = projectDeployments.filter(d => d.projectId === vercelProjectId);
          } else {
            // Filter by project name (name field in deployment)
            projectDeployments = projectDeployments.filter(d => 
              d.name === vercelProjectName || 
              d.project?.name === vercelProjectName ||
              d.url?.includes(vercelProjectName.replace('_', '-'))
            );
          }
          
          // Filter to production deployments only
          projectDeployments = projectDeployments
            .filter(d => d.target === 'production' || !d.target) // Include deployments without target (defaults to production)
            .sort((a, b) => new Date(b.createdAt || b.created) - new Date(a.createdAt || a.created));
          
          // Get the second deployment (one deployment ago)
          if (projectDeployments.length > 1) {
            const previousDeployment = projectDeployments[1];
            const previousCommit = previousDeployment.meta?.git?.commitSha || 
                                   previousDeployment.meta?.githubCommitSha ||
                                   previousDeployment.meta?.gitCommitSha ||
                                   previousDeployment.gitSource?.sha;
            
            if (previousCommit) {
              const shortHash = previousCommit.substring(0, 7);
              console.log(`[Git API] Found previous deployment commit: ${shortHash} from Vercel API`);
              return res.status(200).json({
                status: 'ok',
                commitHash: shortHash,
                fullHash: previousCommit,
                source: 'vercel_api'
              });
            }
          } else {
            console.warn(`[Git API] Found ${projectDeployments.length} production deployments, need at least 2`);
          }
        } else {
          const errorText = await deploymentsResponse.text();
          console.warn(`[Git API] Vercel API returned ${deploymentsResponse.status}: ${errorText}`);
        }
      } catch (vercelApiError) {
        console.warn('[Git API] Vercel API call failed:', vercelApiError.message);
      }
    } else {
      console.warn('[Git API] VERCEL_TOKEN not found, skipping Vercel API call');
    }
    
    // Note: Git command fallback removed - Vercel API is the primary method
    // Git commands may not be available in Vercel's serverless environment
    
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

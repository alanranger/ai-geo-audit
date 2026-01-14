// API endpoint to get the current deployment's commit hash
// This is used by the version pill to show the deployed version
// Uses Vercel API to get the current deployment's commit hash, or falls back to VERCEL_GIT_COMMIT_SHA

export default async function handler(req, res) {
  try {
    // Get current deployment's commit from environment variable (most reliable)
    const currentCommit = process.env.VERCEL_GIT_COMMIT_SHA;
    
    // If we have the current commit from env, use it directly (fastest and most accurate)
    if (currentCommit) {
      const shortHash = currentCommit.substring(0, 7);
      // Get deployment timestamp from Vercel environment variables
      const deploymentTimestamp = process.env.VERCEL_DEPLOYMENT_DATE || 
                                   process.env.VERCEL_BUILD_DATE ||
                                   process.env.VERCEL_BUILT_AT ||
                                   new Date().toISOString(); // Fallback to current time
      console.log(`[Git API] Using current commit from VERCEL_GIT_COMMIT_SHA: ${shortHash}`);
      return res.status(200).json({
        status: 'ok',
        commitHash: shortHash,
        fullHash: currentCommit,
        deploymentTimestamp: deploymentTimestamp,
        source: 'vercel_env'
      });
    }
    
    // Fallback: Try to get current deployment from Vercel API
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
          
          // Get the first deployment (current/latest deployment)
          if (projectDeployments.length > 0) {
            const currentDeployment = projectDeployments[0];
            const deploymentCommit = currentDeployment.meta?.git?.commitSha || 
                                    currentDeployment.meta?.githubCommitSha ||
                                    currentDeployment.meta?.gitCommitSha ||
                                    currentDeployment.gitSource?.sha;
            
            if (deploymentCommit) {
              const shortHash = deploymentCommit.substring(0, 7);
              // Get deployment timestamp from the deployment object
              const deploymentTimestamp = currentDeployment.createdAt || 
                                         currentDeployment.created ||
                                         currentDeployment.readyAt ||
                                         new Date().toISOString();
              console.log(`[Git API] Found current deployment commit: ${shortHash} from Vercel API`);
              return res.status(200).json({
                status: 'ok',
                commitHash: shortHash,
                fullHash: deploymentCommit,
                deploymentTimestamp: deploymentTimestamp,
                source: 'vercel_api'
              });
            }
          } else {
            console.warn(`[Git API] Found ${projectDeployments.length} production deployments`);
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
    
    // Final fallback: Use hardcoded commit (should rarely be needed)
    return res.status(200).json({
      status: 'ok',
      commitHash: 'unknown', // No commit available
      fullHash: null,
      deploymentTimestamp: new Date().toISOString(), // Use current time as fallback
      source: 'fallback',
      currentCommit: currentCommit,
      note: 'No commit hash available - VERCEL_GIT_COMMIT_SHA not set and Vercel API unavailable'
    });
  } catch (error) {
    // Final fallback
    console.error('[Git API] Error getting current commit:', error);
    return res.status(200).json({
      status: 'ok',
      commitHash: 'unknown',
      fullHash: null,
      deploymentTimestamp: new Date().toISOString(), // Use current time as fallback
      error: error.message,
      source: 'error_fallback'
    });
  }
}

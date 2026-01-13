// Vercel Serverless Function: Analytics Endpoint
// This function provides a secure way to fetch analytics-related data
// Note: Vercel Web Analytics doesn't have a public API yet, but this endpoint
// can be extended when/if Vercel adds API support

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get Vercel API token from environment variable
  // This should be set in Vercel Dashboard → Project Settings → Environment Variables
  const vercelToken = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID || 'prj_vzX6BwWFDVWz08WNJWN1I9YBNHTC';
  const teamId = process.env.VERCEL_TEAM_ID || 'team_KggG73fuHIucvjQ85R6a3h17';

  // If no token is set, return a helpful message
  if (!vercelToken) {
    return res.status(200).json({
      success: false,
      message: 'Vercel API token not configured',
      instructions: [
        '1. Go to Vercel Dashboard → Settings → Tokens',
        '2. Create a new token with read access',
        '3. Add it as an environment variable: VERCEL_TOKEN',
        '4. Redeploy your project'
      ],
      note: 'Vercel Web Analytics does not currently have a public API for fetching metrics. Metrics are available in the Vercel Dashboard.'
    });
  }

  try {
    // Fetch project information
    const projectUrl = `https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`;
    const projectResponse = await fetch(projectUrl, {
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!projectResponse.ok) {
      throw new Error(`Vercel API error: ${projectResponse.status} ${projectResponse.statusText}`);
    }

    const projectData = await projectResponse.json();

    // Fetch recent deployments
    const deploymentsUrl = `https://api.vercel.com/v6/deployments?projectId=${projectId}&teamId=${teamId}&limit=5`;
    const deploymentsResponse = await fetch(deploymentsUrl, {
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json'
      }
    });

    let deployments = [];
    if (deploymentsResponse.ok) {
      const deploymentsData = await deploymentsResponse.json();
      deployments = deploymentsData.deployments || [];
    }

    // Return project info and deployment data
    // Note: Analytics metrics are not available via API yet
    return res.status(200).json({
      success: true,
      project: {
        id: projectData.id,
        name: projectData.name,
        createdAt: projectData.createdAt,
        updatedAt: projectData.updatedAt
      },
      deployments: deployments.map(dep => ({
        id: dep.uid,
        url: dep.url,
        state: dep.state,
        createdAt: dep.createdAt,
        readyAt: dep.readyAt
      })),
      analytics: {
        available: false,
        message: 'Vercel Web Analytics metrics are not available via API. View metrics in the Vercel Dashboard.',
        dashboardUrl: `https://vercel.com/dashboard/${teamId}/project/${projectId}/analytics`
      },
      note: 'To view detailed analytics, visit the Vercel Dashboard. Vercel may add API support for analytics in the future.'
    });

  } catch (error) {
    console.error('Analytics API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch project data. Check that VERCEL_TOKEN is set correctly.'
    });
  }
}

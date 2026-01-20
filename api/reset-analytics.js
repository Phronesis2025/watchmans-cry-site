// Vercel Serverless Function: Reset Analytics Data
// Deletes all data from analytics tables (admin only)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ikksmrbqrirvenqlylxo.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra3NtcmJxcmlydmVucWx5bHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODI5ODgsImV4cCI6MjA4Mzc1ODk4OH0.1pKE6_LFTii8R-xY8WvWlXR23mXW3sUpPpKniL9fFvc';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Verify Supabase authentication token
async function verifyAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  
  // Verify the token is valid using anon key client
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    console.error('Auth verification error:', error);
    return false;
  }
  
  return true;
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authentication
  const authHeader = req.headers.authorization;
  const isAuthenticated = await verifyAuth(authHeader);
  
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // CORS headers
  const origin = req.headers.origin || req.headers.referer;
  const allowedOrigins = [
    'https://www.watchmanscry.site',
    'https://watchmanscry.site',
    'http://localhost:8000',
    'http://localhost:3000'
  ];

  if (origin) {
    const isAllowed = allowedOrigins.some(allowed => origin.startsWith(allowed));
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Create Supabase client with service role key for admin operations
    let supabase;
    if (SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    } else {
      return res.status(500).json({ error: 'Service role key not configured' });
    }

    // Delete all data from analytics tables
    // Note: Using DELETE instead of TRUNCATE to respect RLS policies
    const [pageViewsResult, sessionsResult, rateLimitsResult] = await Promise.all([
      supabase.from('page_views').delete().neq('id', '00000000-0000-0000-0000-000000000000'), // Delete all
      supabase.from('visitor_sessions').delete().neq('session_id', ''), // Delete all
      supabase.from('rate_limits').delete().neq('hashed_ip', '') // Delete all
    ]);

    // Check for errors
    if (pageViewsResult.error) {
      console.error('Error deleting page_views:', pageViewsResult.error);
      return res.status(500).json({ error: 'Failed to delete page_views data' });
    }

    if (sessionsResult.error) {
      console.error('Error deleting visitor_sessions:', sessionsResult.error);
      return res.status(500).json({ error: 'Failed to delete visitor_sessions data' });
    }

    if (rateLimitsResult.error) {
      console.error('Error deleting rate_limits:', rateLimitsResult.error);
      // Rate limits deletion is optional, don't fail if it errors
    }

    return res.status(200).json({ 
      success: true,
      message: 'All analytics data has been reset',
      deleted: {
        page_views: 'all',
        visitor_sessions: 'all',
        rate_limits: 'all'
      }
    });

  } catch (error) {
    console.error('Reset analytics error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

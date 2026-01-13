// Vercel Serverless Function: Analytics Data Endpoint
// Returns aggregated analytics data for admin dashboard

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ikksmrbqrirvenqlylxo.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra3NtcmJxcmlydmVucWx5bHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODI5ODgsImV4cCI6MjA4Mzc1ODk4OH0.1pKE6_LFTii8R-xY8WvWlXR23mXW3sUpPpKniL9fFvc';
// Use service role key for admin queries (bypasses RLS)
// This is safe because we verify authentication before using it
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

// Get date filter based on period
function getDateFilter(period) {
  const now = new Date();
  let startDate = null;

  if (period === '7d') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === '30d') {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  // 'all' means no date filter

  return startDate ? startDate.toISOString() : null;
}

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
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
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  try {
    const { metric, period = '7d' } = req.query;

    if (!metric) {
      return res.status(400).json({ error: 'Metric parameter required' });
    }

    // Create Supabase client for queries
    // If service role key is available, use it (bypasses RLS - safe because we verified auth)
    // Otherwise, use anon key with user's token in headers (respects RLS)
    let supabase;
    if (SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    } else {
      // Fallback: use anon key with user's token
      const token = authHeader.substring(7);
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      });
    }
    
    const dateFilter = getDateFilter(period);

    let result = {};

    switch (metric) {
      case 'pageviews': {
        let query = supabase
          .from('page_views')
          .select('page_path', { count: 'exact' });

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        // Get total count
        const { count: total } = await query;

        // Get top pages
        let topPagesQuery = supabase
          .from('page_views')
          .select('page_path')
          .order('created_at', { ascending: false });

        if (dateFilter) {
          topPagesQuery = topPagesQuery.gte('created_at', dateFilter);
        }

        const { data: allPages } = await topPagesQuery;

        // Aggregate by page path
        const pageCounts = {};
        if (allPages) {
          allPages.forEach(page => {
            const path = page.page_path || '/';
            pageCounts[path] = (pageCounts[path] || 0) + 1;
          });
        }

        // Convert to array and sort
        const topPages = Object.entries(pageCounts)
          .map(([path, count]) => ({ path, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        result = {
          total: total || 0,
          top_pages: topPages
        };
        break;
      }

      case 'visitors': {
        let query = supabase
          .from('visitor_sessions')
          .select('hashed_ip, is_new_visitor', { count: 'exact' });

        if (dateFilter) {
          query = query.gte('first_visit_at', dateFilter);
        }

        const { data: visitors, count: totalVisitors } = await query;

        // Count unique visitors (by hashed_ip)
        const uniqueIPs = new Set();
        let newVisitors = 0;

        if (visitors) {
          visitors.forEach(visitor => {
            uniqueIPs.add(visitor.hashed_ip);
            if (visitor.is_new_visitor) {
              newVisitors++;
            }
          });
        }

        result = {
          unique_visitors: uniqueIPs.size,
          new_visitors: newVisitors,
          total_sessions: totalVisitors || 0
        };
        break;
      }

      case 'devices': {
        let query = supabase
          .from('page_views')
          .select('device_type');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        const { data: devices } = await query;

        // Aggregate by device type
        const deviceCounts = {};
        if (devices) {
          devices.forEach(device => {
            const type = device.device_type || 'desktop';
            deviceCounts[type] = (deviceCounts[type] || 0) + 1;
          });
        }

        // Convert to array and sort
        const deviceArray = Object.entries(deviceCounts)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count);

        result = {
          devices: deviceArray
        };
        break;
      }

      case 'geography': {
        let query = supabase
          .from('page_views')
          .select('country');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        const { data: countries } = await query;

        // Aggregate by country
        const countryCounts = {};
        if (countries) {
          countries.forEach(item => {
            const country = item.country || 'Unknown';
            countryCounts[country] = (countryCounts[country] || 0) + 1;
          });
        }

        // Convert to array and sort
        const countryArray = Object.entries(countryCounts)
          .map(([country, count]) => ({ country, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20); // Top 20 countries

        result = {
          countries: countryArray
        };
        break;
      }

      case 'timeonpage': {
        let query = supabase
          .from('page_views')
          .select('page_path, time_on_page');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        const { data: timeData } = await query;

        // Calculate overall average
        let totalTime = 0;
        let count = 0;

        // Calculate per-page averages
        const pageTimes = {};

        if (timeData) {
          timeData.forEach(item => {
            if (item.time_on_page !== null && item.time_on_page !== undefined) {
              totalTime += item.time_on_page;
              count++;

              const path = item.page_path || '/';
              if (!pageTimes[path]) {
                pageTimes[path] = { total: 0, count: 0 };
              }
              pageTimes[path].total += item.time_on_page;
              pageTimes[path].count++;
            }
          });
        }

        // Convert to array
        const byPage = Object.entries(pageTimes)
          .map(([path, data]) => ({
            path,
            average: Math.round(data.total / data.count)
          }))
          .sort((a, b) => b.average - a.average)
          .slice(0, 10); // Top 10 pages

        result = {
          overall_average: count > 0 ? Math.round(totalTime / count) : 0,
          by_page: byPage
        };
        break;
      }

      default:
        return res.status(400).json({ error: 'Invalid metric' });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Analytics data error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

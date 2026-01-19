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

// Get excluded IP hashes from environment variable
// Format: comma-separated list of SHA-256 hashes (e.g., "hash1,hash2,hash3")
function getExcludedIPHashes() {
  const excludedIPs = process.env.EXCLUDED_IP_HASHES || '';
  if (!excludedIPs) {
    return [];
  }
  // Split by comma and trim whitespace
  return excludedIPs.split(',').map(hash => hash.trim()).filter(hash => hash.length > 0);
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
    const excludedIPHashes = getExcludedIPHashes();

    let result = {};

    switch (metric) {
      case 'pageviews': {
        let query = supabase
          .from('page_views')
          .select('page_path', { count: 'exact' });

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        // Exclude filtered IPs
        // Note: Multiple .neq() calls create AND conditions, which correctly excludes all listed IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
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

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            topPagesQuery = topPagesQuery.neq('hashed_ip', hash);
          });
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

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
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

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
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

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
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

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
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

      case 'hourly': {
        // Get page views with timestamps
        // Optional: filter by page_path if provided
        const { page_path } = req.query;
        
        let query = supabase
          .from('page_views')
          .select('created_at');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        // Filter by page path if provided
        if (page_path) {
          query = query.eq('page_path', page_path);
        }

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
        }

        const { data: views } = await query;

        // Initialize hour buckets (0-23)
        const hourCounts = {};
        for (let i = 0; i < 24; i++) {
          hourCounts[i] = 0;
        }

        // Group views by hour (converting UTC to CST)
        // CST is UTC-6, CDT (daylight saving) is UTC-5
        if (views) {
          views.forEach(view => {
            if (view.created_at) {
              const date = new Date(view.created_at);
              
              // Convert to CST/CDT timezone
              // Format: 'America/Chicago' handles CST/CDT automatically
              const cstDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
              
              // Get hour in CST
              const hour = cstDate.getHours();
              hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            }
          });
        }

        // Convert to array format for chart
        const hourlyData = Object.entries(hourCounts)
          .map(([hour, count]) => ({
            hour: parseInt(hour),
            count: count
          }))
          .sort((a, b) => a.hour - b.hour);

        result = {
          hourly: hourlyData
        };
        break;
      }

      case 'timeline': {
        // Get page views with timestamps for hierarchical timeline view
        // Returns: months -> days -> hours structure
        let query = supabase
          .from('page_views')
          .select('created_at');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        // Optional filters
        // Note: We filter in UTC (database timezone) but group/display in CST
        // We'll filter with a wider range to account for timezone differences, then group by CST
        const { month, day } = req.query;
        if (month) {
          // Filter to specific month (format: YYYY-MM)
          // Filter from start of month in UTC, then group by CST when processing
          const monthStart = new Date(month + '-01T00:00:00Z');
          const monthEnd = new Date(monthStart);
          monthEnd.setMonth(monthEnd.getMonth() + 1);
          query = query.gte('created_at', monthStart.toISOString())
                   .lt('created_at', monthEnd.toISOString());
        }
        if (day) {
          // Filter to specific day (format: YYYY-MM-DD)
          // Filter from start of day in UTC, then group by CST when processing
          const dayStart = new Date(day + 'T00:00:00Z');
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          query = query.gte('created_at', dayStart.toISOString())
                   .lt('created_at', dayEnd.toISOString());
        }

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
        }

        const { data: views } = await query;

        if (!views || views.length === 0) {
          result = { months: [], days: [], hours: [] };
          break;
        }

        // Helper to convert UTC to CST and format
        function toCST(date) {
          return new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        }

        // Group by month, day, and hour
        const monthMap = {};
        const dayMap = {};
        const hourMap = {};

        views.forEach(view => {
          if (view.created_at) {
            const utcDate = new Date(view.created_at);
            const cstDate = toCST(utcDate);
            
            const year = cstDate.getFullYear();
            const month = String(cstDate.getMonth() + 1).padStart(2, '0');
            const day = String(cstDate.getDate()).padStart(2, '0');
            const hour = cstDate.getHours();
            
            const monthKey = `${year}-${month}`;
            const dayKey = `${year}-${month}-${day}`;
            const hourKey = hour;

            // Always count by month (for navigation/breadcrumbs)
            if (!monthMap[monthKey]) {
              monthMap[monthKey] = 0;
            }
            monthMap[monthKey]++;

            // Count by day if filtering by month (to show days for selected month)
            if (month) {
              if (!dayMap[dayKey]) {
                dayMap[dayKey] = 0;
              }
              dayMap[dayKey]++;
            }

            // Count by hour if filtering by day (to show hours for selected day)
            if (day) {
              if (!hourMap[hourKey]) {
                hourMap[hourKey] = 0;
              }
              hourMap[hourKey]++;
            }
          }
        });

        // Month and day name arrays
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        // Format months
        const months = Object.entries(monthMap)
          .map(([monthKey, count]) => {
            const [year, month] = monthKey.split('-');
            return {
              month: monthKey,
              label: `${monthNames[parseInt(month) - 1]} ${year}`,
              count: count
            };
          })
          .sort((a, b) => a.month.localeCompare(b.month));

        // Format days (only if month filter is provided)
        const days = [];
        if (month) {
          const formattedDays = Object.entries(dayMap)
            .map(([dayKey, count]) => {
              const [year, monthNum, dayNum] = dayKey.split('-');
              const date = new Date(year, parseInt(monthNum) - 1, parseInt(dayNum));
              return {
                day: dayKey,
                label: `${monthNames[parseInt(monthNum) - 1]} ${dayNum}, ${year} (${dayNames[date.getDay()]})`,
                count: count
              };
            })
            .sort((a, b) => a.day.localeCompare(b.day));
          days.push(...formattedDays);
        }

        // Format hours (only if day filter is provided)
        const hours = [];
        if (day) {
          for (let i = 0; i < 24; i++) {
            const period = i >= 12 ? 'PM' : 'AM';
            const displayHour = i === 0 ? 12 : i > 12 ? i - 12 : i;
            hours.push({
              hour: i,
              label: `${displayHour} ${period}`,
              count: hourMap[i] || 0
            });
          }
        }

        result = {
          months: months,
          days: days,
          hours: hours
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

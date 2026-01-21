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

// Normalize page paths - combine / and /index.html as the same page
// Note: Section paths (/section/...) are preserved as-is
function normalizePagePath(path) {
  if (!path) return '/';
  if (path === '/index.html' || path === 'index.html') {
    return '/';
  }
  // Preserve section paths
  if (path.startsWith('/section/')) {
    return path;
  }
  return path;
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

        // Aggregate by page path (normalize /index.html to /)
        const pageCounts = {};
        if (allPages) {
          allPages.forEach(page => {
            const path = normalizePagePath(page.page_path || '/');
            pageCounts[path] = (pageCounts[path] || 0) + 1;
          });
        }

        // Convert to array and sort
        const topPages = Object.entries(pageCounts)
          .map(([path, count]) => ({ path, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        // Get daily breakdown for trend chart
        let dailyQuery = supabase
          .from('page_views')
          .select('created_at');

        if (dateFilter) {
          dailyQuery = dailyQuery.gte('created_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            dailyQuery = dailyQuery.neq('hashed_ip', hash);
          });
        }

        const { data: dailyViews } = await dailyQuery;

        // Helper function to convert UTC to Central Time (CST/CDT)
        function toCST(date) {
          const utcDate = new Date(date);
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const parts = formatter.formatToParts(utcDate);
          const year = parseInt(parts.find(p => p.type === 'year').value);
          const month = parseInt(parts.find(p => p.type === 'month').value) - 1;
          const day = parseInt(parts.find(p => p.type === 'day').value);
          const hour = parseInt(parts.find(p => p.type === 'hour').value);
          const minute = parseInt(parts.find(p => p.type === 'minute').value);
          const second = parseInt(parts.find(p => p.type === 'second').value);
          return new Date(year, month, day, hour, minute, second);
        }

        // Group by day (in Central Time)
        const dailyCounts = {};
        if (dailyViews) {
          dailyViews.forEach(view => {
            if (view.created_at) {
              const utcDate = new Date(view.created_at);
              const cstDate = toCST(utcDate);
              // Format as YYYY-MM-DD in Central Time
              const year = cstDate.getFullYear();
              const month = String(cstDate.getMonth() + 1).padStart(2, '0');
              const day = String(cstDate.getDate()).padStart(2, '0');
              const dayKey = `${year}-${month}-${day}`;
              dailyCounts[dayKey] = (dailyCounts[dayKey] || 0) + 1;
            }
          });
        }

        // Convert to array and sort
        const dailyData = Object.entries(dailyCounts)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date));

        result = {
          total: total || 0,
          top_pages: topPages,
          daily: dailyData
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

              const path = normalizePagePath(item.page_path || '/');
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

      case 'visits': {
        // Recent individual visits with timestamp, country, and returning flag
        let query = supabase
          .from('page_views')
          .select('created_at, page_path, country, session_id')
          .order('created_at', { ascending: false })
          .limit(200);

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
        }

        const { data: visitsRaw } = await query;

        if (!visitsRaw || visitsRaw.length === 0) {
          result = { visits: [] };
          break;
        }

        // Get session info to determine returning visitors
        const sessionIds = Array.from(new Set(
          visitsRaw.map(v => v.session_id).filter(id => !!id)
        ));

        const sessionMap = {};
        if (sessionIds.length > 0) {
          const { data: sessions } = await supabase
            .from('visitor_sessions')
            .select('session_id, country, is_new_visitor')
            .in('session_id', sessionIds);

          if (sessions) {
            sessions.forEach(s => {
              sessionMap[s.session_id] = s;
            });
          }
        }

        // Helper to convert UTC to Central Time (CST/CDT)
        function toCST(date) {
          const utcDate = new Date(date);
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const parts = formatter.formatToParts(utcDate);
          const year = parseInt(parts.find(p => p.type === 'year').value);
          const month = parseInt(parts.find(p => p.type === 'month').value) - 1;
          const day = parseInt(parts.find(p => p.type === 'day').value);
          const hour = parseInt(parts.find(p => p.type === 'hour').value);
          const minute = parseInt(parts.find(p => p.type === 'minute').value);
          const second = parseInt(parts.find(p => p.type === 'second').value);
          return new Date(year, month, day, hour, minute, second);
        }

        const visits = visitsRaw.map(v => {
          const session = v.session_id ? sessionMap[v.session_id] : null;
          const cstDate = v.created_at ? toCST(new Date(v.created_at)) : null;

          let displayTime = 'Unknown';
          let isoTime = null;
          if (cstDate) {
            const year = cstDate.getFullYear();
            const month = String(cstDate.getMonth() + 1).padStart(2, '0');
            const day = String(cstDate.getDate()).padStart(2, '0');
            const hour = String(cstDate.getHours()).padStart(2, '0');
            const minute = String(cstDate.getMinutes()).padStart(2, '0');
            const second = String(cstDate.getSeconds()).padStart(2, '0');
            displayTime = `${year}-${month}-${day} ${hour}:${minute}:${second} CST`;
            isoTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
          }

          const normalizedPath = normalizePagePath(v.page_path || '/');
          const visitCountry = v.country || (session && session.country) || 'Unknown';
          const isReturning = session ? !session.is_new_visitor : null;

          return {
            time_iso: isoTime,
            time_display: displayTime,
            path: normalizedPath,
            country: visitCountry,
            is_returning: isReturning
          };
        });

        result = { visits };
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

        // Helper to convert UTC to CST/CDT (Central Time)
        // More reliable method using Intl.DateTimeFormat
        function toCST(date) {
          const utcDate = new Date(date);
          // Get CST date components using Intl API
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const parts = formatter.formatToParts(utcDate);
          const year = parseInt(parts.find(p => p.type === 'year').value);
          const month = parseInt(parts.find(p => p.type === 'month').value) - 1; // 0-indexed
          const day = parseInt(parts.find(p => p.type === 'day').value);
          const hour = parseInt(parts.find(p => p.type === 'hour').value);
          const minute = parseInt(parts.find(p => p.type === 'minute').value);
          const second = parseInt(parts.find(p => p.type === 'second').value);
          // Create new date in local timezone with CST values
          return new Date(year, month, day, hour, minute, second);
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
              // Use CST date to get correct day name
              const cstDate = new Date(year, parseInt(monthNum) - 1, parseInt(dayNum));
              return {
                day: dayKey,
                label: `${monthNames[parseInt(monthNum) - 1]} ${dayNum}, ${year} (${dayNames[cstDate.getDay()]})`,
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

        // Day of week analysis (only if showing months or all data)
        const dayOfWeekCounts = {
          'Sunday': 0,
          'Monday': 0,
          'Tuesday': 0,
          'Wednesday': 0,
          'Thursday': 0,
          'Friday': 0,
          'Saturday': 0
        };

        if (!day && views) {
          views.forEach(view => {
            if (view.created_at) {
              const cstDate = toCST(new Date(view.created_at));
              const dayOfWeek = dayNames[cstDate.getDay()];
              dayOfWeekCounts[dayOfWeek]++;
            }
          });
        }

        const dayOfWeekData = Object.entries(dayOfWeekCounts)
          .map(([day, count]) => ({ day, count }))
          .sort((a, b) => {
            const order = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return order.indexOf(a.day) - order.indexOf(b.day);
          });

        // Identify peak times
        const peakHour = hours.length > 0
          ? hours.reduce((max, h) => h.count > max.count ? h : max, hours[0])
          : null;
        const peakDay = dayOfWeekData.length > 0
          ? dayOfWeekData.reduce((max, d) => d.count > max.count ? d : max, dayOfWeekData[0])
          : null;

        result = {
          months: months,
          days: days,
          hours: hours,
          day_of_week: dayOfWeekData,
          peak_hour: peakHour ? { hour: peakHour.hour, label: peakHour.label, count: peakHour.count } : null,
          peak_day: peakDay ? { day: peakDay.day, count: peakDay.count } : null
        };
        break;
      }

      case 'growth': {
        // Compare current period to previous period for growth metrics
        const now = new Date();
        let currentStart, currentEnd, previousStart, previousEnd;
        
        if (period === '7d') {
          currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          currentEnd = now;
          previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
          previousEnd = currentStart;
        } else if (period === '30d') {
          currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          currentEnd = now;
          previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
          previousEnd = currentStart;
        } else {
          // For 'all', compare last 30 days to previous 30 days
          currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          currentEnd = now;
          previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
          previousEnd = currentStart;
        }

        // Get current period data
        let currentQuery = supabase
          .from('page_views')
          .select('*', { count: 'exact' })
          .gte('created_at', currentStart.toISOString())
          .lt('created_at', currentEnd.toISOString());

        let previousQuery = supabase
          .from('page_views')
          .select('*', { count: 'exact' })
          .gte('created_at', previousStart.toISOString())
          .lt('created_at', previousEnd.toISOString());

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            currentQuery = currentQuery.neq('hashed_ip', hash);
            previousQuery = previousQuery.neq('hashed_ip', hash);
          });
        }

        const [{ count: currentPageviews }, { count: previousPageviews }] = await Promise.all([
          currentQuery,
          previousQuery
        ]);

        // Get unique visitors for both periods
        let currentVisitorsQuery = supabase
          .from('visitor_sessions')
          .select('hashed_ip', { count: 'exact' })
          .gte('first_visit_at', currentStart.toISOString())
          .lt('first_visit_at', currentEnd.toISOString());

        let previousVisitorsQuery = supabase
          .from('visitor_sessions')
          .select('hashed_ip', { count: 'exact' })
          .gte('first_visit_at', previousStart.toISOString())
          .lt('first_visit_at', previousEnd.toISOString());

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            currentVisitorsQuery = currentVisitorsQuery.neq('hashed_ip', hash);
            previousVisitorsQuery = previousVisitorsQuery.neq('hashed_ip', hash);
          });
        }

        const [{ data: currentVisitorsData }, { data: previousVisitorsData }] = await Promise.all([
          currentVisitorsQuery,
          previousVisitorsQuery
        ]);

        const currentUniqueVisitors = new Set(currentVisitorsData?.map(v => v.hashed_ip) || []).size;
        const previousUniqueVisitors = new Set(previousVisitorsData?.map(v => v.hashed_ip) || []).size;

        // Get average time on page for both periods
        let currentTimeQuery = supabase
          .from('page_views')
          .select('time_on_page')
          .gte('created_at', currentStart.toISOString())
          .lt('created_at', currentEnd.toISOString())
          .not('time_on_page', 'is', null);

        let previousTimeQuery = supabase
          .from('page_views')
          .select('time_on_page')
          .gte('created_at', previousStart.toISOString())
          .lt('created_at', previousEnd.toISOString())
          .not('time_on_page', 'is', null);

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            currentTimeQuery = currentTimeQuery.neq('hashed_ip', hash);
            previousTimeQuery = previousTimeQuery.neq('hashed_ip', hash);
          });
        }

        const [{ data: currentTimeData }, { data: previousTimeData }] = await Promise.all([
          currentTimeQuery,
          previousTimeQuery
        ]);

        const currentAvgTime = currentTimeData && currentTimeData.length > 0
          ? Math.round(currentTimeData.reduce((sum, item) => sum + (item.time_on_page || 0), 0) / currentTimeData.length)
          : 0;
        const previousAvgTime = previousTimeData && previousTimeData.length > 0
          ? Math.round(previousTimeData.reduce((sum, item) => sum + (item.time_on_page || 0), 0) / previousTimeData.length)
          : 0;

        // Calculate percentage changes
        const pageviewsChange = previousPageviews > 0
          ? Math.round(((currentPageviews - previousPageviews) / previousPageviews) * 100)
          : (currentPageviews > 0 ? 100 : 0);
        
        const visitorsChange = previousUniqueVisitors > 0
          ? Math.round(((currentUniqueVisitors - previousUniqueVisitors) / previousUniqueVisitors) * 100)
          : (currentUniqueVisitors > 0 ? 100 : 0);
        
        const timeChange = previousAvgTime > 0
          ? Math.round(((currentAvgTime - previousAvgTime) / previousAvgTime) * 100)
          : (currentAvgTime > 0 ? 100 : 0);

        result = {
          pageviews: {
            current: currentPageviews || 0,
            previous: previousPageviews || 0,
            change: pageviewsChange,
            trend: pageviewsChange > 0 ? 'up' : pageviewsChange < 0 ? 'down' : 'stable'
          },
          visitors: {
            current: currentUniqueVisitors,
            previous: previousUniqueVisitors,
            change: visitorsChange,
            trend: visitorsChange > 0 ? 'up' : visitorsChange < 0 ? 'down' : 'stable'
          },
          time_on_page: {
            current: currentAvgTime,
            previous: previousAvgTime,
            change: timeChange,
            trend: timeChange > 0 ? 'up' : timeChange < 0 ? 'down' : 'stable'
          }
        };
        break;
      }

      case 'engagement': {
        // Calculate engagement metrics: bounce rate, pages per session, session duration, return rate
        let sessionsQuery = supabase
          .from('visitor_sessions')
          .select('page_count, first_visit_at, last_visit_at, is_new_visitor');

        if (dateFilter) {
          sessionsQuery = sessionsQuery.gte('first_visit_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            sessionsQuery = sessionsQuery.neq('hashed_ip', hash);
          });
        }

        const { data: sessions } = await sessionsQuery;

        // Calculate bounce rate (sessions with only 1 page)
        let bounceCount = 0;
        let totalSessions = 0;
        const pagesPerSession = [];
        const sessionDurations = [];
        let newVisitors = 0;
        let returningVisitors = 0;

        if (sessions) {
          sessions.forEach(session => {
            totalSessions++;
            if (session.page_count === 1) {
              bounceCount++;
            }
            pagesPerSession.push(session.page_count || 1);
            
            // Calculate session duration
            if (session.first_visit_at && session.last_visit_at) {
              const duration = Math.round((new Date(session.last_visit_at) - new Date(session.first_visit_at)) / 1000);
              if (duration > 0) {
                sessionDurations.push(duration);
              }
            }

            if (session.is_new_visitor) {
              newVisitors++;
            } else {
              returningVisitors++;
            }
          });
        }

        const bounceRate = totalSessions > 0 ? Math.round((bounceCount / totalSessions) * 100) : 0;
        const avgPagesPerSession = pagesPerSession.length > 0
          ? Math.round((pagesPerSession.reduce((a, b) => a + b, 0) / pagesPerSession.length) * 10) / 10
          : 0;
        const avgSessionDuration = sessionDurations.length > 0
          ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length)
          : 0;
        const returnRate = totalSessions > 0
          ? Math.round((returningVisitors / totalSessions) * 100)
          : 0;

        // Time distribution buckets
        let timeQuery = supabase
          .from('page_views')
          .select('time_on_page')
          .not('time_on_page', 'is', null);

        if (dateFilter) {
          timeQuery = timeQuery.gte('created_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            timeQuery = timeQuery.neq('hashed_ip', hash);
          });
        }

        const { data: timeData } = await timeQuery;

        const timeDistribution = {
          '0-30s': 0,
          '30s-1min': 0,
          '1-2min': 0,
          '2-5min': 0,
          '5min+': 0
        };

        if (timeData) {
          timeData.forEach(item => {
            const time = item.time_on_page || 0;
            if (time <= 30) {
              timeDistribution['0-30s']++;
            } else if (time <= 60) {
              timeDistribution['30s-1min']++;
            } else if (time <= 120) {
              timeDistribution['1-2min']++;
            } else if (time <= 300) {
              timeDistribution['2-5min']++;
            } else {
              timeDistribution['5min+']++;
            }
          });
        }

        // Pages per session distribution
        const pagesDistribution = {
          '1': 0,
          '2-3': 0,
          '4-5': 0,
          '6+': 0
        };

        pagesPerSession.forEach(count => {
          if (count === 1) {
            pagesDistribution['1']++;
          } else if (count <= 3) {
            pagesDistribution['2-3']++;
          } else if (count <= 5) {
            pagesDistribution['4-5']++;
          } else {
            pagesDistribution['6+']++;
          }
        });

        result = {
          bounce_rate: bounceRate,
          pages_per_session: {
            average: avgPagesPerSession,
            distribution: pagesDistribution
          },
          session_duration: {
            average: avgSessionDuration,
            total_sessions: totalSessions
          },
          return_rate: returnRate,
          new_visitors: newVisitors,
          returning_visitors: returningVisitors,
          time_distribution: timeDistribution
        };
        break;
      }

      case 'sources': {
        // Analyze traffic sources: Direct, Search, Social, Other
        let query = supabase
          .from('page_views')
          .select('referrer_domain, page_path, time_on_page, is_bounce');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
        }

        const { data: views } = await query;

        const categories = {
          'Direct': { count: 0, bounce_count: 0, total_time: 0, time_count: 0 },
          'Search': { count: 0, bounce_count: 0, total_time: 0, time_count: 0 },
          'Social': { count: 0, bounce_count: 0, total_time: 0, time_count: 0 },
          'Other': { count: 0, bounce_count: 0, total_time: 0, time_count: 0 }
        };

        const referrerMap = {};
        const searchEngines = {
          'Google': 0,
          'Bing': 0,
          'DuckDuckGo': 0,
          'Yahoo': 0,
          'Other': 0
        };

        // Search engine domains
        const searchDomains = {
          'google.com': 'Google',
          'google.': 'Google', // Covers google.co.uk, etc.
          'bing.com': 'Bing',
          'duckduckgo.com': 'DuckDuckGo',
          'yahoo.com': 'Yahoo',
          'yandex.com': 'Yandex'
        };

        // Social media domains
        const socialDomains = ['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com'];

        if (views) {
          views.forEach(view => {
            const domain = view.referrer_domain;
            let category = 'Direct';
            let searchEngine = null;

            if (!domain || domain === '') {
              category = 'Direct';
            } else {
              const domainLower = domain.toLowerCase();
              
              // Check if it's a search engine
              for (const [searchDomain, engineName] of Object.entries(searchDomains)) {
                if (domainLower.includes(searchDomain)) {
                  category = 'Search';
                  searchEngine = engineName;
                  break;
                }
              }

              // Check if it's social media
              if (category === 'Direct' && socialDomains.some(social => domainLower.includes(social))) {
                category = 'Social';
              }

              // If not search or social, it's "Other" (unless it's our own domain)
              if (category === 'Direct' && !domainLower.includes('watchmanscry.site') && !domainLower.includes('localhost')) {
                category = 'Other';
              }
            }

            // Count by category
            categories[category].count++;
            if (view.is_bounce) {
              categories[category].bounce_count++;
            }
            if (view.time_on_page) {
              categories[category].total_time += view.time_on_page;
              categories[category].time_count++;
            }

            // Track individual referrers
            if (domain && category !== 'Direct') {
              if (!referrerMap[domain]) {
                referrerMap[domain] = {
                  domain: domain,
                  count: 0,
                  bounce_count: 0,
                  total_time: 0,
                  time_count: 0,
                  category: category
                };
              }
              referrerMap[domain].count++;
              if (view.is_bounce) {
                referrerMap[domain].bounce_count++;
              }
              if (view.time_on_page) {
                referrerMap[domain].total_time += view.time_on_page;
                referrerMap[domain].time_count++;
              }
            }

            // Track search engines
            if (searchEngine) {
              if (searchEngines[searchEngine]) {
                searchEngines[searchEngine]++;
              } else {
                searchEngines['Other']++;
              }
            }
          });
        }

        // Calculate bounce rates and avg time for categories
        const categoryData = Object.entries(categories).map(([name, data]) => ({
          name: name,
          count: data.count,
          percentage: views && views.length > 0 ? Math.round((data.count / views.length) * 100) : 0,
          bounce_rate: data.count > 0 ? Math.round((data.bounce_count / data.count) * 100) : 0,
          avg_time: data.time_count > 0 ? Math.round(data.total_time / data.time_count) : 0
        }));

        // Calculate metrics for top referrers
        const topReferrers = Object.values(referrerMap)
          .map(ref => ({
            domain: ref.domain,
            count: ref.count,
            bounce_rate: ref.count > 0 ? Math.round((ref.bounce_count / ref.count) * 100) : 0,
            avg_time: ref.time_count > 0 ? Math.round(ref.total_time / ref.time_count) : 0,
            category: ref.category
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        // Format search engines
        const searchEngineData = Object.entries(searchEngines)
          .filter(([_, count]) => count > 0)
          .map(([name, count]) => ({
            name: name,
            count: count
          }))
          .sort((a, b) => b.count - a.count);

        result = {
          categories: categoryData,
          top_referrers: topReferrers,
          search_engines: searchEngineData
        };
        break;
      }

      case 'content': {
        // Analyze content performance by page type and engagement
        let query = supabase
          .from('page_views')
          .select('page_path, time_on_page, is_bounce, created_at');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
        }

        const { data: views } = await query;

        const pageStats = {};
        const editions = [];

        if (views) {
          views.forEach(view => {
            const path = normalizePagePath(view.page_path || '/');
            
            if (!pageStats[path]) {
              pageStats[path] = {
                path: path,
                views: 0,
                total_time: 0,
                time_count: 0,
                bounces: 0,
                sessions: new Set()
              };
            }

            pageStats[path].views++;
            if (view.time_on_page) {
              pageStats[path].total_time += view.time_on_page;
              pageStats[path].time_count++;
            }
            if (view.is_bounce) {
              pageStats[path].bounces++;
            }

            // Track editions (archive pages)
            if (path.includes('/archive/') || path.includes('edition-') || path.includes('index-')) {
              const editionMatch = path.match(/(\d{4}-\d{2}-\d{2})/);
              if (editionMatch) {
                const editionDate = editionMatch[1];
                if (!editions.find(e => e.date === editionDate)) {
                  editions.push({
                    date: editionDate,
                    path: path,
                    views: 0,
                    total_time: 0,
                    time_count: 0,
                    bounces: 0
                  });
                }
                const edition = editions.find(e => e.date === editionDate);
                edition.views++;
                if (view.time_on_page) {
                  edition.total_time += view.time_on_page;
                  edition.time_count++;
                }
                if (view.is_bounce) {
                  edition.bounces++;
                }
              }
            }
          });
        }

        // Calculate engagement metrics per page
        const pagePerformance = Object.values(pageStats).map(page => {
          const avgTime = page.time_count > 0 ? Math.round(page.total_time / page.time_count) : 0;
          const bounceRate = page.views > 0 ? Math.round((page.bounces / page.views) * 100) : 0;
          
          // Engagement score: weighted combination (lower bounce = better, higher time = better)
          const engagementScore = Math.round(
            (page.views * 0.3) + // Views weight
            ((100 - bounceRate) * 0.4) + // Low bounce rate weight
            (Math.min(avgTime / 10, 10) * 0.3) // Time weight (capped at 10 points for 100+ seconds)
          );

          return {
            path: page.path,
            views: page.views,
            avg_time: avgTime,
            bounce_rate: bounceRate,
            engagement_score: engagementScore
          };
        });

        // Sort by engagement score
        pagePerformance.sort((a, b) => b.engagement_score - a.engagement_score);

        // Calculate metrics for editions
        const editionPerformance = editions.map(edition => {
          const avgTime = edition.time_count > 0 ? Math.round(edition.total_time / edition.time_count) : 0;
          const bounceRate = edition.views > 0 ? Math.round((edition.bounces / edition.views) * 100) : 0;
          const engagementScore = Math.round(
            (edition.views * 0.3) +
            ((100 - bounceRate) * 0.4) +
            (Math.min(avgTime / 10, 10) * 0.3)
          );

          return {
            date: edition.date,
            path: edition.path,
            views: edition.views,
            avg_time: avgTime,
            bounce_rate: bounceRate,
            engagement_score: engagementScore
          };
        });

        editionPerformance.sort((a, b) => b.engagement_score - a.engagement_score);

        // Calculate total screen time per page for heatmap
        const screenTimeData = Object.values(pageStats).map(page => ({
          path: page.path,
          total_screen_time: page.total_time, // Total seconds spent on this page
          avg_screen_time: page.time_count > 0 ? Math.round(page.total_time / page.time_count) : 0,
          views: page.views
        })).sort((a, b) => b.total_screen_time - a.total_screen_time);

        result = {
          top_pages: pagePerformance.slice(0, 15),
          editions: editionPerformance,
          engagement_rankings: pagePerformance.slice(0, 10),
          screen_time: screenTimeData // For heatmap visualization
        };
        break;
      }

      case 'journey': {
        // Analyze entry and exit pages
        let sessionsQuery = supabase
          .from('visitor_sessions')
          .select('session_id, first_visit_at, last_visit_at');

        if (dateFilter) {
          sessionsQuery = sessionsQuery.gte('first_visit_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            sessionsQuery = sessionsQuery.neq('hashed_ip', hash);
          });
        }

        const { data: sessions } = await sessionsQuery;

        const entryPages = {};
        const exitPages = {};
        let totalSessions = 0;

        // Get all page views for these sessions in one query
        const sessionIds = sessions ? sessions.map(s => s.session_id) : [];
        
        if (sessionIds.length > 0) {
          // Get all page views for these sessions, ordered by session and time
          const { data: allPageViews } = await supabase
            .from('page_views')
            .select('session_id, page_path, created_at')
            .in('session_id', sessionIds)
            .order('session_id', { ascending: true })
            .order('created_at', { ascending: true });

          // Group by session and find first/last
          const sessionPages = {};
          if (allPageViews) {
            allPageViews.forEach(view => {
              const sessionId = view.session_id;
              if (!sessionPages[sessionId]) {
                sessionPages[sessionId] = [];
              }
              sessionPages[sessionId].push(view);
            });
          }

          // Process each session
          if (sessions) {
            sessions.forEach(session => {
              totalSessions++;
              const pages = sessionPages[session.session_id] || [];
              
              if (pages.length > 0) {
                // First page is entry (normalize path)
                const entryPath = normalizePagePath(pages[0].page_path || '/');
                entryPages[entryPath] = (entryPages[entryPath] || 0) + 1;
                
                // Last page is exit (normalize path)
                const exitPath = normalizePagePath(pages[pages.length - 1].page_path || '/');
                exitPages[exitPath] = (exitPages[exitPath] || 0) + 1;
              }
            });
          }
        }

        // Format entry pages
        const entryPagesData = Object.entries(entryPages)
          .map(([path, count]) => ({
            path: path,
            count: count,
            percentage: totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        // Format exit pages
        const exitPagesData = Object.entries(exitPages)
          .map(([path, count]) => ({
            path: path,
            count: count,
            percentage: totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        // Calculate exit rate per page (exits / total views of that page)
        let pageViewsQuery = supabase
          .from('page_views')
          .select('page_path')
          .not('page_path', 'is', null);

        if (dateFilter) {
          pageViewsQuery = pageViewsQuery.gte('created_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            pageViewsQuery = pageViewsQuery.neq('hashed_ip', hash);
          });
        }

        const { data: allPageViews } = await pageViewsQuery;

        const pageViewCounts = {};
        if (allPageViews) {
          allPageViews.forEach(view => {
            const path = normalizePagePath(view.page_path || '/');
            pageViewCounts[path] = (pageViewCounts[path] || 0) + 1;
          });
        }

        const exitRates = exitPagesData.map(exit => ({
          path: exit.path,
          exits: exit.count,
          total_views: pageViewCounts[exit.path] || 0,
          exit_rate: pageViewCounts[exit.path] > 0
            ? Math.round((exit.count / pageViewCounts[exit.path]) * 100)
            : 0
        }));

        result = {
          entry_pages: entryPagesData,
          exit_pages: exitPagesData,
          exit_rates: exitRates.sort((a, b) => b.exit_rate - a.exit_rate)
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

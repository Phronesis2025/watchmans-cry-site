// The Watchman's Cry: Analytics Tracking Script
// Privacy-first analytics that respects Do Not Track

(function() {
  'use strict';

  // Check for opt-out flag in localStorage
  // Set this by running: localStorage.setItem('watchmans_cry_opt_out', 'true')
  // Clear it by running: localStorage.removeItem('watchmans_cry_opt_out')
  if (localStorage.getItem('watchmans_cry_opt_out') === 'true') {
    return; // Exit if user has opted out
  }

  // Respect Do Not Track
  if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes') {
    return; // Exit if user has Do Not Track enabled
  }

  // Generate or retrieve session ID
  function getSessionId() {
    const key = 'watchmans_cry_session_id';
    let sessionId = sessionStorage.getItem(key);
    
    if (!sessionId) {
      // Generate a unique session ID
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem(key, sessionId);
    }
    
    return sessionId;
  }

  // Track page view
  function trackPageView() {
    const sessionId = getSessionId();
    const pagePath = window.location.pathname || '/';
    const pageTitle = document.title || '';
    const referrer = document.referrer || '';
    const userAgent = navigator.userAgent || '';

    const data = {
      page_path: pagePath,
      page_title: pageTitle,
      referrer: referrer,
      user_agent: userAgent,
      session_id: sessionId,
      time_on_page: null // Will be updated when page is left
    };

    // Send initial page view
    sendTrackingData(data);
  }

  // Track time on page
  let pageStartTime = Date.now();
  let timeOnPageInterval = null;
  let lastSentTime = 0;

  function updateTimeOnPage() {
    const timeSpent = Math.floor((Date.now() - pageStartTime) / 1000);
    
    // Send periodic updates every 30 seconds
    if (timeSpent - lastSentTime >= 30) {
      const sessionId = getSessionId();
      const pagePath = window.location.pathname || '/';
      
      const data = {
        page_path: pagePath,
        session_id: sessionId,
        time_on_page: timeSpent,
        is_update: true // Indicates this is a time update, not a new page view
      };
      
      sendTrackingData(data);
      lastSentTime = timeSpent;
    }
  }

  // Send final time on page when leaving
  function sendFinalTimeOnPage() {
    const timeSpent = Math.floor((Date.now() - pageStartTime) / 1000);
    const sessionId = getSessionId();
    const pagePath = window.location.pathname || '/';
    
    const data = {
      page_path: pagePath,
      session_id: sessionId,
      time_on_page: timeSpent,
      is_update: true,
      is_final: true
    };
    
    // Use sendBeacon for reliable delivery when page is closing
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      navigator.sendBeacon('/api/track', blob);
    } else {
      // Fallback to fetch (may not complete if page closes)
      sendTrackingData(data);
    }
  }

  // Send tracking data to server
  function sendTrackingData(data) {
    // Use fetch with keepalive for better reliability
    fetch('/api/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      keepalive: true // Ensures request completes even if page closes
    })
    .then(function(response) {
      // Log success/failure for debugging (only in development)
      if (window.location.hostname === 'localhost' || window.location.hostname.includes('localhost')) {
        if (response.ok || response.status === 204) {
          console.log('✓ Analytics tracked:', data.page_path);
        } else {
          console.warn('⚠ Analytics tracking failed:', response.status, response.statusText);
        }
      }
      return response;
    })
    .catch(function(err) {
      // Log errors for debugging
      if (window.location.hostname === 'localhost' || window.location.hostname.includes('localhost')) {
        console.error('✗ Analytics tracking error:', err);
      }
    });
  }

  // Initialize tracking when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      trackPageView();
      
      // Start periodic time updates
      timeOnPageInterval = setInterval(updateTimeOnPage, 30000); // Every 30 seconds
    });
  } else {
    // DOM already loaded
    trackPageView();
    timeOnPageInterval = setInterval(updateTimeOnPage, 30000);
  }

  // Track time on page when user leaves
  window.addEventListener('beforeunload', function() {
    clearInterval(timeOnPageInterval);
    sendFinalTimeOnPage();
  });

  // Also track on pagehide (more reliable on mobile)
  window.addEventListener('pagehide', function() {
    clearInterval(timeOnPageInterval);
    sendFinalTimeOnPage();
  });

})();

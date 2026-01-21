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

  // Track time on page (only when tab is visible)
  let pageStartTime = Date.now();
  let visibleStartTime = Date.now(); // Time when tab became visible
  let totalVisibleTime = 0; // Accumulated visible time
  let isTabVisible = !document.hidden; // Track visibility state
  
  // If page loads while tab is hidden, don't start counting until it becomes visible
  if (document.hidden) {
    visibleStartTime = null; // Will be set when tab becomes visible
  }
  
  let timeOnPageInterval = null;
  let lastSentTime = 0;

  // Handle tab visibility changes
  function handleVisibilityChange() {
    const now = Date.now();
    
    if (document.hidden) {
      // Tab became hidden - accumulate visible time up to now
      if (isTabVisible && visibleStartTime !== null) {
        totalVisibleTime += Math.floor((now - visibleStartTime) / 1000);
        isTabVisible = false;
      }
    } else {
      // Tab became visible - start counting from now
      visibleStartTime = now;
      isTabVisible = true;
    }
  }

  // Listen for visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);

  function getCurrentVisibleTime() {
    let currentVisible = totalVisibleTime;
    
    // If tab is currently visible, add time since it became visible
    if (!document.hidden) {
      currentVisible += Math.floor((Date.now() - visibleStartTime) / 1000);
    }
    
    return currentVisible;
  }

  function updateTimeOnPage() {
    // Only update if tab is visible
    if (document.hidden) {
      return;
    }
    
    const timeSpent = getCurrentVisibleTime();
    
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
    // Calculate final visible time
    const now = Date.now();
    let finalTime = totalVisibleTime;
    
    // If tab is still visible and we have a start time, add time since it became visible
    if (!document.hidden && visibleStartTime !== null) {
      finalTime += Math.floor((now - visibleStartTime) / 1000);
    }
    
    const sessionId = getSessionId();
    const pagePath = window.location.pathname || '/';
    
    const data = {
      page_path: pagePath,
      session_id: sessionId,
      time_on_page: finalTime,
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

  // Section tracking for homepage (only track sections on / or /index.html)
  function isHomePage() {
    const path = window.location.pathname || '/';
    return path === '/' || path === '/index.html' || path === 'index.html';
  }

  // Map section headings to URL-friendly paths
  function getSectionPath(sectionName) {
    const sectionMap = {
      'Opening Dispatch': 'opening-dispatch',
      'The Plain Truth': 'plain-truth',
      'Prophetic Parallels': 'prophetic-parallels',
      'Victory Reports': 'victory-reports',
      'The Common Man\'s Counsel': 'common-mans-counsel',
      'Practical Self-Reliance Corner': 'practical-self-reliance',
      'Prayer of the Week & Closing Call': 'prayer-closing'
    };
    return sectionMap[sectionName] || null;
  }

  // Section visibility tracking
  let sectionTracking = {
    activeSection: null,
    sectionStartTime: null,
    sectionTimes: {}, // Track accumulated time per section
    observer: null
  };

  function initSectionTracking() {
    if (!isHomePage()) {
      return; // Only track sections on homepage
    }

    // Find all section articles
    const sections = document.querySelectorAll('article.section');
    if (sections.length === 0) {
      return; // No sections found
    }

    // Track time spent in each section
    const sectionTimeMap = {};
    sections.forEach(section => {
      const heading = section.querySelector('h3');
      if (heading) {
        const sectionName = heading.textContent.trim();
        const sectionPath = getSectionPath(sectionName);
        if (sectionPath) {
          sectionTimeMap[sectionPath] = {
            element: section,
            name: sectionName,
            startTime: null,
            accumulatedTime: 0,
            isVisible: false
          };
        }
      }
    });

    if (Object.keys(sectionTimeMap).length === 0) {
      return; // No valid sections found
    }

    // Use Intersection Observer to track when sections are visible
    const observerOptions = {
      root: null, // Use viewport as root
      rootMargin: '-20% 0px -20% 0px', // Section is "active" when 20% from top/bottom
      threshold: [0, 0.1, 0.5, 1.0] // Multiple thresholds for better tracking
    };

    const observer = new IntersectionObserver(function(entries) {
      const now = Date.now();
      
      entries.forEach(entry => {
        // Find which section this entry belongs to
        let sectionPath = null;
        let sectionData = null;
        
        for (const [path, data] of Object.entries(sectionTimeMap)) {
          if (data.element === entry.target) {
            sectionPath = path;
            sectionData = data;
            break;
          }
        }
        
        if (!sectionPath || !sectionData) return;

        const isVisible = entry.isIntersecting && entry.intersectionRatio > 0.1;
        
        if (isVisible && !sectionData.isVisible) {
          // Section became visible
          sectionData.isVisible = true;
          sectionData.startTime = now;
          
          // If there was a previous active section, accumulate its time
          if (sectionTracking.activeSection && sectionTracking.activeSection !== sectionPath) {
            const prevData = sectionTimeMap[sectionTracking.activeSection];
            if (prevData && prevData.startTime) {
              const timeSpent = Math.floor((now - prevData.startTime) / 1000);
              prevData.accumulatedTime += timeSpent;
              prevData.isVisible = false;
              prevData.startTime = null;
            }
          }
          
          sectionTracking.activeSection = sectionPath;
          sectionTracking.sectionStartTime = now;
        } else if (!isVisible && sectionData.isVisible) {
          // Section became hidden
          if (sectionData.startTime) {
            const timeSpent = Math.floor((now - sectionData.startTime) / 1000);
            sectionData.accumulatedTime += timeSpent;
            sectionData.startTime = null;
          }
          sectionData.isVisible = false;
          
          if (sectionTracking.activeSection === sectionPath) {
            sectionTracking.activeSection = null;
            sectionTracking.sectionStartTime = null;
          }
        }
      });
    }, observerOptions);

    // Observe all sections
    Object.values(sectionTimeMap).forEach(data => {
      observer.observe(data.element);
    });

    sectionTracking.observer = observer;
    sectionTracking.sectionTimes = sectionTimeMap;

    // Periodically send section time updates (every 30 seconds)
    setInterval(function() {
      if (document.hidden) return; // Don't track when tab is hidden
      
      const now = Date.now();
      const sessionId = getSessionId();
      
      // Update current active section time
      if (sectionTracking.activeSection && sectionTracking.sectionStartTime) {
        const sectionData = sectionTimeMap[sectionTracking.activeSection];
        if (sectionData) {
          const currentTime = Math.floor((now - sectionTracking.sectionStartTime) / 1000);
          const totalTime = sectionData.accumulatedTime + currentTime;
          
          // Send update for active section
          if (totalTime > 0) {
            const data = {
              page_path: '/section/' + sectionTracking.activeSection,
              session_id: sessionId,
              time_on_page: totalTime,
              is_update: true,
              is_section: true // Flag to indicate this is section tracking
            };
            sendTrackingData(data);
          }
        }
      }
      
      // Send updates for recently viewed sections (accumulated time > 5 seconds)
      Object.entries(sectionTimeMap).forEach(([path, sectionData]) => {
        if (sectionData.accumulatedTime >= 5) {
          const trackingData = {
            page_path: '/section/' + path,
            session_id: sessionId,
            time_on_page: sectionData.accumulatedTime,
            is_update: true,
            is_section: true
          };
          sendTrackingData(trackingData);
          // Reset accumulated time after sending (to avoid double-counting)
          sectionData.accumulatedTime = 0;
        }
      });
    }, 30000); // Every 30 seconds

    // Send final section times when leaving page
    function sendFinalSectionTimes() {
      const now = Date.now();
      const sessionId = getSessionId();
      
      // Finalize current active section
      if (sectionTracking.activeSection && sectionTracking.sectionStartTime) {
        const sectionData = sectionTimeMap[sectionTracking.activeSection];
        if (sectionData) {
          const currentTime = Math.floor((now - sectionTracking.sectionStartTime) / 1000);
          const totalTime = sectionData.accumulatedTime + currentTime;
          
          if (totalTime > 0) {
            const data = {
              page_path: '/section/' + sectionTracking.activeSection,
              session_id: sessionId,
              time_on_page: totalTime,
              is_update: true,
              is_final: true,
              is_section: true
            };
            
            if (navigator.sendBeacon) {
              const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
              navigator.sendBeacon('/api/track', blob);
            } else {
              sendTrackingData(data);
            }
          }
        }
      }
      
      // Send all accumulated section times
      Object.entries(sectionTimeMap).forEach(([path, sectionData]) => {
        if (sectionData.accumulatedTime > 0 || (sectionData.isVisible && sectionData.startTime)) {
          let finalTime = sectionData.accumulatedTime;
          if (sectionData.isVisible && sectionData.startTime) {
            finalTime += Math.floor((now - sectionData.startTime) / 1000);
          }
          
          if (finalTime > 0) {
            const trackingData = {
              page_path: '/section/' + path,
              session_id: sessionId,
              time_on_page: finalTime,
              is_update: true,
              is_final: true,
              is_section: true
            };
            
            if (navigator.sendBeacon) {
              const blob = new Blob([JSON.stringify(trackingData)], { type: 'application/json' });
              navigator.sendBeacon('/api/track', blob);
            } else {
              sendTrackingData(trackingData);
            }
          }
        }
      });
    }

    // Hook into page unload events
    window.addEventListener('beforeunload', sendFinalSectionTimes);
    window.addEventListener('pagehide', sendFinalSectionTimes);
  }

  // Initialize tracking when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      trackPageView();
      
      // Start periodic time updates
      timeOnPageInterval = setInterval(updateTimeOnPage, 30000); // Every 30 seconds
      
      // Initialize section tracking for homepage
      initSectionTracking();
    });
  } else {
    // DOM already loaded
    trackPageView();
    timeOnPageInterval = setInterval(updateTimeOnPage, 30000);
    
    // Initialize section tracking for homepage
    initSectionTracking();
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

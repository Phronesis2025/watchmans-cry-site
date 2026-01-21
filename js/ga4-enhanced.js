// Google Analytics 4 Enhanced Tracking
// Tracks: scroll depth, engagement time, outbound clicks, article completion

(function() {
  'use strict';

  // Check if GA4 is loaded
  if (typeof gtag === 'undefined') {
    console.warn('GA4 (gtag) not loaded. Enhanced tracking disabled.');
    return;
  }

  // Respect Do Not Track
  if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes') {
    return;
  }

  // Check for opt-out flag
  if (localStorage.getItem('watchmans_cry_opt_out') === 'true') {
    return;
  }

  const GA4_MEASUREMENT_ID = 'G-XCVPZDXKE6';

  // ============================================
  // 1. ENHANCED PAGE VIEW WITH ARTICLE METADATA
  // ============================================
  
  function getArticleMetadata() {
    // Check if we're on the homepage with articles
    const path = window.location.pathname || '/';
    if (path !== '/' && path !== '/index.html') {
      return null; // Not the homepage
    }

    // Get edition date from page
    const editionHeader = document.querySelector('section.edition h2');
    let editionDate = null;
    if (editionHeader) {
      const match = editionHeader.textContent.match(/Edition:\s*(\w+\s+\d{1,2},\s+\d{4})/i);
      if (match) {
        editionDate = match[1];
      }
    }

    // Get all article sections
    const articles = document.querySelectorAll('article.section');
    const articleTitles = [];
    articles.forEach(article => {
      const heading = article.querySelector('h3');
      if (heading) {
        articleTitles.push(heading.textContent.trim());
      }
    });

    return {
      edition_date: editionDate,
      article_count: articleTitles.length,
      article_titles: articleTitles
    };
  }

  // Enhanced page view with article metadata
  function trackEnhancedPageView() {
    const metadata = getArticleMetadata();
    const pagePath = window.location.pathname || '/';
    const pageTitle = document.title || '';

    const pageViewData = {
      page_path: pagePath,
      page_title: pageTitle
    };

    // Add article metadata if available
    if (metadata) {
      pageViewData.article_edition_date = metadata.edition_date;
      pageViewData.article_count = metadata.article_count;
      // Send article titles as a custom dimension (first 5 to avoid limits)
      if (metadata.article_titles.length > 0) {
        pageViewData.article_titles = metadata.article_titles.slice(0, 5).join(' | ');
      }
    }

    // Track page view with metadata
    gtag('event', 'page_view', pageViewData);
  }

  // Track on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackEnhancedPageView);
  } else {
    trackEnhancedPageView();
  }

  // ============================================
  // 2. SCROLL DEPTH TRACKING
  // ============================================
  
  let scrollDepthTracked = {
    25: false,
    50: false,
    75: false,
    90: false,
    100: false
  };

  let maxScroll = 0;

  function trackScrollDepth() {
    if (document.hidden) return; // Don't track when tab is hidden

    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    const scrollPercent = Math.round(((scrollTop + windowHeight) / documentHeight) * 100);
    maxScroll = Math.max(maxScroll, scrollPercent);

    // Track milestone percentages
    const milestones = [25, 50, 75, 90, 100];
    milestones.forEach(milestone => {
      if (scrollPercent >= milestone && !scrollDepthTracked[milestone]) {
        scrollDepthTracked[milestone] = true;
        gtag('event', 'scroll', {
          scroll_depth: milestone,
          page_path: window.location.pathname || '/',
          page_title: document.title
        });
      }
    });
  }

  // Throttle scroll events (check every 100ms)
  let scrollTimeout;
  window.addEventListener('scroll', function() {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(trackScrollDepth, 100);
  }, { passive: true });

  // ============================================
  // 3. ENGAGEMENT TIME TRACKING
  // ============================================
  
  let engagementStartTime = Date.now();
  let totalEngagementTime = 0;
  let lastActiveTime = Date.now();
  let isTabVisible = !document.hidden;

  // Track engagement time (only when tab is visible and user is active)
  function updateEngagementTime() {
    const now = Date.now();
    
    if (isTabVisible && !document.hidden) {
      // User is active if they've interacted in the last 30 seconds
      const timeSinceLastActive = now - lastActiveTime;
      if (timeSinceLastActive < 30000) { // 30 seconds
        const timeSinceLastUpdate = now - engagementStartTime;
        totalEngagementTime += Math.floor(timeSinceLastUpdate / 1000);
      }
      engagementStartTime = now;
    }

    // Send engagement time every 30 seconds
    if (totalEngagementTime > 0 && totalEngagementTime % 30 === 0) {
      gtag('event', 'engagement_time', {
        engagement_time: totalEngagementTime,
        page_path: window.location.pathname || '/',
        page_title: document.title
      });
    }
  }

  // Track user activity
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
    document.addEventListener(event, function() {
      lastActiveTime = Date.now();
    }, { passive: true });
  });

  // Handle tab visibility
  document.addEventListener('visibilitychange', function() {
    const now = Date.now();
    if (document.hidden) {
      // Tab hidden - accumulate time
      if (isTabVisible) {
        const timeSinceLastActive = now - lastActiveTime;
        if (timeSinceLastActive < 30000) {
          totalEngagementTime += Math.floor((now - engagementStartTime) / 1000);
        }
        isTabVisible = false;
      }
    } else {
      // Tab visible - resume tracking
      isTabVisible = true;
      engagementStartTime = now;
      lastActiveTime = now;
    }
  });

  // Update engagement time every 5 seconds
  setInterval(updateEngagementTime, 5000);

  // Send final engagement time on page unload
  function sendFinalEngagementTime() {
    const now = Date.now();
    if (isTabVisible && !document.hidden) {
      const timeSinceLastActive = now - lastActiveTime;
      if (timeSinceLastActive < 30000) {
        totalEngagementTime += Math.floor((now - engagementStartTime) / 1000);
      }
    }

    if (totalEngagementTime > 0) {
      gtag('event', 'engagement_time', {
        engagement_time: totalEngagementTime,
        page_path: window.location.pathname || '/',
        page_title: document.title,
        is_final: true
      }, { event_callback: function() {} });
    }
  }

  window.addEventListener('beforeunload', sendFinalEngagementTime);
  window.addEventListener('pagehide', sendFinalEngagementTime);

  // ============================================
  // 4. OUTBOUND CLICK TRACKING
  // ============================================
  
  function isOutboundLink(url) {
    try {
      const linkUrl = new URL(url, window.location.href);
      const currentDomain = window.location.hostname;
      return linkUrl.hostname !== currentDomain && linkUrl.hostname !== '';
    } catch (e) {
      return false;
    }
  }

  document.addEventListener('click', function(event) {
    const link = event.target.closest('a');
    if (!link || !link.href) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Check if it's an outbound link
    if (isOutboundLink(href)) {
      gtag('event', 'click', {
        event_category: 'outbound',
        event_label: href,
        transport_type: 'beacon', // Use sendBeacon for reliability
        page_path: window.location.pathname || '/',
        page_title: document.title
      });
    }
  }, true); // Use capture phase to catch all clicks

  // ============================================
  // 5. ARTICLE COMPLETION TRACKING
  // ============================================
  
  function trackArticleCompletion() {
    const path = window.location.pathname || '/';
    if (path !== '/' && path !== '/index.html') {
      return; // Only track on homepage
    }

    // Check if user has scrolled to the last article
    const articles = document.querySelectorAll('article.section');
    if (articles.length === 0) return;

    const lastArticle = articles[articles.length - 1];
    const lastArticleRect = lastArticle.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    
    // Article is "completed" if user has scrolled past 90% of the last article
    const lastArticleBottom = lastArticleRect.bottom;
    const lastArticleHeight = lastArticleRect.height;
    const completionThreshold = lastArticleRect.top + (lastArticleHeight * 0.9);

    if (window.pageYOffset + windowHeight >= completionThreshold) {
      // Check if we've already tracked completion
      if (!sessionStorage.getItem('ga4_article_completed')) {
        sessionStorage.setItem('ga4_article_completed', 'true');
        
        // Get article metadata
        const metadata = getArticleMetadata();
        
        gtag('event', 'article_complete', {
          page_path: path,
          page_title: document.title,
          article_count: metadata ? metadata.article_count : 0,
          edition_date: metadata ? metadata.edition_date : null,
          engagement_time: totalEngagementTime
        });
      }
    }
  }

  // Check for article completion on scroll
  let articleCompletionTimeout;
  window.addEventListener('scroll', function() {
    if (articleCompletionTimeout) {
      clearTimeout(articleCompletionTimeout);
    }
    articleCompletionTimeout = setTimeout(trackArticleCompletion, 500);
  }, { passive: true });

  // Also check on page load if already scrolled
  if (document.readyState === 'complete') {
    trackArticleCompletion();
  } else {
    window.addEventListener('load', trackArticleCompletion);
  }

  // ============================================
  // 6. SECTION VIEW TRACKING (for homepage)
  // ============================================
  
  // Track when sections come into view (using Intersection Observer)
  if (window.IntersectionObserver) {
    const sectionObserver = new IntersectionObserver(function(entries) {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          const section = entry.target;
          const heading = section.querySelector('h3');
          if (heading) {
            const sectionName = heading.textContent.trim();
            const sectionId = section.getAttribute('data-section-id') || sectionName.toLowerCase().replace(/\s+/g, '-');
            
            // Track section view (only once per session)
            const viewKey = `ga4_section_view_${sectionId}`;
            if (!sessionStorage.getItem(viewKey)) {
              sessionStorage.setItem(viewKey, 'true');
              
              gtag('event', 'section_view', {
                section_name: sectionName,
                section_id: sectionId,
                page_path: window.location.pathname || '/',
                page_title: document.title
              });
            }
          }
        }
      });
    }, {
      threshold: 0.5 // Section is "viewed" when 50% visible
    });

    // Observe all article sections
    document.querySelectorAll('article.section').forEach(section => {
      sectionObserver.observe(section);
    });
  }

})();

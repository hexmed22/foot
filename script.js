/**
 * Football Results Website - Main JavaScript
 * 
 * This file contains all the JavaScript functionality for the football results website.
 * It handles API calls, DOM manipulation, user interactions, theme management,
 * and real-time data updates.
 * 
 * Features:
 * - Fetches today's football matches from TheSportsDB API
 * - Real-time score updates with auto-refresh
 * - Search and filter functionality
 * - Dark/Light theme toggle with persistence
 * - Responsive design support
 * - Error handling and user feedback
 * - Local storage for data caching
 * - Accessibility features
 * 
 * @version 1.0.0
 * @author Football Results Team
 */

'use strict';

// ========================================
// Global Configuration and Constants
// ========================================

/**
 * Application configuration object
 * Contains all configuration settings for the application
 */
const CONFIG = {
    // API Configuration
    api: {
        // Primary API: TheSportsDB (Free, no API key required)
        primary: {
            baseUrl: 'https://www.thesportsdb.com/api/v1/json/3',
            endpoints: {
                // Get all soccer events for today
                todayMatches: '/eventsday.php',
                // Get league details
                league: '/lookupleague.php',
                // Get team details
                team: '/lookupteam.php'
            },
            rateLimit: 1000 // Minimum milliseconds between requests
        },
        
        // Fallback API: Football-data.org (Requires API key)
        fallback: {
            baseUrl: 'https://api.football-data.org/v4',
            endpoints: {
                todayMatches: '/matches',
                competitions: '/competitions'
            },
            headers: {
                'X-Auth-Token': 'YOUR_API_KEY_HERE' // Replace with actual API key
            },
            rateLimit: 2000
        }
    },
    
    // Application Settings
    app: {
        refreshInterval: 60000, // Auto-refresh every 60 seconds
        cacheExpiry: 300000,    // Cache expires after 5 minutes
        maxRetries: 3,          // Maximum API retry attempts
        retryDelay: 2000,       // Delay between retries (ms)
        animationDuration: 300, // CSS animation duration
        debounceDelay: 300      // Search input debounce delay
    },
    
    // Local Storage Keys
    storage: {
        matches: 'football_matches_cache',
        lastFetch: 'football_last_fetch',
        theme: 'football_theme_preference',
        filters: 'football_filters_state'
    },
    
    // CSS Classes
    classes: {
        loading: 'loading-spinner',
        error: 'error-message',
        noMatches: 'no-matches',
        matchCard: 'match-card',
        fadeIn: 'fade-in',
        slideIn: 'slide-in'
    }
};

/**
 * Application state object
 * Manages the current state of the application
 */
const APP_STATE = {
    matches: [],
    filteredMatches: [],
    leagues: new Set(),
    isLoading: false,
    lastFetch: null,
    currentTheme: 'dark',
    searchTerm: '',
    selectedLeague: '',
    refreshTimer: null,
    lastApiCall: 0,
    retryCount: 0
};

// ========================================
// DOM Element References
// ========================================

/**
 * DOM element references
 * Cached for performance optimization
 */
const ELEMENTS = {
    // Navigation elements
    themeToggle: null,
    refreshBtn: null,
    lastUpdated: null,
    
    // Control elements
    searchInput: null,
    leagueFilter: null,
    
    // Content elements
    matchesContainer: null,
    loadingSpinner: null,
    errorMessage: null,
    noMatches: null,
    retryBtn: null,
    
    // Template
    matchCardTemplate: null
};

// ========================================
// Utility Functions
// ========================================

/**
 * Debounce function to limit function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function to limit function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Format date to local timezone string
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date string
 */
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return 'Invalid Date';
        }
        
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        console.error('Error formatting date:', error);
        return 'Unknown Date';
    }
}

/**
 * Format time to local timezone string
 * @param {string} timeString - Time string or ISO datetime
 * @returns {string} Formatted time string
 */
function formatTime(timeString) {
    try {
        let date;
        
        // Handle different time formats
        if (timeString.includes('T') || timeString.includes(' ')) {
            // Full datetime string
            date = new Date(timeString);
        } else if (timeString.includes(':')) {
            // Time only string (assume today)
            const today = new Date().toDateString();
            date = new Date(`${today} ${timeString}`);
        } else {
            // Fallback: try to parse as is
            date = new Date(timeString);
        }
        
        if (isNaN(date.getTime())) {
            return 'TBD';
        }
        
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        console.error('Error formatting time:', error);
        return 'TBD';
    }
}

/**
 * Get current timestamp
 * @returns {number} Current timestamp in milliseconds
 */
function getCurrentTimestamp() {
    return Date.now();
}

/**
 * Check if cache is valid
 * @param {number} lastFetch - Last fetch timestamp
 * @returns {boolean} True if cache is valid
 */
function isCacheValid(lastFetch) {
    if (!lastFetch) return false;
    return (getCurrentTimestamp() - lastFetch) < CONFIG.app.cacheExpiry;
}

/**
 * Sanitize string for safe HTML insertion
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Generate fallback image URL
 * @param {string} type - Type of image (team/league)
 * @param {string} name - Name for the image
 * @returns {string} Fallback image URL
 */
function getFallbackImage(type, name) {
    const encodedName = encodeURIComponent(name || 'Unknown');
    const size = type === 'team' ? '64x64' : '32x32';
    return `https://storage.googleapis.com/workspace-0f70711f-8b4e-4d94-86f1-2a93ccde5887/image/e44e441c-8da7-40a3-a0e9-36744df4d801.png}?text=${encodedName}`;
}

/**
 * Show notification to user
 * @param {string} message - Message to show
 * @param {string} type - Type of notification (success, error, info)
 */
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');
    
    // Style notification
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 20px',
        backgroundColor: type === 'error' ? 'var(--color-accent)' : 'var(--color-primary)',
        color: 'var(--color-text-inverse)',
        borderRadius: 'var(--radius-base)',
        boxShadow: '0 4px 12px var(--color-shadow-medium)',
        zIndex: 'var(--z-modal)',
        maxWidth: '300px',
        fontSize: 'var(--font-size-sm)',
        lineHeight: 'var(--line-height-base)',
        transform: 'translateX(100%)',
        transition: 'transform var(--transition-base)',
        pointerEvents: 'auto'
    });
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after delay
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// ========================================
// Local Storage Functions
// ========================================

/**
 * Save data to local storage
 * @param {string} key - Storage key
 * @param {*} data - Data to store
 */
function saveToStorage(key, data) {
    try {
        const serializedData = JSON.stringify(data);
        localStorage.setItem(key, serializedData);
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }
}

/**
 * Load data from local storage
 * @param {string} key - Storage key
 * @returns {*} Retrieved data or null
 */
function loadFromStorage(key) {
    try {
        const serializedData = localStorage.getItem(key);
        return serializedData ? JSON.parse(serializedData) : null;
    } catch (error) {
        console.error('Error loading from localStorage:', error);
        return null;
    }
}

/**
 * Remove data from local storage
 * @param {string} key - Storage key
 */
function removeFromStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.error('Error removing from localStorage:', error);
    }
}

/**
 * Clear all application data from local storage
 */
function clearAllStorage() {
    try {
        Object.values(CONFIG.storage).forEach(key => {
            localStorage.removeItem(key);
        });
        console.log('All storage cleared');
    } catch (error) {
        console.error('Error clearing storage:', error);
    }
}

// ========================================
// Theme Management
// ========================================

/**
 * Initialize theme system
 * Sets up theme based on user preference or system preference
 */
function initializeTheme() {
    // Load saved theme preference
    const savedTheme = loadFromStorage(CONFIG.storage.theme);
    
    // Determine initial theme
    let initialTheme = savedTheme;
    if (!initialTheme) {
        // Check system preference
        initialTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    
    // Apply initial theme
    setTheme(initialTheme, false);
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!loadFromStorage(CONFIG.storage.theme)) {
            // Only auto-switch if user hasn't manually set a preference
            setTheme(e.matches ? 'light' : 'dark', false);
        }
    });
}

/**
 * Set application theme
 * @param {string} theme - Theme name ('light' or 'dark')
 * @param {boolean} save - Whether to save preference to storage
 */
function setTheme(theme, save = true) {
    // Validate theme
    if (!['light', 'dark'].includes(theme)) {
        console.warn('Invalid theme:', theme);
        return;
    }
    
    // Update DOM
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update state
    APP_STATE.currentTheme = theme;
    
    // Save preference
    if (save) {
        saveToStorage(CONFIG.storage.theme, theme);
    }
    
    // Update theme toggle button accessibility
    updateThemeToggleAccessibility();
    
    console.log('Theme set to:', theme);
}

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
    const newTheme = APP_STATE.currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    
    // Show notification
    showNotification(`Switched to ${newTheme} theme`, 'info');
    
    // Analytics (if implemented)
    if (typeof gtag !== 'undefined') {
        gtag('event', 'theme_toggle', {
            'theme': newTheme
        });
    }
}

/**
 * Update theme toggle button accessibility
 */
function updateThemeToggleAccessibility() {
    const themeToggle = ELEMENTS.themeToggle;
    if (!themeToggle) return;
    
    const currentTheme = APP_STATE.currentTheme;
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
    themeToggle.setAttribute('title', `Switch to ${nextTheme} theme`);
}

// ========================================
// API Functions
// ========================================

/**
 * Make HTTP request with error handling and retry logic
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response data
 */
async function makeRequest(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
        // Rate limiting
        const now = getCurrentTimestamp();
        const timeSinceLastCall = now - APP_STATE.lastApiCall;
        const minDelay = CONFIG.api.primary.rateLimit;
        
        if (timeSinceLastCall < minDelay) {
            await new Promise(resolve => setTimeout(resolve, minDelay - timeSinceLastCall));
        }
        
        APP_STATE.lastApiCall = getCurrentTimestamp();
        
        // Make request
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return data;
        
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            throw new Error('Request timed out');
        }
        
        throw error;
    }
}

/**
 * Fetch today's matches from TheSportsDB API
 * @returns {Promise<Array>} Array of match objects
 */
async function fetchTodayMatches() {
    try {
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        
        // Construct API URL
        const url = `${CONFIG.api.primary.baseUrl}${CONFIG.api.primary.endpoints.todayMatches}?d=${today}&s=Soccer`;
        
        console.log('Fetching matches from:', url);
        
        // Make API request
        const data = await makeRequest(url);
        
        // Extract events from response
        const events = data.events || [];
        
        // Transform data to standardized format
        const matches = events.map(event => ({
            id: event.idEvent,
            homeTeam: {
                id: event.idHomeTeam,
                name: event.strHomeTeam,
                logo: event.strHomeTeamBadge || getFallbackImage('team', event.strHomeTeam)
            },
            awayTeam: {
                id: event.idAwayTeam,
                name: event.strAwayTeam,
                logo: event.strAwayTeamBadge || getFallbackImage('team', event.strAwayTeam)
            },
            league: {
                id: event.idLeague,
                name: event.strLeague,
                logo: event.strLeagueBadge || getFallbackImage('league', event.strLeague),
                country: event.strCountry
            },
            score: {
                home: event.intHomeScore || null,
                away: event.intAwayScore || null
            },
            status: determineMatchStatus(event),
            time: event.strTime,
            date: event.dateEvent,
            venue: event.strVenue,
            season: event.strSeason,
            round: event.intRound
        }));
        
        console.log(`Fetched ${matches.length} matches`);
        return matches;
        
    } catch (error) {
        console.error('Error fetching matches:', error);
        throw error;
    }
}

/**
 * Determine match status from API response
 * @param {Object} event - Event object from API
 * @returns {string} Match status
 */
function determineMatchStatus(event) {
    // Check if match has finished
    if (event.strStatus === 'Match Finished' || 
        (event.intHomeScore !== null && event.intAwayScore !== null)) {
        return 'finished';
    }
    
    // Check if match is live
    if (event.strStatus === 'Live' || event.strStatus === '1H' || 
        event.strStatus === '2H' || event.strStatus === 'HT') {
        return 'live';
    }
    
    // Check if match is scheduled for today
    const today = new Date().toISOString().split('T')[0];
    if (event.dateEvent === today) {
        return 'scheduled';
    }
    
    return 'scheduled';
}

/**
 * Fetch matches with retry logic and caching
 * @param {boolean} forceRefresh - Force refresh bypassing cache
 * @returns {Promise<Array>} Array of match objects
 */
async function fetchMatchesWithCache(forceRefresh = false) {
    try {
        // Check cache if not forcing refresh
        if (!forceRefresh) {
            const cachedMatches = loadFromStorage(CONFIG.storage.matches);
            const lastFetch = loadFromStorage(CONFIG.storage.lastFetch);
            
            if (cachedMatches && isCacheValid(lastFetch)) {
                console.log('Using cached matches');
                return cachedMatches;
            }
        }
        
        // Reset retry count for new fetch
        APP_STATE.retryCount = 0;
        
        // Fetch fresh data
        const matches = await fetchTodayMatches();
        
        // Cache the results
        const now = getCurrentTimestamp();
        saveToStorage(CONFIG.storage.matches, matches);
        saveToStorage(CONFIG.storage.lastFetch, now);
        APP_STATE.lastFetch = now;
        
        return matches;
        
    } catch (error) {
        console.error('Error in fetchMatchesWithCache:', error);
        
        // Retry logic
        if (APP_STATE.retryCount < CONFIG.app.maxRetries) {
            APP_STATE.retryCount++;
            console.log(`Retrying... Attempt ${APP_STATE.retryCount}/${CONFIG.app.maxRetries}`);
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, CONFIG.app.retryDelay * APP_STATE.retryCount));
            
            return fetchMatchesWithCache(forceRefresh);
        }
        
        // All retries failed, try to use cached data
        const cachedMatches = loadFromStorage(CONFIG.storage.matches);
        if (cachedMatches && cachedMatches.length > 0) {
            console.log('Using stale cached data due to API failure');
            showNotification('Using cached data - unable to fetch latest results', 'error');
            return cachedMatches;
        }
        
        // No cached data available
        throw error;
    }
}

// ========================================
// Data Processing Functions
// ========================================

/**
 * Process and update matches data
 * @param {Array} matches - Raw matches array
 */
function processMatches(matches) {
    // Update app state
    APP_STATE.matches = matches;
    
    // Extract unique leagues
    APP_STATE.leagues.clear();
    matches.forEach(match => {
        if (match.league && match.league.name) {
            APP_STATE.leagues.add(match.league.name);
        }
    });
    
    // Sort matches by time
    APP_STATE.matches.sort((a, b) => {
        if (a.status !== b.status) {
            // Prioritize live matches
            if (a.status === 'live') return -1;
            if (b.status === 'live') return 1;
            
            // Then finished matches
            if (a.status === 'finished') return 1;
            if (b.status === 'finished') return -1;
        }
        
        // Sort by time
        return new Date(`${a.date} ${a.time}`) - new Date(`${b.date} ${b.time}`);
    });
    
    // Update league filter options
    updateLeagueFilter();
    
    // Apply current filters
    applyFilters();
    
    console.log('Processed matches:', APP_STATE.matches.length);
}

/**
 * Filter matches based on current search and filter criteria
 */
function applyFilters() {
    let filtered = [...APP_STATE.matches];
    
    // Apply search filter
    if (APP_STATE.searchTerm) {
        const searchLower = APP_STATE.searchTerm.toLowerCase();
        filtered = filtered.filter(match => 
            match.homeTeam.name.toLowerCase().includes(searchLower) ||
            match.awayTeam.name.toLowerCase().includes(searchLower) ||
            match.league.name.toLowerCase().includes(searchLower)
        );
    }
    
    // Apply league filter
    if (APP_STATE.selectedLeague) {
        filtered = filtered.filter(match => 
            match.league.name === APP_STATE.selectedLeague
        );
    }
    
    APP_STATE.filteredMatches = filtered;
    
    // Save filter state
    saveToStorage(CONFIG.storage.filters, {
        searchTerm: APP_STATE.searchTerm,
        selectedLeague: APP_STATE.selectedLeague
    });
    
    console.log(`Applied filters: ${filtered.length}/${APP_STATE.matches.length} matches`);
}

/**
 * Update league filter dropdown options
 */
function updateLeagueFilter() {
    const leagueFilter = ELEMENTS.leagueFilter;
    if (!leagueFilter) return;
    
    // Clear existing options (except "All Leagues")
    const options = Array.from(leagueFilter.options);
    options.slice(1).forEach(option => option.remove());
    
    // Add league options
    const sortedLeagues = Array.from(APP_STATE.leagues).sort();
    sortedLeagues.forEach(league => {
        const option = document.createElement('option');
        option.value = league;
        option.textContent = league;
        leagueFilter.appendChild(option);
    });
    
    // Restore selected league
    leagueFilter.value = APP_STATE.selectedLeague;
}

// ========================================
// DOM Rendering Functions
// ========================================

/**
 * Show loading state
 */
function showLoading() {
    if (ELEMENTS.loadingSpinner) {
        ELEMENTS.loadingSpinner.style.display = 'flex';
    }
    hideError();
    hideNoMatches();
    hideMatches();
    
    APP_STATE.isLoading = true;
    
    // Update refresh button state
    if (ELEMENTS.refreshBtn) {
        ELEMENTS.refreshBtn.classList.add('spinning');
        ELEMENTS.refreshBtn.disabled = true;
    }
}

/**
 * Hide loading state
 */
function hideLoading() {
    if (ELEMENTS.loadingSpinner) {
        ELEMENTS.loadingSpinner.style.display = 'none';
    }
    
    APP_STATE.isLoading = false;
    
    // Update refresh button state
    if (ELEMENTS.refreshBtn) {
        ELEMENTS.refreshBtn.classList.remove('spinning');
        ELEMENTS.refreshBtn.disabled = false;
    }
}

/**
 * Show error message
 * @param {string} message - Error message to display
 */
function showError(message = 'Unable to load matches. Please try again.') {
    if (ELEMENTS.errorMessage) {
        ELEMENTS.errorMessage.style.display = 'block';
        
        const errorDescription = document.getElementById('error-description');
        if (errorDescription) {
            errorDescription.textContent = message;
        }
    }
    
    hideLoading();
    hideNoMatches();
    hideMatches();
}

/**
 * Hide error message
 */
function hideError() {
    if (ELEMENTS.errorMessage) {
        ELEMENTS.errorMessage.style.display = 'none';
    }
}

/**
 * Show no matches message
 */
function showNoMatches() {
    if (ELEMENTS.noMatches) {
        ELEMENTS.noMatches.style.display = 'block';
    }
    
    hideLoading();
    hideError();
    hideMatches();
}

/**
 * Hide no matches message
 */
function hideNoMatches() {
    if (ELEMENTS.noMatches) {
        ELEMENTS.noMatches.style.display = 'none';
    }
}

/**
 * Show matches container
 */
function showMatches() {
    if (ELEMENTS.matchesContainer) {
        ELEMENTS.matchesContainer.style.display = 'grid';
    }
    
    hideLoading();
    hideError();
    hideNoMatches();
}

/**
 * Hide matches container
 */
function hideMatches() {
    if (ELEMENTS.matchesContainer) {
        ELEMENTS.matchesContainer.style.display = 'none';
    }
}

/**
 * Create match card element
 * @param {Object} match - Match data object
 * @returns {HTMLElement} Match card element
 */
function createMatchCard(match) {
    // Clone template
    const template = ELEMENTS.matchCardTemplate;
    if (!template) {
        console.error('Match card template not found');
        return null;
    }
    
    const card = template.content.cloneNode(true);
    const cardElement = card.querySelector('.match-card');
    
    // Set match ID for reference
    cardElement.setAttribute('data-match-id', match.id);
    
    // League Information
    const leagueInfo = card.querySelector('.league-info');
    const leagueLogo = card.querySelector('.league-logo');
    const leagueName = card.querySelector('.league-name');
    
    if (leagueLogo) {
        leagueLogo.src = match.league.logo;
        leagueLogo.alt = `${match.league.name} logo`;
        leagueLogo.onerror = () => {
            leagueLogo.src = getFallbackImage('league', match.league.name);
        };
    }
    
    if (leagueName) {
        leagueName.textContent = match.league.name;
        leagueName.title = `${match.league.name}${match.league.country ? ` (${match.league.country})` : ''}`;
    }
    
    // Match Status
    const statusBadge = card.querySelector('.status-badge');
    if (statusBadge) {
        statusBadge.textContent = getStatusText(match.status);
        statusBadge.className = `status-badge ${match.status}`;
        statusBadge.setAttribute('aria-label', `Match status: ${getStatusText(match.status)}`);
    }
    
    // Home Team
    const homeTeamLogo = card.querySelector('.home-team .team-logo');
    const homeTeamName = card.querySelector('.home-team .team-name');
    
    if (homeTeamLogo) {
        homeTeamLogo.src = match.homeTeam.logo;
        homeTeamLogo.alt = `${match.homeTeam.name} logo`;
        homeTeamLogo.onerror = () => {
            homeTeamLogo.src = getFallbackImage('team', match.homeTeam.name);
        };
    }
    
    if (homeTeamName) {
        homeTeamName.textContent = match.homeTeam.name;
    }
    
    // Away Team
    const awayTeamLogo = card.querySelector('.away-team .team-logo');
    const awayTeamName = card.querySelector('.away-team .team-name');
    
    if (awayTeamLogo) {
        awayTeamLogo.src = match.awayTeam.logo;
        awayTeamLogo.alt = `${match.awayTeam.name} logo`;
        awayTeamLogo.onerror = () => {
            awayTeamLogo.src = getFallbackImage('team', match.awayTeam.name);
        };
    }
    
    if (awayTeamName) {
        awayTeamName.textContent = match.awayTeam.name;
    }
    
    // Score/Time Information
    const homeScore = card.querySelector('.home-score');
    const awayScore = card.querySelector('.away-score');
    const matchTime = card.querySelector('.match-time');
    
    if (match.status === 'finished' || match.status === 'live') {
        // Show scores
        if (homeScore) homeScore.textContent = match.score.home !== null ? match.score.home : '0';
        if (awayScore) awayScore.textContent = match.score.away !== null ? match.score.away : '0';
        if (matchTime) {
            matchTime.textContent = match.status === 'live' ? 'LIVE' : 'FT';
        }
    } else {
        // Show scheduled time
        if (homeScore) homeScore.textContent = '-';
        if (awayScore) awayScore.textContent = '-';
        if (matchTime) {
            matchTime.textContent = formatTime(match.time);
        }
    }
    
    // Match Details
    const venue = card.querySelector('.venue');
    const matchDate = card.querySelector('.match-date');
    
    if (venue) {
        venue.textContent = match.venue || 'TBD';
        venue.title = match.venue || 'Venue to be determined';
    }
    
    if (matchDate) {
        matchDate.textContent = formatDate(match.date);
    }
    
    // Accessibility
    cardElement.setAttribute('role', 'article');
    cardElement.setAttribute('aria-label', 
        `${match.homeTeam.name} vs ${match.awayTeam.name}, ${match.league.name}, ${getStatusText(match.status)}`
    );
    
    // Add animation class
    cardElement.classList.add(CONFIG.classes.fadeIn);
    
    return card;
}

/**
 * Get human-readable status text
 * @param {string} status - Match status
 * @returns {string} Human-readable status
 */
function getStatusText(status) {
    const statusMap = {
        'scheduled': 'Scheduled',
        'live': 'Live',
        'finished': 'Finished'
    };
    
    return statusMap[status] || 'Unknown';
}

/**
 * Render matches to the DOM
 */
function renderMatches() {
    const container = ELEMENTS.matchesContainer;
    if (!container) {
        console.error('Matches container not found');
        return;
    }
    
    // Clear existing matches
    container.innerHTML = '';
    
    // Check if we have matches to display
    if (!APP_STATE.filteredMatches || APP_STATE.filteredMatches.length === 0) {
        showNoMatches();
        return;
    }
    
    // Create and append match cards
    const fragment = document.createDocumentFragment();
    
    APP_STATE.filteredMatches.forEach((match, index) => {
        const card = createMatchCard(match);
        if (card) {
            // Add staggered animation delay
            const cardElement = card.querySelector('.match-card');
            cardElement.style.animationDelay = `${index * 50}ms`;
            fragment.appendChild(card);
        }
    });
    
    container.appendChild(fragment);
    
    // Show matches container
    showMatches();
    
    // Update last updated time
    updateLastUpdatedTime();
    
    console.log(`Rendered ${APP_STATE.filteredMatches.length} matches`);
}

/**
 * Update last updated time display
 */
function updateLastUpdatedTime() {
    const lastUpdatedElement = ELEMENTS.lastUpdated;
    if (!lastUpdatedElement) return;
    
    const lastUpdatedText = lastUpdatedElement.querySelector('.last-updated-text');
    if (!lastUpdatedText) return;
    
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    
    lastUpdatedText.textContent = `Last updated: ${timeString}`;
}

// ========================================
// Event Handlers
// ========================================

/**
 * Handle search input changes
 * @param {Event} event - Input event
 */
function handleSearchInput(event) {
    APP_STATE.searchTerm = event.target.value.trim();
    applyFilters();
    renderMatches();
}

/**
 * Handle league filter changes
 * @param {Event} event - Change event
 */
function handleLeagueFilterChange(event) {
    APP_STATE.selectedLeague = event.target.value;
    applyFilters();
    renderMatches();
}

/**
 * Handle refresh button click
 */
async function handleRefresh() {
    if (APP_STATE.isLoading) return;
    
    try {
        await loadMatches(true); // Force refresh
        showNotification('Matches updated successfully', 'success');
    } catch (error) {
        console.error('Refresh failed:', error);
        showNotification('Failed to refresh matches', 'error');
    }
}

/**
 * Handle retry button click
 */
async function handleRetry() {
    try {
        await loadMatches(true); // Force refresh
    } catch (error) {
        console.error('Retry failed:', error);
    }
}

/**
 * Handle keyboard shortcuts
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleKeyboardShortcuts(event) {
    // Ctrl/Cmd + R: Refresh
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
        event.preventDefault();
        handleRefresh();
        return;
    }
    
    // Ctrl/Cmd + K: Focus search
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        if (ELEMENTS.searchInput) {
            ELEMENTS.searchInput.focus();
        }
        return;
    }
    
    // T: Toggle theme
    if (event.key === 't' && !event.ctrlKey && !event.metaKey && 
        !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
        event.preventDefault();
        toggleTheme();
        return;
    }
}

/**
 * Handle window visibility change (for auto-refresh)
 */
function handleVisibilityChange() {
    if (document.hidden) {
        // Page is hidden, stop auto-refresh
        stopAutoRefresh();
    } else {
        // Page is visible, start auto-refresh and check for updates
        startAutoRefresh();
        
        // Check if data is stale
        const lastFetch = loadFromStorage(CONFIG.storage.lastFetch);
        if (!isCacheValid(lastFetch)) {
            handleRefresh();
        }
    }
}

/**
 * Handle online/offline status changes
 */
function handleOnlineStatusChange() {
    if (navigator.onLine) {
        console.log('Browser is online');
        showNotification('Connection restored', 'success');
        
        // Refresh data if we're online
        const lastFetch = loadFromStorage(CONFIG.storage.lastFetch);
        if (!isCacheValid(lastFetch)) {
            handleRefresh();
        }
    } else {
        console.log('Browser is offline');
        showNotification('No internet connection', 'error');
    }
}

// ========================================
// Auto-refresh Functions
// ========================================

/**
 * Start auto-refresh timer
 */
function startAutoRefresh() {
    // Clear existing timer
    stopAutoRefresh();
    
    // Set new timer
    APP_STATE.refreshTimer = setInterval(async () => {
        try {
            console.log('Auto-refreshing matches...');
            await loadMatches(true);
            console.log('Auto-refresh completed');
        } catch (error) {
            console.error('Auto-refresh failed:', error);
        }
    }, CONFIG.app.refreshInterval);
    
    console.log(`Auto-refresh started (${CONFIG.app.refreshInterval / 1000}s interval)`);
}

/**
 * Stop auto-refresh timer
 */
function stopAutoRefresh() {
    if (APP_STATE.refreshTimer) {
        clearInterval(APP_STATE.refreshTimer);
        APP_STATE.refreshTimer = null;
        console.log('Auto-refresh stopped');
    }
}

// ========================================
// Main Application Functions
// ========================================

/**
 * Load and display matches
 * @param {boolean} forceRefresh - Force refresh bypassing cache
 */
async function loadMatches(forceRefresh = false) {
    try {
        showLoading();
        
        // Fetch matches data
        const matches = await fetchMatchesWithCache(forceRefresh);
        
        // Process and render matches
        processMatches(matches);
        renderMatches();
        
        console.log('Matches loaded successfully');
        
    } catch (error) {
        console.error('Failed to load matches:', error);
        
        // Show error message
        const errorMessage = error.message || 'Unable to load matches. Please check your internet connection and try again.';
        showError(errorMessage);
    }
}

/**
 * Initialize DOM element references
 */
function initializeElements() {
    // Navigation elements
    ELEMENTS.themeToggle = document.getElementById('theme-toggle');
    ELEMENTS.refreshBtn = document.getElementById('refresh-btn');
    ELEMENTS.lastUpdated = document.getElementById('last-updated');
    
    // Control elements
    ELEMENTS.searchInput = document.getElementById('search-input');
    ELEMENTS.leagueFilter = document.getElementById('league-filter');
    
    // Content elements
    ELEMENTS.matchesContainer = document.getElementById('matches-container');
    ELEMENTS.loadingSpinner = document.getElementById('loading-spinner');
    ELEMENTS.errorMessage = document.getElementById('error-message');
    ELEMENTS.noMatches = document.getElementById('no-matches');
    ELEMENTS.retryBtn = document.getElementById('retry-btn');
    
    // Template
    ELEMENTS.matchCardTemplate = document.getElementById('match-card-template');
    
    // Validate critical elements
    const criticalElements = ['matchesContainer', 'loadingSpinner', 'matchCardTemplate'];
    const missingElements = criticalElements.filter(name => !ELEMENTS[name]);
    
    if (missingElements.length > 0) {
        console.error('Missing critical DOM elements:', missingElements);
        throw new Error('Required DOM elements are missing');
    }
    
    console.log('DOM elements initialized');
}

/**
 * Initialize event listeners
 */
function initializeEventListeners() {
    // Theme toggle
    if (ELEMENTS.themeToggle) {
        ELEMENTS.themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Refresh button
    if (ELEMENTS.refreshBtn) {
        ELEMENTS.refreshBtn.addEventListener('click', handleRefresh);
    }
    
    // Search input with debouncing
    if (ELEMENTS.searchInput) {
        const debouncedSearch = debounce(handleSearchInput, CONFIG.app.debounceDelay);
        ELEMENTS.searchInput.addEventListener('input', debouncedSearch);
    }
    
    // League filter
    if (ELEMENTS.leagueFilter) {
        ELEMENTS.leagueFilter.addEventListener('change', handleLeagueFilterChange);
    }
    
    // Retry button
    if (ELEMENTS.retryBtn) {
        ELEMENTS.retryBtn.addEventListener('click', handleRetry);
    }
    
    // Window event listeners
    document.addEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnlineStatusChange);
    window.addEventListener('offline', handleOnlineStatusChange);
    
    // Window beforeunload (cleanup)
    window.addEventListener('beforeunload', () => {
        stopAutoRefresh();
    });
    
    console.log('Event listeners initialized');
}

/**
 * Restore application state from storage
 */
function restoreApplicationState() {
    // Restore filter state
    const savedFilters = loadFromStorage(CONFIG.storage.filters);
    if (savedFilters) {
        APP_STATE.searchTerm = savedFilters.searchTerm || '';
        APP_STATE.selectedLeague = savedFilters.selectedLeague || '';
        
        // Update UI controls
        if (ELEMENTS.searchInput) {
            ELEMENTS.searchInput.value = APP_STATE.searchTerm;
        }
        
        if (ELEMENTS.leagueFilter) {
            ELEMENTS.leagueFilter.value = APP_STATE.selectedLeague;
        }
    }
    
    console.log('Application state restored');
}

/**
 * Initialize the application
 */
async function initializeApplication() {
    try {
        console.log('Initializing Football Results application...');
        
        // Initialize DOM elements
        initializeElements();
        
        // Initialize theme system
        initializeTheme();
        
        // Initialize event listeners
        initializeEventListeners();
        
        // Restore application state
        restoreApplicationState();
        
        // Load initial data
        await loadMatches();
        
        // Start auto-refresh
        startAutoRefresh();
        
        console.log('Application initialized successfully');
        
        // Show welcome notification
        setTimeout(() => {
            showNotification('Football Results loaded successfully', 'success');
        }, 1000);
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        
        // Show critical error
        showError('Failed to initialize application. Please refresh the page.');
    }
}

// ========================================
// Application Entry Point
// ========================================

/**
 * Application entry point
 * Waits for DOM to be ready then initializes the application
 */
(function() {
    'use strict';
    
    // Check for required APIs
    if (!window.fetch) {
        console.error('Fetch API is not supported in this browser');
        alert('Your browser is not supported. Please update to a modern browser.');
        return;
    }
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApplication);
    } else {
        // DOM is already ready
        initializeApplication();
    }
    
    // Global error handler
    window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
        showNotification('An unexpected error occurred', 'error');
    });
    
    // Unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
        showNotification('An unexpected error occurred', 'error');
        event.preventDefault();
    });
    
})();

// ========================================
// Developer Tools (Development Only)
// ========================================

// Add developer tools to window object for debugging
if (typeof window !== 'undefined') {
    window.FootballApp = {
        // Application state
        getState: () => ({ ...APP_STATE }),
        getConfig: () => ({ ...CONFIG }),
        
        // Utility functions
        clearCache: clearAllStorage,
        refresh: () => handleRefresh(),
        toggleTheme: toggleTheme,
        
        // Debug functions
        simulateError: () => {
            throw new Error('Simulated error for testing');
        },
        testNotification: (message, type) => {
            showNotification(message || 'Test notification', type || 'info');
        }
    };
}

/**
 * Console welcome message
 */
console.log(`
🏈 Football Results Website v1.0.0

Available developer commands:
- FootballApp.getState() - View current application state
- FootballApp.clearCache() - Clear all cached data
- FootballApp.refresh() - Manually refresh data
- FootballApp.toggleTheme() - Toggle theme

Keyboard shortcuts:
- Ctrl/Cmd + R: Refresh data
- Ctrl/Cmd + K: Focus search
- T: Toggle theme

For more information, visit: https://github.com/your-repo/football-results
`);
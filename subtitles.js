/**
 * Live Subtitles using Web Speech API
 * 
 * The Web Speech API is the industry-standard solution for browser-based
 * live captioning. It's built into the browser, real-time, and reliable.
 * 
 * Pros: Real-time (< 500ms latency), no model download, works immediately
 * Cons: Requires internet (Chrome sends to Google), not Whisper
 */

(function() {
'use strict';

// State
const SubtitleState = {
  recognition: null,
  isListening: false,
  enabled: false,
  displayTimeout: null,
  restartTimeout: null
};

// Configuration
const CONFIG = {
  maxDisplayDuration: 5000,
  maxWordsPerLine: 12,
  language: 'en-US',
  continuous: true,
  interimResults: true,
  debug: true
};

/**
 * Check if Web Speech API is supported
 */
function isSupported() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

/**
 * Create speech recognition instance
 */
function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  
  recognition.continuous = CONFIG.continuous;
  recognition.interimResults = CONFIG.interimResults;
  recognition.lang = CONFIG.language;
  recognition.maxAlternatives = 1;
  
  recognition.onstart = () => {
    if (CONFIG.debug) console.log('[Subtitles] Speech recognition started');
    updateStatus('active', 'Listening...');
  };
  
  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      
      if (event.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }
    
    // Show interim results immediately (real-time feel)
    if (interim) {
      displaySubtitle(interim, true);
    }
    
    // Show final results with highlighting
    if (final) {
      if (CONFIG.debug) console.log(`[Subtitles] Final: "${final}"`);
      displaySubtitle(final, false);
    }
  };
  
  recognition.onerror = (event) => {
    console.error('[Subtitles] Recognition error:', event.error);
    
    if (event.error === 'not-allowed') {
      updateStatus('error', 'Mic access denied');
      SubtitleState.isListening = false;
    } else if (event.error === 'no-speech') {
      // This is normal - just means silence detected
      if (CONFIG.debug) console.log('[Subtitles] No speech detected');
    } else if (event.error === 'network') {
      updateStatus('error', 'Network error');
    } else if (event.error === 'aborted') {
      // Recognition was stopped intentionally
    } else {
      updateStatus('error', event.error);
    }
  };
  
  recognition.onend = () => {
    if (CONFIG.debug) console.log('[Subtitles] Recognition ended');
    
    // Auto-restart if still supposed to be listening
    if (SubtitleState.isListening && SubtitleState.enabled) {
      // Small delay before restart to prevent rapid restart loops
      SubtitleState.restartTimeout = setTimeout(() => {
        if (SubtitleState.isListening && SubtitleState.enabled) {
          try {
            recognition.start();
            if (CONFIG.debug) console.log('[Subtitles] Restarted recognition');
          } catch (e) {
            console.error('[Subtitles] Failed to restart:', e);
          }
        }
      }, 100);
    }
  };
  
  return recognition;
}

/**
 * Start listening
 */
function startListening() {
  if (SubtitleState.isListening) return;
  
  if (!isSupported()) {
    updateStatus('error', 'Speech API not supported');
    console.error('[Subtitles] Web Speech API not supported in this browser');
    return;
  }
  
  try {
    SubtitleState.recognition = createRecognition();
    SubtitleState.recognition.start();
    SubtitleState.isListening = true;
    console.log('[Subtitles] Started listening');
  } catch (error) {
    console.error('[Subtitles] Failed to start:', error);
    updateStatus('error', 'Failed to start');
  }
}

/**
 * Stop listening
 */
function stopListening() {
  if (!SubtitleState.isListening) return;
  
  SubtitleState.isListening = false;
  
  if (SubtitleState.restartTimeout) {
    clearTimeout(SubtitleState.restartTimeout);
    SubtitleState.restartTimeout = null;
  }
  
  if (SubtitleState.recognition) {
    try {
      SubtitleState.recognition.stop();
    } catch (e) {
      // Ignore - might already be stopped
    }
    SubtitleState.recognition = null;
  }
  
  hideSubtitle();
  updateStatus('', '');
  
  console.log('[Subtitles] Stopped listening');
}

/**
 * Display subtitle - highlights current word as it's being spoken
 */
function displaySubtitle(text, isInterim) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container || !text.trim()) return;
  
  const cleanText = text.trim();
  const words = cleanText.split(' ').filter(w => w.length > 0);
  const wrappedWords = wrapTextToFitScreen(words);
  
  // The last word is the one currently being spoken
  // Previous words have been spoken, no upcoming words yet (real-time)
  const wordSpans = wrappedWords.map((word, index) => {
    let className = 'word';
    if (index === wrappedWords.length - 1) {
      className += ' current'; // Last word = currently being spoken
    } else {
      className += ' spoken';  // Previous words = already spoken
    }
    return `<span class="${className}">${escapeHtml(word)}</span>`;
  }).join(' ');
  
  container.innerHTML = wordSpans;
  container.classList.add('has-highlight');
  
  if (!isInterim) {
    // Final result - briefly pulse the text
    container.classList.add('new-text');
    setTimeout(() => container.classList.remove('new-text'), 300);
  }
  
  overlay.style.display = 'flex';
  
  // Reset hide timeout
  if (SubtitleState.displayTimeout) {
    clearTimeout(SubtitleState.displayTimeout);
  }
  
  // Keep visible longer for final results
  const displayDuration = isInterim ? 3000 : CONFIG.maxDisplayDuration;
  SubtitleState.displayTimeout = setTimeout(hideSubtitle, displayDuration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function wrapTextToFitScreen(words) {
  const maxChars = Math.floor(window.innerWidth / 22);
  const result = [];
  let len = 0;
  
  for (const word of words) {
    if (result.length >= CONFIG.maxWordsPerLine * 2) break;
    if (len + word.length > maxChars && result.length > 0) {
      len = word.length;
    } else {
      len += word.length + 1;
    }
    result.push(word);
  }
  return result;
}

// Word highlighting now happens naturally as new words come in from speech recognition
// The last word is always "current", previous words are "spoken"

function hideSubtitle() {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (overlay) overlay.style.display = 'none';
  if (container) {
    container.innerHTML = '';
    container.classList.remove('has-highlight');
  }
}

function updateStatus(type, message) {
  const statusEl = document.getElementById('subtitle-status');
  if (!statusEl) return;
  
  statusEl.className = 'subtitle-status';
  if (type) statusEl.classList.add(type);
  statusEl.textContent = message;
}

/**
 * Toggle subtitles
 */
function toggleSubtitles(enabled) {
  SubtitleState.enabled = enabled;
  
  if (enabled) {
    if (window.presentationStarted) {
      startListening();
    }
  } else {
    stopListening();
  }
}

/**
 * Initialize
 */
function initSubtitles() {
  const toggle = document.getElementById('subtitlesEnabled');
  if (toggle) {
    toggle.addEventListener('change', (e) => toggleSubtitles(e.target.checked));
  }
  
  window.subtitleSystem = {
    onPresentationStart: () => {
      if (SubtitleState.enabled) {
        startListening();
      }
    },
    onPresentationEnd: () => stopListening(),
    isEnabled: () => SubtitleState.enabled,
    toggle: toggleSubtitles
  };
  
  const supported = isSupported();
  console.log(`[Subtitles] Initialized (Web Speech API${supported ? '' : ' - NOT SUPPORTED'})`);
  
  if (!supported) {
    updateStatus('error', 'Not supported');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

})(); // End IIFE

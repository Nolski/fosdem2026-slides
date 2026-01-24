var isPresenter = (window.location.search.indexOf("presenter") !== -1);

if (isPresenter) {
  // ---------- PRESENTER VIEW CODE ----------
  
  document.body.innerHTML = `
    <div id="presenter-controls" style="margin-bottom: 20px;">
       <button id="startPresBtn">Start Presentation</button>
       <button id="pauseBtn" style="display:none;">Pause</button>
       <span id="timerDisplay" style="display:none;">00:00:00</span>
       <button id="bleepBtn">🔇 Bleep</button>
       <span class="presenter-divider">|</span>
       <label class="presenter-toggle">
         <input type="checkbox" id="presenterSubtitles">
         <span class="presenter-toggle-label">Subtitles</span>
       </label>
       <label class="presenter-toggle offline-indicator">
         <input type="checkbox" id="presenterOfflineMode">
         <span class="presenter-toggle-label">Offline</span>
       </label>
       <span id="presenterSubtitleStatus" class="presenter-status"></span>
    </div>
    <div id="presenter-info">
      <h2>Current Slide</h2>
      <div id="current-preview" class="preview"></div>
      <h3>Speaker Notes</h3>
      <div id="current-notes"></div>
      <hr>
      <h2>Next Slide</h2>
      <div id="next-preview" class="preview"></div>
      <h3>Speaker Notes</h3>
      <div id="next-notes"></div>
    </div>
    <div id="video-controls" style="display:none; margin:10px;">
      <input type="range" id="seekSlider" min="0" max="100" value="0">
    </div>
  `;

  var presenterVideo = null;
  var timerInterval = null;
  var startTime = null;
  var pausedOffset = 0;
  var pausedStartTime = 0;
  var isPausedLocal = false;

  function updateTimer() {
    if (!isPausedLocal && startTime) {
      var elapsed = Date.now() - startTime - pausedOffset;
      document.getElementById("timerDisplay").innerText = formatTime(elapsed);
    }
  }

  function formatTime(ms) {
    var totalSeconds = Math.floor(ms / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return (
      (hours < 10 ? "0" + hours : hours) + ":" +
      (minutes < 10 ? "0" + minutes : minutes) + ":" +
      (seconds < 10 ? "0" + seconds : seconds)
    );
  }

  document.getElementById("startPresBtn").addEventListener("click", function() {
    if (window.opener && !window.opener.closed) {
      window.opener.startPresentation();
    }
    document.getElementById("startPresBtn").style.display = "none";
    document.getElementById("pauseBtn").style.display = "inline-block";
    document.getElementById("timerDisplay").style.display = "inline-block";
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
  });

  document.getElementById("pauseBtn").addEventListener("click", function() {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "togglePause" }, "*");
    }
    if (!isPausedLocal) {
      pausedStartTime = Date.now();
      isPausedLocal = true;
      this.innerText = "Resume";
    } else {
      pausedOffset += Date.now() - pausedStartTime;
      isPausedLocal = false;
      this.innerText = "Pause";
    }
  });

  var seekSlider = document.getElementById("seekSlider");
  if (seekSlider) {
    seekSlider.addEventListener("input", function(e) {
      if (presenterVideo && presenterVideo.duration) {
        presenterVideo.currentTime = (e.target.value / 100) * presenterVideo.duration;
      }
    });
  }

  function renderSlidePreview(slide, container, isCurrentSlide) {
    container.innerHTML = "";
    
    if (slide.type === "image") {
      var img = document.createElement("img");
      img.src = slide.src;
      img.style.maxWidth = "100%";
      container.appendChild(img);
      if (isCurrentSlide) {
        document.getElementById("video-controls").style.display = "none";
        presenterVideo = null;
      }
    } else if (slide.type === "video") {
      var video = document.createElement("video");
      video.src = slide.src;
      video.style.maxWidth = "100%";
      video.controls = true;
      if (isCurrentSlide) {
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.loop = true;
        presenterVideo = video;
        document.getElementById("video-controls").style.display = "block";
        video.addEventListener("timeupdate", function() {
          if (video.duration) {
            seekSlider.value = (video.currentTime / video.duration) * 100;
          }
        });
      }
      container.appendChild(video);
    } else if (slide.type === "placeholder") {
      var placeholderDiv = document.createElement("div");
      placeholderDiv.style.cssText = "background:" + (slide.backgroundColor || '#333') + ";padding:20px;text-align:center;color:white;min-height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center;";
      var bodyText = slide.text ? '<p style="margin:10px 0 0 0;opacity:0.8;">' + slide.text + '</p>' : '';
      placeholderDiv.innerHTML = '<h3 style="margin:0;">' + (slide.title || 'Placeholder') + '</h3>' + bodyText;
      container.appendChild(placeholderDiv);
      if (isCurrentSlide) {
        document.getElementById("video-controls").style.display = "none";
        presenterVideo = null;
      }
    }
  }

  window.addEventListener("message", function(event) {
    if (event.data.type === "update") {
      var currentIndex = event.data.currentSlideIndex;
      var slides = event.data.slides;
      var curSlide = slides[currentIndex];
      
      renderSlidePreview(curSlide, document.getElementById("current-preview"), true);
      
      var notes = (curSlide.notes || "").replace(/^Slide\s*\d+\s*:\s*/i, "");
      document.getElementById("current-notes").innerText = "[Slide " + (currentIndex + 1) + "] " + notes;

      var nextPreview = document.getElementById("next-preview");
      if (currentIndex + 1 < slides.length) {
        var nextSlide = slides[currentIndex + 1];
        renderSlidePreview(nextSlide, nextPreview, false);
        var nextNotes = (nextSlide.notes || "").replace(/^Slide\s*\d+\s*:\s*/i, "");
        document.getElementById("next-notes").innerText = "[Slide " + (currentIndex + 2) + "] " + nextNotes;
      } else {
        nextPreview.innerHTML = "<em>End of presentation</em>";
        document.getElementById("next-notes").innerText = "";
      }

      if (typeof event.data.paused !== "undefined") {
        if (event.data.paused && !isPausedLocal) {
          isPausedLocal = true;
          document.getElementById("pauseBtn").innerText = "Resume";
        } else if (!event.data.paused && isPausedLocal) {
          isPausedLocal = false;
          document.getElementById("pauseBtn").innerText = "Pause";
        }
      }
    }
  });

  document.addEventListener("keydown", function(e) {
    e.preventDefault();
    if (e.key === "ArrowRight" && window.opener && !window.opener.closed) {
      window.opener.advanceSlide();
    } else if (e.key === "ArrowLeft" && window.opener && !window.opener.closed) {
      window.opener.previousSlide();
    }
  });

  // Bleep button
  var bleepBtn = document.getElementById("bleepBtn");
  var audioCtx = null;
  var oscillator = null;

  bleepBtn.addEventListener("mousedown", function() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    oscillator = audioCtx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime);
    oscillator.connect(audioCtx.destination);
    oscillator.start();
  });

  function stopBleep() {
    if (oscillator) {
      oscillator.stop();
      oscillator.disconnect();
      oscillator = null;
    }
  }
  bleepBtn.addEventListener("mouseup", stopBleep);
  bleepBtn.addEventListener("mouseleave", stopBleep);

  // Subtitle controls in presenter view
  var presenterSubtitlesToggle = document.getElementById("presenterSubtitles");
  var presenterOfflineToggle = document.getElementById("presenterOfflineMode");
  var presenterSubtitleStatus = document.getElementById("presenterSubtitleStatus");

  presenterSubtitlesToggle.addEventListener("change", function() {
    if (window.opener && !window.opener.closed && window.opener.subtitleSystem) {
      window.opener.subtitleSystem.toggle(this.checked);
      // Also update the main window's checkbox
      var mainToggle = window.opener.document.getElementById("subtitlesEnabled");
      if (mainToggle) mainToggle.checked = this.checked;
    }
  });

  presenterOfflineToggle.addEventListener("change", function() {
    if (window.opener && !window.opener.closed && window.opener.subtitleSystem) {
      window.opener.subtitleSystem.setOfflineMode(this.checked);
      // Also update the main window's checkbox
      var mainToggle = window.opener.document.getElementById("offlineModeEnabled");
      if (mainToggle) mainToggle.checked = this.checked;
    }
  });

  // Sync initial state from main window
  function syncSubtitleState() {
    if (window.opener && !window.opener.closed && window.opener.subtitleSystem) {
      presenterSubtitlesToggle.checked = window.opener.subtitleSystem.isEnabled();
      presenterOfflineToggle.checked = window.opener.subtitleSystem.isOfflineMode();
    }
  }
  
  // Sync on load and periodically (to catch status changes)
  syncSubtitleState();
  setInterval(function() {
    syncSubtitleState();
    // Also sync status text
    if (window.opener && !window.opener.closed) {
      var mainStatus = window.opener.document.getElementById("subtitle-status");
      if (mainStatus && presenterSubtitleStatus) {
        presenterSubtitleStatus.textContent = mainStatus.textContent;
        presenterSubtitleStatus.className = mainStatus.className.replace("subtitle-status", "presenter-status");
      }
    }
  }, 500);

} else {
  // ---------- MAIN VIEW CODE ----------
  
  var slides = [];
  var audioTracks = [];
  var currentSlideIndex = 0;
  var selectedSlideIndex = -1;
  var selectedAudioIndex = -1;
  var presenterWindow = null;
  window.presentationStarted = false;
  var paused = false;
  window.currentMedia = null;
  var activeAudioElements = {};
  var canChangeSlide = true;

  // Slide layout: each slide block is 70px wide, with 6px gaps between all flex items
  // The slides timeline has drop indicators (0px effective width due to -2px margins) between slides
  // So each slide "slot" is: 70px slide + 6px gap + 0px drop + 6px gap = 82px
  // First slide starts at: 0px (initial drop) + 6px gap = 6px offset
  var BLOCK_WIDTH = 82;
  var TIMELINE_INITIAL_OFFSET = 6;

  // DOM elements
  var editModeBtn = document.getElementById("editModeBtn");
  var presentModeBtn = document.getElementById("presentModeBtn");
  var presentControls = document.getElementById("present-controls");
  var editControls = document.getElementById("edit-controls");
  var editModeContainer = document.getElementById("edit-mode");
  var presentationContainer = document.getElementById("presentation");
  
  var slidesTimeline = document.getElementById("slides-timeline");
  var audioTimeline = document.getElementById("audio-timeline");
  var slideCountDisplay = document.getElementById("slide-count-display");
  
  var slideEditor = document.getElementById("slide-editor");
  var audioEditor = document.getElementById("audio-editor");
  var slideForm = document.getElementById("slide-form");
  var audioForm = document.getElementById("audio-form");
  var editorPlaceholder = document.getElementById("editor-placeholder");
  var previewContainer = document.getElementById("preview-container");
  var slidePositionBadge = document.getElementById("slide-position-badge");
  
  var navControls = document.getElementById("nav-controls");
  var navFirstBtn = document.getElementById("navFirstBtn");
  var navPrevBtn = document.getElementById("navPrevBtn");
  var navNextBtn = document.getElementById("navNextBtn");
  var navLastBtn = document.getElementById("navLastBtn");
  
  var exportBtn = document.getElementById("exportBtn");
  var importBtn = document.getElementById("importBtn");
  var importInput = document.getElementById("importInput");
  
  var addVideoBtn = document.getElementById("addVideoBtn");
  var addImageBtn = document.getElementById("addImageBtn");
  var addPlaceholderBtn = document.getElementById("addPlaceholderBtn");
  var addAudioBtn = document.getElementById("addAudioBtn");
  var deleteSlideBtn = document.getElementById("deleteSlideBtn");
  var deleteAudioBtn = document.getElementById("deleteAudioBtn");
  
  var slideTypeSelect = document.getElementById("slide-type");
  var slideSrcInput = document.getElementById("slide-src");
  var slideNotesInput = document.getElementById("slide-notes");
  var slideLoopInput = document.getElementById("slide-loop");
  var slideZoompanInput = document.getElementById("slide-zoompan");
  var slideAutoAdvanceInput = document.getElementById("slide-auto-advance");
  var placeholderTitleInput = document.getElementById("placeholder-title");
  var placeholderTextInput = document.getElementById("placeholder-text");
  var placeholderColorInput = document.getElementById("placeholder-color");
  var srcGroup = document.getElementById("src-group");
  var placeholderGroup = document.getElementById("placeholder-group");
  var loopGroup = document.getElementById("loop-group");
  var zoompanGroup = document.getElementById("zoompan-group");
  var autoAdvanceGroup = document.getElementById("auto-advance-group");
  var videoVolumeGroup = document.getElementById("video-volume-group");
  var videoVolumeSlider = document.getElementById("video-volume");
  var videoVolumeValue = document.getElementById("video-volume-value");
  
  var audioSrcInput = document.getElementById("audio-src");
  var audioStartInput = document.getElementById("audio-start");
  var audioEndInput = document.getElementById("audio-end");
  var audioLoopInput = document.getElementById("audio-loop");
  var audioPreview = document.getElementById("audio-preview");
  var audioPreviewContainer = document.getElementById("audio-preview-container");
  
  var draggedIndex = null;
  
  function hideAudioPreview() {
    if (audioPreviewContainer) {
      audioPreviewContainer.style.display = "none";
      audioPreview.pause();
    }
  }

  // ============================================
  // LOCAL STORAGE VERSIONING
  // ============================================
  
  var LOCAL_STORAGE_KEY = "presentation_local_data";
  
  // Simple hash function for comparing data versions
  function hashData(data) {
    var str = JSON.stringify(data);
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }
  
  // Save current data to localStorage
  function saveToLocalStorage() {
    var data = { slides: slides, audio: audioTracks };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  }
  
  // Load data from localStorage
  function loadFromLocalStorage() {
    var stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error("Error parsing local storage data:", e);
        return null;
      }
    }
    return null;
  }
  
  // Clear local storage data
  function clearLocalStorage() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
  
  // Version conflict modal elements
  var versionConflictModal = document.getElementById("version-conflict-modal");
  var serverVersionInfo = document.getElementById("server-version-info");
  var localVersionInfo = document.getElementById("local-version-info");
  var versionUseServerBtn = document.getElementById("version-use-server");
  var versionUseLocalBtn = document.getElementById("version-use-local");
  
  // Show version conflict modal
  function showVersionConflictModal(serverData, localData) {
    var serverSlides = (serverData.slides || serverData || []).length;
    var serverAudio = (serverData.audio || []).length;
    var localSlides = (localData.slides || []).length;
    var localAudio = (localData.audio || []).length;
    
    serverVersionInfo.textContent = serverSlides + " slides, " + serverAudio + " audio";
    localVersionInfo.textContent = localSlides + " slides, " + localAudio + " audio";
    
    versionConflictModal.style.display = "flex";
  }
  
  function hideVersionConflictModal() {
    versionConflictModal.style.display = "none";
  }
  
  // Pending data for conflict resolution
  var pendingServerData = null;
  var pendingLocalData = null;
  
  // Handle "Use Server Version" click
  versionUseServerBtn.addEventListener("click", function() {
    if (pendingServerData) {
      slides = pendingServerData.slides || pendingServerData || [];
      audioTracks = pendingServerData.audio || [];
      // Clear local storage so we start fresh from server
      clearLocalStorage();
      renderTimelines();
    }
    hideVersionConflictModal();
    pendingServerData = null;
    pendingLocalData = null;
  });
  
  // Handle "Restore Local Copy" click
  versionUseLocalBtn.addEventListener("click", function() {
    if (pendingLocalData) {
      slides = pendingLocalData.slides || [];
      audioTracks = pendingLocalData.audio || [];
      renderTimelines();
    }
    hideVersionConflictModal();
    pendingServerData = null;
    pendingLocalData = null;
  });
  
  // Load data with version checking
  fetch('data.json')
    .then(function(r) { return r.json(); })
    .then(function(serverData) {
      var serverHash = hashData(serverData);
      var localData = loadFromLocalStorage();
      
      // If we have local data that differs from server
      if (localData) {
        var localHash = hashData(localData);
        
        if (localHash !== serverHash) {
          // Local differs from server - show conflict modal
          pendingServerData = serverData;
          pendingLocalData = localData;
          // Load server data initially (user can switch to local)
          slides = serverData.slides || serverData || [];
          audioTracks = serverData.audio || [];
          renderTimelines();
          showVersionConflictModal(serverData, localData);
        } else {
          // Local matches server - use server data, clear local
          slides = serverData.slides || serverData || [];
          audioTracks = serverData.audio || [];
          renderTimelines();
          clearLocalStorage();
        }
      } else {
        // No local data - just use server
        slides = serverData.slides || serverData || [];
        audioTracks = serverData.audio || [];
        renderTimelines();
      }
    })
    .catch(function(e) {
      console.error("Error loading data:", e);
      // Try to load from local storage as fallback
      var localData = loadFromLocalStorage();
      if (localData) {
        slides = localData.slides || [];
        audioTracks = localData.audio || [];
      } else {
        slides = [];
        audioTracks = [];
      }
      renderTimelines();
    });

  // Mode switching
  function switchToEditMode() {
    editModeBtn.classList.add("active");
    presentModeBtn.classList.remove("active");
    presentControls.style.display = "none";
    editControls.style.display = "flex";
    document.body.classList.remove("present-mode");
    editModeContainer.style.display = "flex";
    presentationContainer.classList.remove("active");
    window.presentationStarted = false;
    paused = false;
    if (window.currentMedia) { window.currentMedia.pause(); window.currentMedia = null; }
    for (var k in activeAudioElements) { activeAudioElements[k].pause(); delete activeAudioElements[k]; }
    
    // Stop subtitle system when exiting presentation
    if (window.subtitleSystem) {
      window.subtitleSystem.onPresentationEnd();
    }
  }
  
  function switchToPresentMode() {
    editModeBtn.classList.remove("active");
    presentModeBtn.classList.add("active");
    presentControls.style.display = "flex";
    editControls.style.display = "none";
    editModeContainer.style.display = "none";
    presentationContainer.classList.add("active");
    currentSlideIndex = selectedSlideIndex >= 0 ? selectedSlideIndex : 0;
  }
  
  editModeBtn.addEventListener("click", switchToEditMode);
  presentModeBtn.addEventListener("click", switchToPresentMode);

  // Timeline rendering
  function renderTimelines() {
    renderSlidesTimeline();
    renderAudioTimeline();
    slideCountDisplay.textContent = slides.length + " slide" + (slides.length !== 1 ? "s" : "");
    updateNavButtons();
  }
  
  function renderSlidesTimeline() {
    slidesTimeline.innerHTML = "";
    
    // Add initial drop indicator
    slidesTimeline.appendChild(createDropIndicator(0));
    
    slides.forEach(function(slide, i) {
      var block = document.createElement("div");
      block.className = "slide-block" + (i === selectedSlideIndex ? " selected" : "");
      block.dataset.index = i;
      block.draggable = true;
      
      // Set thumbnail background
      if (slide.type === "video" && slide.src) {
        // For video, we'll capture a frame using a hidden video element
        generateVideoThumbnail(slide.src, function(dataUrl) {
          if (dataUrl) block.style.backgroundImage = "url(" + dataUrl + ")";
        });
      } else if (slide.type === "image" && slide.src) {
        block.style.backgroundImage = "url(" + slide.src + ")";
      } else if (slide.type === "placeholder") {
        block.style.background = slide.backgroundColor || "#333";
      }
      
      var icon = slide.type === "video" ? "🎬" : slide.type === "image" ? "🖼️" : "⏳";
      block.innerHTML = '<div class="block-overlay"><div class="block-number">' + (i + 1) + '</div><div class="block-icon">' + icon + '</div></div>';
      
      block.addEventListener("click", function() { selectSlide(i); });
      
      // Drag events on slide blocks
      block.addEventListener("dragstart", function(e) {
        draggedIndex = i;
        setTimeout(function() { block.classList.add("dragging"); }, 0);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", i);
      });
      
      block.addEventListener("dragend", function() {
        block.classList.remove("dragging");
        clearAllDropIndicators();
        draggedIndex = null;
      });
      
      slidesTimeline.appendChild(block);
      
      // Add drop indicator after each slide
      slidesTimeline.appendChild(createDropIndicator(i + 1));
    });
  }
  
  // Generate thumbnail from video's first frame
  function generateVideoThumbnail(src, callback) {
    var video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.src = src;
    
    video.addEventListener("loadeddata", function() {
      video.currentTime = 0.1; // Seek to 0.1s to avoid blank frames
    });
    
    video.addEventListener("seeked", function() {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = 70;
        canvas.height = 55;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL("image/jpeg", 0.5));
      } catch (e) {
        callback(null);
      }
    });
    
    video.addEventListener("error", function() {
      callback(null);
    });
  }
  
  function createDropIndicator(insertIndex) {
    var indicator = document.createElement("div");
    indicator.className = "drop-indicator";
    indicator.dataset.insertIndex = insertIndex;
    
    indicator.addEventListener("dragover", function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (draggedIndex !== null) {
        // Don't show indicator right before or after the dragged item
        if (insertIndex !== draggedIndex && insertIndex !== draggedIndex + 1) {
          indicator.classList.add("visible");
        }
      }
    });
    
    indicator.addEventListener("dragleave", function() {
      indicator.classList.remove("visible");
    });
    
    indicator.addEventListener("drop", function(e) {
      e.preventDefault();
      indicator.classList.remove("visible");
      if (draggedIndex !== null) {
        var targetIndex = insertIndex;
        // Adjust target if dragging from before the drop point
        if (draggedIndex < insertIndex) {
          targetIndex = insertIndex - 1;
        }
        if (draggedIndex !== targetIndex) {
          moveSlide(draggedIndex, targetIndex);
        }
      }
    });
    
    return indicator;
  }
  
  function clearAllDropIndicators() {
    document.querySelectorAll(".drop-indicator").forEach(function(ind) {
      ind.classList.remove("visible");
    });
  }
  
  function renderAudioTimeline() {
    audioTimeline.innerHTML = "";
    if (!slides.length) return;
    
    audioTracks.forEach(function(track, i) {
      var el = document.createElement("div");
      el.className = "audio-track" + (i === selectedAudioIndex ? " selected" : "");
      el.dataset.index = i;
      
      var start = Math.max(0, track.startSlide);
      var end = Math.min(slides.length - 1, track.endSlide);
      // Position: initial offset + (start slide * block width) + 4px padding
      el.style.left = (TIMELINE_INITIAL_OFFSET + start * BLOCK_WIDTH + 4) + "px";
      // Width: spans from start slide to end slide (inclusive), minus padding on both sides
      // Each slide is 82px apart, but we want to end at the right edge of the last slide (70px wide)
      // So: (count * 82) - 12 (extra gap+drop at end) - 8 (4px padding each side) = count * 82 - 20
      el.style.width = Math.max(50, (end - start + 1) * BLOCK_WIDTH - 20) + "px";
      
      var filename = track.src.split('/').pop();
      el.innerHTML = '<span class="audio-icon">🔊</span><span class="audio-label">' + filename + '</span>';
      el.addEventListener("click", function() { selectAudioTrack(i); });
      audioTimeline.appendChild(el);
    });
    
    var wrapper = document.getElementById("audio-timeline-wrapper");
    if (wrapper) wrapper.style.minWidth = (TIMELINE_INITIAL_OFFSET + slides.length * BLOCK_WIDTH) + "px";
  }
  
  // Navigation controls
  function updateNavButtons() {
    navFirstBtn.disabled = slides.length === 0 || selectedSlideIndex === 0;
    navPrevBtn.disabled = slides.length === 0 || selectedSlideIndex <= 0;
    navNextBtn.disabled = slides.length === 0 || selectedSlideIndex >= slides.length - 1;
    navLastBtn.disabled = slides.length === 0 || selectedSlideIndex === slides.length - 1;
  }
  
  function moveSlide(from, to) {
    if (to < 0 || to >= slides.length || from === to) return;
    var slide = slides.splice(from, 1)[0];
    slides.splice(to, 0, slide);
    selectedSlideIndex = to;
    renderTimelines();
    scrollToSlide(to);
    saveToLocalStorage();
  }
  
  navFirstBtn.addEventListener("click", function() { if (slides.length) selectSlide(0); });
  navPrevBtn.addEventListener("click", function() { if (selectedSlideIndex > 0) selectSlide(selectedSlideIndex - 1); });
  navNextBtn.addEventListener("click", function() { if (selectedSlideIndex < slides.length - 1) selectSlide(selectedSlideIndex + 1); });
  navLastBtn.addEventListener("click", function() { if (slides.length) selectSlide(slides.length - 1); });
  
  function scrollToSlide(index) {
    var block = slidesTimeline.querySelector('[data-index="' + index + '"]');
    if (block) block.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  // Selection
  function selectSlide(index) {
    selectedSlideIndex = index;
    selectedAudioIndex = -1;
    
    document.querySelectorAll(".slide-block").forEach(function(b, i) { b.classList.toggle("selected", i === index); });
    document.querySelectorAll(".audio-track").forEach(function(t) { t.classList.remove("selected"); });
    
    slideEditor.style.display = "block";
    audioEditor.style.display = "none";
    editorPlaceholder.style.display = "none";
    slideForm.style.display = "flex";
    
    slidePositionBadge.textContent = "Slide " + (index + 1) + " of " + slides.length;
    slidePositionBadge.style.display = "inline-block";
    
    var slide = slides[index];
    slideTypeSelect.value = slide.type;
    slideSrcInput.value = slide.src || "";
    slideNotesInput.value = (slide.notes || "").replace(/^Slide\s*\d+\s*:\s*/i, "");
    slideLoopInput.checked = !!slide.loop;
    slideZoompanInput.checked = !!slide.zoompan;
    placeholderTitleInput.value = slide.title || "";
    placeholderTextInput.value = slide.text || "";
    placeholderColorInput.value = slide.backgroundColor || "#333333";
    
    // Load video-specific settings
    if (slide.type === "video") {
      if (videoVolumeSlider && videoVolumeValue) {
        var volume = slide.volume !== undefined ? slide.volume : 100;
        videoVolumeSlider.value = volume;
        videoVolumeValue.textContent = volume + "%";
      }
      if (slideAutoAdvanceInput) {
        slideAutoAdvanceInput.checked = !!slide.autoAdvance;
      }
    }
    
    updateFormVisibility(slide.type);
    updatePreview(slide);
    updateNavButtons();
    hideAudioPreview();
  }
  
  function selectAudioTrack(index) {
    selectedAudioIndex = index;
    selectedSlideIndex = -1;
    
    document.querySelectorAll(".slide-block").forEach(function(b) { b.classList.remove("selected"); });
    document.querySelectorAll(".audio-track").forEach(function(t, i) { t.classList.toggle("selected", i === index); });
    
    slideEditor.style.display = "none";
    audioEditor.style.display = "block";
    slidePositionBadge.style.display = "none";
    updateNavButtons();
    
    var track = audioTracks[index];
    audioSrcInput.value = track.src || "";
    audioStartInput.value = track.startSlide + 1;
    audioEndInput.value = track.endSlide + 1;
    audioStartInput.max = slides.length;
    audioEndInput.max = slides.length;
    audioLoopInput.checked = !!track.loop;
    
    // Show audio preview in main preview area
    previewContainer.innerHTML = '<p class="preview-placeholder">🔊 Audio Track</p>';
    audioPreview.src = track.src || "";
    audioPreview.load();
    audioPreviewContainer.style.display = "block";
  }
  
  // Update audio preview when source changes
  audioSrcInput.addEventListener("change", function() {
    audioPreview.src = audioSrcInput.value;
    audioPreview.load();
  });
  
  function updateFormVisibility(type) {
    srcGroup.style.display = type === "placeholder" ? "none" : "flex";
    placeholderGroup.style.display = type === "placeholder" ? "flex" : "none";
    loopGroup.style.display = type === "placeholder" ? "none" : "flex";
    zoompanGroup.style.display = type === "image" ? "flex" : "none";
    
    // Show video-specific controls only for video slides
    if (videoVolumeGroup) {
      videoVolumeGroup.style.display = type === "video" ? "flex" : "none";
    }
    if (autoAdvanceGroup) {
      autoAdvanceGroup.style.display = type === "video" ? "flex" : "none";
    }
    var editVideoGroup = document.getElementById("edit-video-group");
    if (editVideoGroup) {
      editVideoGroup.style.display = type === "video" ? "flex" : "none";
    }
  }
  
  slideTypeSelect.addEventListener("change", function() { updateFormVisibility(this.value); });
  
  // Video volume slider listener
  if (videoVolumeSlider) {
    videoVolumeSlider.addEventListener("input", function() {
      videoVolumeValue.textContent = this.value + "%";
    });
  }
  
  function updatePreview(slide) {
    previewContainer.innerHTML = "";
    if (slide.type === "video") {
      var v = document.createElement("video");
      v.src = slide.src;
      v.controls = true;
      v.muted = true;
      previewContainer.appendChild(v);
    } else if (slide.type === "image") {
      var img = document.createElement("img");
      img.src = slide.src;
      if (slide.zoompan) img.className = "zoompan";
      previewContainer.appendChild(img);
    } else {
      var div = document.createElement("div");
      div.className = "placeholder-preview";
      div.style.backgroundColor = slide.backgroundColor || "#333";
      var bodyText = slide.text ? '<p>' + slide.text + '</p>' : '';
      div.innerHTML = '<h3>' + (slide.title || 'Placeholder') + '</h3>' + bodyText;
      previewContainer.appendChild(div);
    }
  }
  
  // Save slide
  slideForm.addEventListener("submit", function(e) {
    e.preventDefault();
    if (selectedSlideIndex < 0) return;
    
    var slide = slides[selectedSlideIndex];
    slide.type = slideTypeSelect.value;
    
    if (slide.type === "placeholder") {
      slide.title = placeholderTitleInput.value;
      slide.text = placeholderTextInput.value;
      slide.backgroundColor = placeholderColorInput.value;
      delete slide.src; delete slide.loop; delete slide.zoompan; delete slide.volume; delete slide.autoAdvance;
    } else if (slide.type === "image") {
      slide.src = slideSrcInput.value;
      slide.zoompan = slideZoompanInput.checked;
      delete slide.title; delete slide.text; delete slide.backgroundColor; delete slide.loop; delete slide.volume; delete slide.autoAdvance;
    } else {
      // Video slide
      slide.src = slideSrcInput.value;
      slide.loop = slideLoopInput.checked;
      // Save volume setting
      if (videoVolumeSlider) {
        slide.volume = parseInt(videoVolumeSlider.value);
      }
      // Save auto-advance setting
      if (slideAutoAdvanceInput) {
        slide.autoAdvance = slideAutoAdvanceInput.checked;
      }
      delete slide.title; delete slide.text; delete slide.backgroundColor; delete slide.zoompan;
    }
    slide.notes = slideNotesInput.value;
    
    renderTimelines();
    updatePreview(slide);
    selectSlide(selectedSlideIndex);
    saveToLocalStorage();
    
    var btn = slideForm.querySelector(".save-btn");
    btn.innerText = "✓ Saved";
    btn.style.background = "#27ae60";
    setTimeout(function() { btn.innerText = "Save"; btn.style.background = ""; }, 1200);
  });
  
  // Save audio
  audioForm.addEventListener("submit", function(e) {
    e.preventDefault();
    if (selectedAudioIndex < 0) return;
    
    var track = audioTracks[selectedAudioIndex];
    track.src = audioSrcInput.value;
    track.startSlide = Math.max(0, parseInt(audioStartInput.value) - 1);
    track.endSlide = Math.max(track.startSlide, parseInt(audioEndInput.value) - 1);
    track.loop = audioLoopInput.checked;
    
    renderAudioTimeline();
    saveToLocalStorage();
    
    var btn = audioForm.querySelector(".save-btn");
    btn.innerText = "✓ Saved";
    btn.style.background = "#27ae60";
    setTimeout(function() { btn.innerText = "Save"; btn.style.background = ""; }, 1200);
  });

  // Add slides
  function addSlide(type) {
    var slide = { type: type, notes: "" };
    if (type === "video") { slide.src = "media/video/"; slide.loop = false; }
    else if (type === "image") { slide.src = "media/"; }
    else { slide.title = "Coming Soon"; slide.backgroundColor = "#333333"; }
    
    var idx = selectedSlideIndex >= 0 ? selectedSlideIndex + 1 : slides.length;
    slides.splice(idx, 0, slide);
    renderTimelines();
    selectSlide(idx);
    saveToLocalStorage();
    setTimeout(function() { scrollToSlide(idx); }, 50);
  }
  
  addVideoBtn.addEventListener("click", function() { addSlide("video"); });
  addImageBtn.addEventListener("click", function() { addSlide("image"); });
  addPlaceholderBtn.addEventListener("click", function() { addSlide("placeholder"); });
  
  addAudioBtn.addEventListener("click", function() {
    var start = selectedSlideIndex >= 0 ? selectedSlideIndex : 0;
    audioTracks.push({
      src: "media/audio/",
      startSlide: start,
      endSlide: Math.min(start + 5, slides.length - 1),
      loop: false,
      volume: 100,
      pauseSlides: [],
      fadeEnabled: false,
      fadeIn: 0.5,
      fadeOut: 0.5
    });
    renderAudioTimeline();
    selectAudioTrack(audioTracks.length - 1);
    saveToLocalStorage();
  });
  
  // Delete
  deleteSlideBtn.addEventListener("click", function() {
    if (selectedSlideIndex < 0 || !confirm("Delete this slide?")) return;
    slides.splice(selectedSlideIndex, 1);
    if (!slides.length) {
      selectedSlideIndex = -1;
      editorPlaceholder.style.display = "block";
      slideForm.style.display = "none";
      slidePositionBadge.style.display = "none";
      previewContainer.innerHTML = '<p class="preview-placeholder">Select a slide to preview</p>';
    } else {
      selectedSlideIndex = Math.min(selectedSlideIndex, slides.length - 1);
      selectSlide(selectedSlideIndex);
    }
    renderTimelines();
    saveToLocalStorage();
  });
  
  deleteAudioBtn.addEventListener("click", function() {
    if (selectedAudioIndex < 0 || !confirm("Delete this audio track?")) return;
    audioTracks.splice(selectedAudioIndex, 1);
    selectedAudioIndex = -1;
    audioEditor.style.display = "none";
    slideEditor.style.display = "block";
    editorPlaceholder.style.display = "block";
    slideForm.style.display = "none";
    renderAudioTimeline();
    saveToLocalStorage();
  });

  // Import/Export
  exportBtn.addEventListener("click", function() {
    var data = JSON.stringify({ slides: slides, audio: audioTracks }, null, 2);
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "data.json";
    a.click();
  });
  
  importBtn.addEventListener("click", function() { importInput.click(); });
  
  importInput.addEventListener("change", function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        slides = data.slides || data;
        audioTracks = data.audio || [];
        selectedSlideIndex = -1;
        selectedAudioIndex = -1;
        editorPlaceholder.style.display = "block";
        slideForm.style.display = "none";
        audioEditor.style.display = "none";
        slideEditor.style.display = "block";
        slidePositionBadge.style.display = "none";
        previewContainer.innerHTML = '<p class="preview-placeholder">Select a slide</p>';
        renderTimelines();
        saveToLocalStorage();
        alert("Imported!");
      } catch (err) { alert("Error: " + err.message); }
    };
    reader.readAsText(file);
    importInput.value = "";
  });

  // Presentation
  window.addEventListener("message", function(e) {
    if (e.data.type === "togglePause") togglePause();
  });

  function togglePause() {
    if (window.currentMedia && window.currentMedia.tagName === "VIDEO") {
      paused ? window.currentMedia.play() : window.currentMedia.pause();
    }
    paused = !paused;
    for (var k in activeAudioElements) {
      paused ? activeAudioElements[k].pause() : activeAudioElements[k].play().catch(function(){});
    }
    updatePresenterView();
  }

  function startPresentation() {
    if (window.presentationStarted) return;
    window.presentationStarted = true;
    document.body.classList.add("present-mode");
    loadSlide(currentSlideIndex);
    
    // Start subtitle system if enabled
    if (window.subtitleSystem && window.subtitleSystem.isEnabled()) {
      window.subtitleSystem.onPresentationStart();
    }
  }
  window.startPresentation = startPresentation;

  function loadSlide(index) {
    var container = document.getElementById("slide-content");
    if (!container) {
      // Fallback to presentation container if slide-content doesn't exist
      container = document.getElementById("presentation");
    }
    container.innerHTML = "";
    if (index < 0 || index >= slides.length) {
      container.innerHTML = "<h1 style='color:white;'>End of Presentation</h1>";
      return;
    }
    var slide = slides[index];
    
    if (slide.type === "image") {
      var img = document.createElement("img");
      img.src = slide.src;
      if (slide.zoompan) img.className = "zoompan";
      container.appendChild(img);
      window.currentMedia = null;
    } else if (slide.type === "video") {
      var video = document.createElement("video");
      video.src = slide.src;
      video.autoplay = true;
      if (slide.loop) video.loop = true;
      // Apply volume setting from JSON (0-200% mapped to 0-1 for HTML5)
      var volume = slide.volume !== undefined ? slide.volume : 100;
      video.volume = Math.min(1, volume / 100);
      container.appendChild(video);
      window.currentMedia = video;
      video.addEventListener("loadeddata", function() { video.play().catch(function(){}); });
      
      // Auto-advance to next slide when video ends (if enabled and not looping)
      if (slide.autoAdvance && !slide.loop) {
        video.addEventListener("ended", function() {
          // Only advance if we're still on this slide and presentation is running
          if (window.presentationStarted && !paused && currentSlideIndex === index) {
            advanceSlide();
          }
        });
      }
    } else {
      var div = document.createElement("div");
      div.className = "placeholder-slide";
      div.style.backgroundColor = slide.backgroundColor || "#333";
      var bodyText = slide.text ? '<p>' + slide.text + '</p>' : '';
      div.innerHTML = '<h1>' + (slide.title || 'Placeholder') + '</h1>' + bodyText;
      container.appendChild(div);
      window.currentMedia = null;
    }
    updatePresenterView();
    updateAudio();
  }

  function updateAudio() {
    for (var i = 0; i < audioTracks.length; i++) {
      var track = audioTracks[i];
      if (currentSlideIndex >= track.startSlide && currentSlideIndex <= track.endSlide) {
        if (!activeAudioElements[i]) {
          var el = new Audio(track.src);
          el.loop = !!track.loop;
          activeAudioElements[i] = el;
          if (!paused) el.play().catch(function(){});
        }
      } else if (activeAudioElements[i]) {
        activeAudioElements[i].pause();
        activeAudioElements[i].currentTime = 0;
        delete activeAudioElements[i];
      }
    }
  }

  function advanceSlide() {
    if (!window.presentationStarted || !canChangeSlide) return;
    canChangeSlide = false;
    if (currentSlideIndex < slides.length - 1) { currentSlideIndex++; loadSlide(currentSlideIndex); }
    setTimeout(function() { canChangeSlide = true; }, 500);
  }
  window.advanceSlide = advanceSlide;

  function previousSlide() {
    if (!window.presentationStarted || !canChangeSlide) return;
    canChangeSlide = false;
    if (currentSlideIndex > 0) { currentSlideIndex--; loadSlide(currentSlideIndex); }
    setTimeout(function() { canChangeSlide = true; }, 500);
  }
  window.previousSlide = previousSlide;

  function updatePresenterView() {
    if (presenterWindow && !presenterWindow.closed) {
      presenterWindow.postMessage({ type: "update", currentSlideIndex: currentSlideIndex, slides: slides, paused: paused }, "*");
    }
  }

  document.getElementById("startBtn").addEventListener("click", startPresentation);
  
  document.getElementById("presenterBtn").addEventListener("click", function() {
    if (!presenterWindow || presenterWindow.closed) {
      presenterWindow = window.open(window.location.href + "?presenter", "PresenterView", "width=800,height=600");
    } else {
      presenterWindow.focus();
    }
  });

  document.addEventListener("keydown", function(e) {
    if (!window.presentationStarted) return;
    if (e.key === "ArrowRight") advanceSlide();
    else if (e.key === "ArrowLeft") previousSlide();
    else if (e.key === "Escape") switchToEditMode();
  });

  // ============================================
  // AI VIDEO GENERATION FEATURE
  // ============================================
  
  var VEO_API_KEY_STORAGE = "veo_api_key";
  var generateVideoBtn = document.getElementById("generateVideoBtn");
  
  // Modal Elements
  var apiKeyDialog = document.getElementById("api-key-dialog");
  var apiKeyInput = document.getElementById("api-key-input");
  var apiKeySaveBtn = document.getElementById("api-key-save");
  var apiKeyCancelBtn = document.getElementById("api-key-cancel");
  
  var videoGenModal = document.getElementById("video-gen-modal");
  var videoGenCloseBtn = document.getElementById("video-gen-close");
  var vgIdleState = document.getElementById("vg-idle-state");
  var vgLoadingState = document.getElementById("vg-loading-state");
  var vgPreviewState = document.getElementById("vg-preview-state");
  var vgErrorState = document.getElementById("vg-error-state");
  var vgLoadingStatus = document.getElementById("vg-loading-status");
  var vgErrorMessage = document.getElementById("vg-error-message");
  var vgPreviewVideo = document.getElementById("vg-preview-video");
  
  var vgPrompt = document.getElementById("vg-prompt");
  var vgModel = document.getElementById("vg-model");
  var vgAspect = document.getElementById("vg-aspect");
  var vgResolution = document.getElementById("vg-resolution");
  var vgGenerateBtn = document.getElementById("vg-generate-btn");
  var vgRegenerateBtn = document.getElementById("vg-regenerate-btn");
  var vgConfirmBtn = document.getElementById("vg-confirm-btn");
  var vgTryAgainBtn = document.getElementById("vg-try-again-btn");
  
  var addToDeckModal = document.getElementById("add-to-deck-modal");
  var addDeckFilename = document.getElementById("add-deck-filename");
  var addDeckDoneBtn = document.getElementById("add-deck-done-btn");
  
  var convertToVideoBtn = document.getElementById("convertToVideoBtn");
  
  var currentVideoBlob = null;
  var currentVideoUrl = null;
  var pendingGenerateCallback = null;
  var convertingPlaceholderIndex = -1; // Track which placeholder we're converting
  var convertingPlaceholderNotes = ""; // Store the notes from the placeholder
  
  // API Key Management
  function getApiKey() {
    return localStorage.getItem(VEO_API_KEY_STORAGE);
  }
  
  function setApiKey(key) {
    localStorage.setItem(VEO_API_KEY_STORAGE, key);
  }
  
  function hasApiKey() {
    var key = getApiKey();
    return key && key.length > 0;
  }
  
  function showApiKeyDialog(callback) {
    pendingGenerateCallback = callback;
    apiKeyInput.value = getApiKey() || "";
    apiKeyDialog.style.display = "flex";
    apiKeyInput.focus();
  }
  
  function hideApiKeyDialog() {
    apiKeyDialog.style.display = "none";
    pendingGenerateCallback = null;
  }
  
  apiKeySaveBtn.addEventListener("click", function() {
    var key = apiKeyInput.value.trim();
    if (key) {
      setApiKey(key);
      hideApiKeyDialog();
      if (pendingGenerateCallback) {
        pendingGenerateCallback();
      }
    } else {
      alert("Please enter a valid API key.");
    }
  });
  
  apiKeyCancelBtn.addEventListener("click", hideApiKeyDialog);
  
  apiKeyInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      apiKeySaveBtn.click();
    }
  });
  
  // Video Generation Modal
  function showVideoGenModal(initialPrompt) {
    setVideoGenState("idle");
    vgPrompt.value = initialPrompt || "";
    videoGenModal.style.display = "flex";
    vgPrompt.focus();
  }
  
  function hideVideoGenModal() {
    // Stop video playback
    if (vgPreviewVideo) {
      vgPreviewVideo.pause();
      vgPreviewVideo.currentTime = 0;
      vgPreviewVideo.src = "";
    }
    
    videoGenModal.style.display = "none";
    if (currentVideoUrl) {
      URL.revokeObjectURL(currentVideoUrl);
      currentVideoUrl = null;
    }
    currentVideoBlob = null;
    
    // Reset placeholder conversion state
    convertingPlaceholderIndex = -1;
    convertingPlaceholderNotes = "";
  }
  
  function setVideoGenState(state) {
    // Stop video playback when leaving preview state
    if (state !== "preview" && vgPreviewVideo) {
      vgPreviewVideo.pause();
      vgPreviewVideo.currentTime = 0;
    }
    
    vgIdleState.style.display = state === "idle" ? "block" : "none";
    vgLoadingState.style.display = state === "loading" ? "block" : "none";
    vgPreviewState.style.display = state === "preview" ? "block" : "none";
    vgErrorState.style.display = state === "error" ? "block" : "none";
  }
  
  videoGenCloseBtn.addEventListener("click", hideVideoGenModal);
  
  videoGenModal.addEventListener("click", function(e) {
    if (e.target === videoGenModal) {
      hideVideoGenModal();
    }
  });
  
  // Generate Video Button Click
  generateVideoBtn.addEventListener("click", function() {
    // Reset placeholder conversion state for new video
    convertingPlaceholderIndex = -1;
    convertingPlaceholderNotes = "";
    
    if (!hasApiKey()) {
      showApiKeyDialog(function() { showVideoGenModal(); });
    } else {
      showVideoGenModal();
    }
  });
  
  // Convert Placeholder to Video Button Click
  convertToVideoBtn.addEventListener("click", function() {
    if (selectedSlideIndex < 0) return;
    
    var slide = slides[selectedSlideIndex];
    if (slide.type !== "placeholder") return;
    
    // Store the placeholder info for later
    convertingPlaceholderIndex = selectedSlideIndex;
    convertingPlaceholderNotes = slide.notes || "";
    
    // Build a suggested prompt from the placeholder content
    var promptParts = [];
    if (slide.title) promptParts.push(slide.title);
    if (slide.text) promptParts.push(slide.text);
    var suggestedPrompt = promptParts.join(". ");
    
    if (!hasApiKey()) {
      showApiKeyDialog(function() { showVideoGenModal(suggestedPrompt); });
    } else {
      showVideoGenModal(suggestedPrompt);
    }
  });
  
  // Video Generation Service
  async function generateAIVideo(params) {
    var apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("No API key configured");
    }
    
    // Build request body for predictLongRunning (the correct endpoint for video generation)
    // Based on the Veo API structure used by the Google GenAI SDK
    var requestBody = {
      instances: [{
        prompt: params.prompt
      }],
      parameters: {
        sampleCount: 1,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution
      }
    };
    
    console.log("Starting video generation with params:", requestBody);
    
    // Use predictLongRunning endpoint which is the correct one for video generation
    var generateUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + params.model + ":predictLongRunning?key=" + apiKey;
    console.log("Calling endpoint:", generateUrl);
    
    var generateResponse = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!generateResponse.ok) {
      var errorData = await generateResponse.json().catch(function() { return {}; });
      var errorMsg = errorData.error?.message || generateResponse.statusText;
      console.error("Generation request failed:", generateResponse.status, errorMsg, errorData);
      
      if (errorMsg.includes("Requested entity was not found") || 
          errorMsg.includes("API_KEY_INVALID") ||
          errorMsg.includes("API key not valid") ||
          generateResponse.status === 403 ||
          generateResponse.status === 404) {
        throw new Error("API key is invalid, lacks permissions, or the Veo model is not available. Please check your API key and ensure billing is enabled. Error: " + errorMsg);
      }
      throw new Error(errorMsg);
    }
    
    var operation = await generateResponse.json();
    console.log("Video generation operation started:", operation);
    
    // Poll for completion
    var operationName = operation.name;
    var maxAttempts = 120; // 20 minutes max
    var attempts = 0;
    
    while (attempts < maxAttempts) {
      await new Promise(function(resolve) { setTimeout(resolve, 10000); }); // Wait 10 seconds
      attempts++;
      
      vgLoadingStatus.textContent = "Generating...";
      
      var statusResponse = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/" + operationName + "?key=" + apiKey
      );
      
      if (!statusResponse.ok) {
        throw new Error("Failed to check generation status: " + statusResponse.statusText);
      }
      
      var statusData = await statusResponse.json();
      console.log("Generation status:", statusData);
      
      if (statusData.done) {
        if (statusData.error) {
          throw new Error(statusData.error.message || "Generation failed");
        }
        
        // Handle different response formats
        var videoUri = null;
        var response = statusData.response;
        
        // Format 1: predictLongRunning response with generateVideoResponse
        if (response?.generateVideoResponse?.generatedSamples) {
          var samples = response.generateVideoResponse.generatedSamples;
          if (samples.length > 0 && samples[0].video?.uri) {
            videoUri = samples[0].video.uri;
            console.log("Found video URI in generateVideoResponse.generatedSamples");
          }
        }
        
        // Format 2: SDK-style with generatedVideos
        if (!videoUri && response?.generatedVideos) {
          var videos = response.generatedVideos;
          if (videos.length > 0 && videos[0].video?.uri) {
            videoUri = videos[0].video.uri;
            console.log("Found video URI in generatedVideos");
          }
        }
        
        // Format 3: Predict-style with predictions
        if (!videoUri && response?.predictions) {
          var predictions = response.predictions;
          if (predictions.length > 0) {
            var firstPrediction = predictions[0];
            videoUri = firstPrediction.videoUri || 
                       firstPrediction.video?.uri || 
                       firstPrediction.uri;
            if (videoUri) {
              console.log("Found video URI in predictions");
            }
            
            // Some models return base64 encoded video
            if (!videoUri && firstPrediction.bytesBase64Encoded) {
              console.log("Found base64 encoded video");
              var byteString = atob(firstPrediction.bytesBase64Encoded);
              var ab = new ArrayBuffer(byteString.length);
              var ia = new Uint8Array(ab);
              for (var i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
              }
              var videoBlob = new Blob([ab], { type: 'video/mp4' });
              var objectUrl = URL.createObjectURL(videoBlob);
              return { blob: videoBlob, objectUrl: objectUrl };
            }
          }
        }
        
        if (!videoUri) {
          console.error("Could not find video URI in response:", statusData);
          throw new Error("Generated video is missing a URI. Response format may have changed.");
        }
        
        // Fetch the video
        videoUri = decodeURIComponent(videoUri);
        console.log("Fetching video from:", videoUri);
        
        // Add API key if URL is from Google
        var fetchUrl = videoUri;
        if (videoUri.includes("googleapis.com") && !videoUri.includes("key=")) {
          fetchUrl = videoUri + (videoUri.includes("?") ? "&" : "?") + "key=" + apiKey;
        }
        
        var videoResponse = await fetch(fetchUrl);
        if (!videoResponse.ok) {
          throw new Error("Failed to download video: " + videoResponse.statusText);
        }
        
        var videoBlob = await videoResponse.blob();
        var objectUrl = URL.createObjectURL(videoBlob);
        
        return {
          blob: videoBlob,
          objectUrl: objectUrl
        };
      }
    }
    
    throw new Error("Video generation timed out. Please try again.");
  }
  
  // Generate Button Handler
  vgGenerateBtn.addEventListener("click", function() {
    var prompt = vgPrompt.value.trim();
    if (!prompt) {
      alert("Please enter a prompt describing the video you want to generate.");
      vgPrompt.focus();
      return;
    }
    
    if (!hasApiKey()) {
      showApiKeyDialog(function() {
        vgGenerateBtn.click();
      });
      return;
    }
    
    startVideoGeneration({
      prompt: prompt,
      model: vgModel.value,
      aspectRatio: vgAspect.value,
      resolution: vgResolution.value
    });
  });
  
  async function startVideoGeneration(params) {
    setVideoGenState("loading");
    vgLoadingStatus.textContent = "Submitting generation request...";
    
    try {
      var result = await generateAIVideo(params);
      currentVideoBlob = result.blob;
      currentVideoUrl = result.objectUrl;
      
      vgPreviewVideo.src = currentVideoUrl;
      setVideoGenState("preview");
    } catch (error) {
      console.error("Video generation failed:", error);
      
      var errorMessage = error.message || "An unknown error occurred.";
      if (errorMessage.includes("API key") || errorMessage.includes("permission")) {
        // Clear the API key and prompt for a new one
        showApiKeyDialog(function() {
          startVideoGeneration(params);
        });
        return;
      }
      
      vgErrorMessage.textContent = errorMessage;
      setVideoGenState("error");
    }
  }
  
  // Regenerate Button
  vgRegenerateBtn.addEventListener("click", function() {
    var prompt = vgPrompt.value.trim();
    if (prompt) {
      startVideoGeneration({
        prompt: prompt,
        model: vgModel.value,
        aspectRatio: vgAspect.value,
        resolution: vgResolution.value
      });
    }
  });
  
  // Try Again Button
  vgTryAgainBtn.addEventListener("click", function() {
    setVideoGenState("idle");
  });
  
  // Confirm and Add to Deck
  vgConfirmBtn.addEventListener("click", function() {
    if (!currentVideoBlob) {
      alert("No video available to add.");
      return;
    }
    
    // Generate filename
    var timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    var filename = "ai-video-" + timestamp + ".mp4";
    
    // Download the video
    var downloadLink = document.createElement("a");
    downloadLink.href = currentVideoUrl;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    // Show the add to deck instructions
    addDeckFilename.value = "media/video/" + filename;
    
    // Check if we're converting a placeholder or adding a new slide
    var isConvertingPlaceholder = convertingPlaceholderIndex >= 0;
    var notesToUse = isConvertingPlaceholder ? convertingPlaceholderNotes : ("AI Generated video. Prompt: " + vgPrompt.value.trim());
    
    // Create the video slide
    var newSlide = {
      type: "video",
      src: "media/video/" + filename,
      notes: notesToUse,
      loop: false
    };
    
    var targetIdx;
    if (isConvertingPlaceholder) {
      // Replace the placeholder slide
      targetIdx = convertingPlaceholderIndex;
      slides[targetIdx] = newSlide;
    } else {
      // Add a new slide after the current selection
      targetIdx = selectedSlideIndex >= 0 ? selectedSlideIndex + 1 : slides.length;
      slides.splice(targetIdx, 0, newSlide);
    }
    
    // Close modal and show instructions
    hideVideoGenModal();
    addToDeckModal.style.display = "flex";
    
    renderTimelines();
    selectSlide(targetIdx);
    setTimeout(function() { scrollToSlide(targetIdx); }, 50);
  });
  
  // Done Button on Add to Deck Modal
  addDeckDoneBtn.addEventListener("click", function() {
    addToDeckModal.style.display = "none";
  });
  
  addToDeckModal.addEventListener("click", function(e) {
    if (e.target === addToDeckModal) {
      addToDeckModal.style.display = "none";
    }
  });
  
  // Close modals with Escape key
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      if (apiKeyDialog.style.display === "flex") {
        hideApiKeyDialog();
      } else if (videoGenModal.style.display === "flex") {
        hideVideoGenModal();
      } else if (addToDeckModal.style.display === "flex") {
        addToDeckModal.style.display = "none";
      } else if (videoEditModal && videoEditModal.style.display === "flex") {
        hideVideoEditModal();
      }
    }
  });

  // ============================================
  // VIDEO EDITING FEATURE (FFmpeg.wasm)
  // ============================================
  
  var videoEditModal = document.getElementById("video-edit-modal");
  var videoEditCloseBtn = document.getElementById("video-edit-close");
  var veLoadingFFmpeg = document.getElementById("ve-loading-ffmpeg");
  var veEditorState = document.getElementById("ve-editor-state");
  var veProcessingState = document.getElementById("ve-processing-state");
  var veCompleteState = document.getElementById("ve-complete-state");
  var veErrorState = document.getElementById("ve-error-state");
  var veFFmpegStatus = document.getElementById("ve-ffmpeg-status");
  var veProcessingStatus = document.getElementById("ve-processing-status");
  var veProgressFill = document.getElementById("ve-progress-fill");
  var veProgressText = document.getElementById("ve-progress-text");
  var veErrorMessage = document.getElementById("ve-error-message");
  var veOriginalPath = document.getElementById("ve-original-path");
  
  var vePreviewVideo = document.getElementById("ve-preview-video");
  var veTextEnabled = document.getElementById("ve-text-enabled");
  var veTextOptions = document.getElementById("ve-text-options");
  var veTextInput = document.getElementById("ve-text-input");
  var veFontFamily = document.getElementById("ve-font-family");
  var veFontSize = document.getElementById("ve-font-size");
  var veFontColor = document.getElementById("ve-font-color");
  var veTextBorder = document.getElementById("ve-text-border");
  var veBorderSize = document.getElementById("ve-border-size");
  var veTextX = document.getElementById("ve-text-x");
  var veTextY = document.getElementById("ve-text-y");
  var veTextXValue = document.getElementById("ve-text-x-value");
  var veTextYValue = document.getElementById("ve-text-y-value");
  var veTextOverlay = document.getElementById("ve-text-overlay");
  var veTextOverlayContent = document.getElementById("ve-text-overlay-content");
  var veDragHint = document.getElementById("ve-drag-hint");
  var veApplyBtn = document.getElementById("ve-apply-btn");
  var veCancelBtn = document.getElementById("ve-cancel-btn");
  var veDoneBtn = document.getElementById("ve-done-btn");
  var veErrorRetryBtn = document.getElementById("ve-error-retry-btn");
  var editVideoBtn = document.getElementById("editVideoBtn");
  var editVideoGroup = document.getElementById("edit-video-group");
  
  var ffmpeg = null;
  var ffmpegLoaded = false;
  var fontLoaded = false;
  var webFontsLoaded = false;
  var currentEditVideoSrc = null;
  var currentEditVideoBlob = null;
  var textPositionX = 50; // percentage
  var textPositionY = 50; // percentage
  var videoWidth = 1920; // actual video width
  var videoHeight = 1080; // actual video height
  
  // Map font filenames to CSS font-family names
  var fontFamilyMap = {
    "Roboto-Bold.ttf": "Roboto-Bold",
    "Roboto-Regular.ttf": "Roboto-Regular",
    "OpenSans-Bold.ttf": "OpenSans-Bold",
    "Lato-Bold.ttf": "Lato-Bold",
    "Montserrat-Bold.ttf": "Montserrat-Bold",
    "Montserrat-Regular.ttf": "Montserrat-Regular",
    "SourceSansPro-Bold.ttf": "SourceSansPro-Bold",
    "Oswald-Bold.ttf": "Oswald-Bold",
    "Pacifico-Regular.ttf": "Pacifico-Regular"
  };
  
  // Load fonts for web preview
  function loadWebFonts() {
    if (webFontsLoaded) return;
    
    var style = document.createElement("style");
    var css = "";
    
    for (var filename in fontFamilyMap) {
      var familyName = fontFamilyMap[filename];
      css += "@font-face { font-family: '" + familyName + "'; src: url('lib/fonts/" + filename + "'); }\n";
    }
    
    style.textContent = css;
    document.head.appendChild(style);
    webFontsLoaded = true;
    console.log("Web fonts loaded for preview");
  }
  
  // Load web fonts immediately
  loadWebFonts();
  
  // FFmpeg loading - uses local files
  async function loadFFmpeg() {
    if (ffmpegLoaded && ffmpeg) return ffmpeg;
    
    try {
      veFFmpegStatus.textContent = "Loading FFmpeg library...";
      
      // FFmpeg.wasm UMD build exposes FFmpegWASM global with FFmpeg class
      if (typeof FFmpegWASM === 'undefined' || !FFmpegWASM.FFmpeg) {
        throw new Error("FFmpeg library not loaded. Please refresh the page and try again.");
      }
      
      console.log("Creating FFmpeg instance...");
      ffmpeg = new FFmpegWASM.FFmpeg();
      
      ffmpeg.on("log", function(info) {
        console.log("FFmpeg log:", info.message);
      });
      
      ffmpeg.on("progress", function(info) {
        var progress = Math.round(info.progress * 100);
        veProgressFill.style.width = progress + "%";
        veProgressText.textContent = progress + "%";
      });
      
      veFFmpegStatus.textContent = "Loading FFmpeg WebAssembly (~30MB)...";
      
      // Use absolute URLs for local files
      var baseURL = new URL("lib/ffmpeg/", window.location.href).href;
      
      await ffmpeg.load({
        coreURL: baseURL + "ffmpeg-core.js",
        wasmURL: baseURL + "ffmpeg-core.wasm"
      });
      
      ffmpegLoaded = true;
      console.log("FFmpeg loaded successfully");
      
      // Load font files into FFmpeg's virtual filesystem
      if (!fontLoaded) {
        veFFmpegStatus.textContent = "Loading fonts...";
        try {
          // Create the fonts directory first
          try {
            await ffmpeg.createDir("/fonts");
            console.log("Created /fonts directory");
          } catch (dirError) {
            console.log("Fonts directory may already exist:", dirError.message);
          }
          
          // Load all available fonts
          var fonts = [
            { name: "Roboto-Bold.ttf", path: "lib/fonts/Roboto-Bold.ttf" },
            { name: "Roboto-Regular.ttf", path: "lib/fonts/Roboto-Regular.ttf" },
            { name: "OpenSans-Bold.ttf", path: "lib/fonts/OpenSans-Bold.ttf" },
            { name: "Lato-Bold.ttf", path: "lib/fonts/Lato-Bold.ttf" },
            { name: "Montserrat-Bold.ttf", path: "lib/fonts/Montserrat-Bold.ttf" },
            { name: "Montserrat-Regular.ttf", path: "lib/fonts/Montserrat-Regular.ttf" },
            { name: "SourceSansPro-Bold.ttf", path: "lib/fonts/SourceSansPro-Bold.ttf" },
            { name: "Oswald-Bold.ttf", path: "lib/fonts/Oswald-Bold.ttf" },
            { name: "Pacifico-Regular.ttf", path: "lib/fonts/Pacifico-Regular.ttf" }
          ];
          
          var fontsLoadedCount = 0;
          for (var i = 0; i < fonts.length; i++) {
            var font = fonts[i];
            try {
              console.log("Fetching font: " + font.path);
              var fontResponse = await fetch(font.path, { cache: "no-store" });
              console.log("Font response status:", fontResponse.status, fontResponse.statusText);
              
              if (!fontResponse.ok) {
                console.warn("Failed to fetch font " + font.name + ": " + fontResponse.statusText);
                continue;
              }
              
              // Clone the response to read it properly
              var fontBlob = await fontResponse.blob();
              console.log("Font blob size:", fontBlob.size, "type:", fontBlob.type);
              
              if (fontBlob.size === 0) {
                console.warn("Font " + font.name + " returned empty blob");
                continue;
              }
              
              var fontData = await fontBlob.arrayBuffer();
              console.log("Font arrayBuffer size:", fontData.byteLength);
              
              if (fontData.byteLength === 0) {
                console.warn("Font " + font.name + " has 0 bytes after conversion");
                continue;
              }
              
              var fontUint8 = new Uint8Array(fontData);
              console.log("Writing font to FFmpeg FS: /fonts/" + font.name, "size:", fontUint8.length);
              
              await ffmpeg.writeFile("/fonts/" + font.name, fontUint8);
              
              // Verify the file was written
              try {
                var written = await ffmpeg.readFile("/fonts/" + font.name);
                console.log("Verified font in FFmpeg FS: " + font.name + " (" + written.length + " bytes)");
                fontsLoadedCount++;
              } catch (verifyError) {
                console.warn("Could not verify font " + font.name + ":", verifyError);
              }
            } catch (fontError) {
              console.warn("Failed to load font " + font.name + ":", fontError);
            }
          }
          
          fontLoaded = fontsLoadedCount > 0;
          console.log("Fonts loaded: " + fontsLoadedCount + " of " + fonts.length);
          
          if (!fontLoaded) {
            console.error("No fonts were loaded! Text overlay will not work.");
          }
        } catch (fontError) {
          console.error("Failed to load fonts:", fontError);
        }
      }
      
      return ffmpeg;
    } catch (error) {
      console.error("Failed to load FFmpeg:", error);
      throw error;
    }
  }
  
  // Show/hide video edit modal
  function showVideoEditModal(videoSrc) {
    currentEditVideoSrc = videoSrc;
    videoEditModal.style.display = "flex";
    setVideoEditState("loading");
    
    // Reset controls
    veTextEnabled.checked = false;
    veTextOptions.style.display = "none";
    veTextOverlay.style.display = "none";
    veDragHint.style.display = "none";
    veTextInput.value = "";
    veFontFamily.value = "Roboto-Bold.ttf";
    veFontSize.value = "48";
    veFontColor.value = "#ffffff";
    veTextBorder.checked = true;
    veBorderSize.value = "3";
    textPositionX = 50;
    textPositionY = 50;
    veTextX.value = 50;
    veTextY.value = 50;
    veTextXValue.textContent = "50%";
    veTextYValue.textContent = "50%";
    
    // Load video preview and get dimensions
    vePreviewVideo.src = videoSrc;
    vePreviewVideo.onloadedmetadata = function() {
      videoWidth = vePreviewVideo.videoWidth || 1920;
      videoHeight = vePreviewVideo.videoHeight || 1080;
      console.log("Video dimensions:", videoWidth, "x", videoHeight);
      updateTextOverlayPreview();
    };
    
    // Load FFmpeg
    loadFFmpeg().then(function() {
      setVideoEditState("editor");
    }).catch(function(error) {
      veErrorMessage.textContent = "Failed to load FFmpeg: " + error.message;
      setVideoEditState("error");
    });
  }
  
  function hideVideoEditModal() {
    videoEditModal.style.display = "none";
    vePreviewVideo.pause();
    vePreviewVideo.src = "";
    currentEditVideoSrc = null;
    currentEditVideoBlob = null;
  }
  
  function setVideoEditState(state) {
    veLoadingFFmpeg.style.display = state === "loading" ? "block" : "none";
    veEditorState.style.display = state === "editor" ? "block" : "none";
    veProcessingState.style.display = state === "processing" ? "block" : "none";
    veCompleteState.style.display = state === "complete" ? "block" : "none";
    veErrorState.style.display = state === "error" ? "block" : "none";
  }
  
  // Update text overlay preview
  function updateTextOverlayPreview() {
    var text = veTextInput.value || "Sample Text";
    var fontFile = veFontFamily.value;
    var fontSize = parseInt(veFontSize.value) || 48;
    var color = veFontColor.value;
    var hasBorder = veTextBorder.checked;
    var borderWidth = parseInt(veBorderSize.value) || 3;
    
    // Calculate scale factor based on actual video vs preview size
    var previewRect = vePreviewVideo.getBoundingClientRect();
    var previewWidth = previewRect.width || 400;
    var scaleFactor = previewWidth / videoWidth;
    
    // Scale font size for preview
    var previewFontSize = Math.max(10, Math.round(fontSize * scaleFactor));
    
    // Get CSS font family name from the map
    var cssFontFamily = fontFamilyMap[fontFile] || "sans-serif";
    
    veTextOverlayContent.textContent = text;
    veTextOverlayContent.style.fontFamily = "'" + cssFontFamily + "', sans-serif";
    veTextOverlayContent.style.fontSize = previewFontSize + "px";
    veTextOverlayContent.style.color = color;
    
    // Apply or remove text shadow (border effect) - scale border with preview
    if (hasBorder && borderWidth > 0) {
      var scaledBorder = Math.max(1, Math.round(borderWidth * scaleFactor));
      veTextOverlayContent.style.textShadow = 
        scaledBorder + "px " + scaledBorder + "px 0 black, " +
        (-scaledBorder) + "px " + (-scaledBorder) + "px 0 black, " +
        scaledBorder + "px " + (-scaledBorder) + "px 0 black, " +
        (-scaledBorder) + "px " + scaledBorder + "px 0 black, " +
        "0 " + scaledBorder + "px 0 black, " +
        "0 " + (-scaledBorder) + "px 0 black, " +
        scaledBorder + "px 0 0 black, " +
        (-scaledBorder) + "px 0 0 black";
    } else {
      veTextOverlayContent.style.textShadow = "none";
    }
    
    // Position the overlay
    veTextOverlay.style.left = textPositionX + "%";
    veTextOverlay.style.top = textPositionY + "%";
  }
  
  // Text overlay toggle
  veTextEnabled.addEventListener("change", function() {
    veTextOptions.style.display = this.checked ? "block" : "none";
    veTextOverlay.style.display = this.checked ? "block" : "none";
    veDragHint.style.display = this.checked ? "block" : "none";
    if (this.checked) {
      updateTextOverlayPreview();
    }
  });
  
  // Text input changes - all trigger preview update
  veTextInput.addEventListener("input", updateTextOverlayPreview);
  veFontFamily.addEventListener("change", updateTextOverlayPreview);
  veFontSize.addEventListener("input", updateTextOverlayPreview);
  veFontColor.addEventListener("input", updateTextOverlayPreview);
  veTextBorder.addEventListener("change", updateTextOverlayPreview);
  veBorderSize.addEventListener("input", updateTextOverlayPreview);
  
  // Position sliders
  veTextX.addEventListener("input", function() {
    textPositionX = parseInt(this.value);
    veTextXValue.textContent = textPositionX + "%";
    updateTextOverlayPreview();
  });
  
  veTextY.addEventListener("input", function() {
    textPositionY = parseInt(this.value);
    veTextYValue.textContent = textPositionY + "%";
    updateTextOverlayPreview();
  });
  
  // Draggable text overlay
  var isDragging = false;
  var dragStartX, dragStartY;
  
  veTextOverlay.addEventListener("mousedown", function(e) {
    isDragging = true;
    veTextOverlay.classList.add("dragging");
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    e.preventDefault();
  });
  
  document.addEventListener("mousemove", function(e) {
    if (!isDragging) return;
    
    var container = veTextOverlay.parentElement;
    var rect = container.getBoundingClientRect();
    
    // Calculate new position as percentage
    var newX = ((e.clientX - rect.left) / rect.width) * 100;
    var newY = ((e.clientY - rect.top) / rect.height) * 100;
    
    // Clamp to bounds
    textPositionX = Math.max(5, Math.min(95, newX));
    textPositionY = Math.max(5, Math.min(95, newY));
    
    // Update sliders and preview
    veTextX.value = Math.round(textPositionX);
    veTextY.value = Math.round(textPositionY);
    veTextXValue.textContent = Math.round(textPositionX) + "%";
    veTextYValue.textContent = Math.round(textPositionY) + "%";
    updateTextOverlayPreview();
  });
  
  document.addEventListener("mouseup", function() {
    if (isDragging) {
      isDragging = false;
      veTextOverlay.classList.remove("dragging");
    }
  });
  
  // Close button
  videoEditCloseBtn.addEventListener("click", hideVideoEditModal);
  veCancelBtn.addEventListener("click", hideVideoEditModal);
  veDoneBtn.addEventListener("click", hideVideoEditModal);
  veErrorRetryBtn.addEventListener("click", function() {
    setVideoEditState("editor");
  });
  
  // Click outside to close
  videoEditModal.addEventListener("click", function(e) {
    if (e.target === videoEditModal) {
      hideVideoEditModal();
    }
  });
  
  // Convert hex color to FFmpeg format
  function hexToFFmpegColor(hex) {
    // FFmpeg uses format like 0xRRGGBB or white, black, etc
    return hex.replace("#", "0x");
  }
  
  // Apply edits and download
  veApplyBtn.addEventListener("click", async function() {
    if (!ffmpeg || !currentEditVideoSrc) return;
    
    // Validate text overlay settings
    if (veTextEnabled.checked) {
      if (!veTextInput.value.trim()) {
        alert("Please enter text for the overlay, or disable text overlay.");
        veTextInput.focus();
        return;
      }
      if (!fontLoaded) {
        alert("Font file not loaded. Text overlay may not work correctly.");
      }
    } else {
      alert("Please enable text overlay and enter text to process the video. Volume can be adjusted in the slide editor without re-encoding.");
      return;
    }
    
    setVideoEditState("processing");
    veProgressFill.style.width = "0%";
    veProgressText.textContent = "0%";
    veProcessingStatus.textContent = "Fetching video file...";
    
    var inputFile = null;
    var outputFile = "output.mp4";
    
    try {
      // Fetch the video file
      var response = await fetch(currentEditVideoSrc);
      if (!response.ok) {
        throw new Error("Failed to fetch video file: " + response.statusText);
      }
      var videoData = await response.arrayBuffer();
      
      // Determine input file extension
      var inputExt = currentEditVideoSrc.split('.').pop().toLowerCase();
      if (inputExt === "m4v") inputExt = "mp4"; // Treat m4v as mp4
      inputFile = "input." + inputExt;
      
      veProcessingStatus.textContent = "Writing video to FFmpeg...";
      
      // Write input file to FFmpeg
      await ffmpeg.writeFile(inputFile, new Uint8Array(videoData));
      
      veProcessingStatus.textContent = "Processing video...";
      
      // Build FFmpeg command for text overlay only
      // Volume is handled via JSON settings in the slide editor
      var videoFilters = [];
      
      // Text overlay - escape special characters for FFmpeg
      var text = veTextInput.value.trim()
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "'\\''")
        .replace(/:/g, "\\:")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
      
      var fontFile = veFontFamily.value;
      var fontSize = parseInt(veFontSize.value) || 48;
      var fontColor = hexToFFmpegColor(veFontColor.value);
      var hasBorder = veTextBorder.checked;
      var borderWidth = parseInt(veBorderSize.value) || 3;
      
      // Calculate position based on percentage
      var xExpr = "(" + (textPositionX / 100) + "*w-text_w/2)";
      var yExpr = "(" + (textPositionY / 100) + "*h-text_h/2)";
      
      // Build drawtext filter with font file
      var drawtext = "drawtext=fontfile=/fonts/" + fontFile;
      drawtext += ":text='" + text + "'";
      drawtext += ":fontsize=" + fontSize;
      drawtext += ":fontcolor=" + fontColor;
      drawtext += ":x=" + xExpr;
      drawtext += ":y=" + yExpr;
      
      // Add border if enabled
      if (hasBorder && borderWidth > 0) {
        drawtext += ":borderw=" + borderWidth + ":bordercolor=black";
      }
      
      videoFilters.push(drawtext);
      
      // Build command arguments
      var args = ["-i", inputFile];
      
      // Add video filter for text overlay
      args.push("-vf", videoFilters.join(","));
      
      // Output settings - copy audio stream without modification
      args.push("-c:v", "libx264");
      args.push("-preset", "fast");
      args.push("-crf", "23");
      args.push("-c:a", "copy"); // Copy audio as-is, volume is handled by playback settings
      args.push("-movflags", "+faststart");
      args.push("-y"); // Overwrite output
      args.push(outputFile);
      
      console.log("FFmpeg command:", args.join(" "));
      
      // Run FFmpeg and capture return code
      var returnCode = await ffmpeg.exec(args);
      console.log("FFmpeg return code:", returnCode);
      
      if (returnCode !== 0) {
        throw new Error("FFmpeg processing failed with code " + returnCode + ". Check console for details.");
      }
      
      veProcessingStatus.textContent = "Reading output file...";
      
      // Check if output file exists and has content
      var outputData;
      try {
        outputData = await ffmpeg.readFile(outputFile);
      } catch (readError) {
        throw new Error("Output file was not created. FFmpeg processing failed.");
      }
      
      if (!outputData || outputData.length === 0) {
        throw new Error("Output file is empty. FFmpeg processing failed.");
      }
      
      console.log("Output file size:", outputData.length, "bytes");
      
      currentEditVideoBlob = new Blob([outputData.buffer], { type: "video/mp4" });
      
      // Create download
      var timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      var originalFilename = currentEditVideoSrc.split('/').pop().replace(/\.[^/.]+$/, "");
      var downloadFilename = originalFilename + "-edited-" + timestamp + ".mp4";
      
      var downloadUrl = URL.createObjectURL(currentEditVideoBlob);
      var downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl;
      downloadLink.download = downloadFilename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(downloadUrl);
      
      // Clean up FFmpeg files
      try {
        await ffmpeg.deleteFile(inputFile);
        await ffmpeg.deleteFile(outputFile);
      } catch (cleanupError) {
        console.warn("Cleanup error:", cleanupError);
      }
      
      // Show complete state
      veOriginalPath.value = currentEditVideoSrc;
      setVideoEditState("complete");
      
    } catch (error) {
      console.error("Video processing error:", error);
      veErrorMessage.textContent = error.message || "An error occurred while processing the video.";
      setVideoEditState("error");
      
      // Clean up on error
      try {
        if (inputFile) await ffmpeg.deleteFile(inputFile);
        await ffmpeg.deleteFile(outputFile);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  });
  
  // Edit Video button click
  editVideoBtn.addEventListener("click", function() {
    if (selectedSlideIndex < 0) return;
    var slide = slides[selectedSlideIndex];
    if (slide.type !== "video" || !slide.src) return;
    showVideoEditModal(slide.src);
  });

  // ============================================
  // AUDIO VOLUME CONTROL & FADE SETTINGS
  // ============================================
  
  var audioVolumeSlider = document.getElementById("audio-volume");
  var audioVolumeValue = document.getElementById("audio-volume-value");
  var audioPauseSlidesInput = document.getElementById("audio-pause-slides");
  var audioFadeEnabledInput = document.getElementById("audio-fade-enabled");
  var audioFadeOptions = document.getElementById("audio-fade-options");
  var audioFadeInInput = document.getElementById("audio-fade-in");
  var audioFadeOutInput = document.getElementById("audio-fade-out");
  
  // Track which audio elements are paused due to pause slides
  var pausedForSlide = {};
  
  // Toggle fade options visibility
  audioFadeEnabledInput.addEventListener("change", function() {
    audioFadeOptions.style.display = this.checked ? "block" : "none";
  });
  
  // Track active fade animations and elements being faded out
  var activeFadeIntervals = {};
  var fadingOutElements = {};
  
  // Update volume display and preview playback volume
  audioVolumeSlider.addEventListener("input", function() {
    var volumePercent = parseInt(this.value);
    audioVolumeValue.textContent = volumePercent + "%";
    
    // Update the audio preview player volume in real-time
    // Volume is 0-1 for HTML audio, but our slider is 0-200%
    // Cap at 1.0 (100%) since HTML audio can't go above that
    if (audioPreview) {
      audioPreview.volume = Math.min(1, volumePercent / 100);
    }
  });
  
  // Override selectAudioTrack to include volume, pause slides, and fade settings
  var originalSelectAudioTrack = selectAudioTrack;
  selectAudioTrack = function(index) {
    originalSelectAudioTrack(index);
    
    // Load volume setting
    var track = audioTracks[index];
    var volume = track.volume !== undefined ? track.volume : 100;
    audioVolumeSlider.value = volume;
    audioVolumeValue.textContent = volume + "%";
    
    // Load pause slides (convert array to comma-separated string, using 1-based slide numbers)
    var pauseSlides = track.pauseSlides || [];
    audioPauseSlidesInput.value = pauseSlides.map(function(s) { return s + 1; }).join(", ");
    
    // Load fade settings (default to disabled with 0.5 second durations)
    var fadeEnabled = !!track.fadeEnabled;
    var fadeIn = track.fadeIn !== undefined ? track.fadeIn : 0.5;
    var fadeOut = track.fadeOut !== undefined ? track.fadeOut : 0.5;
    audioFadeEnabledInput.checked = fadeEnabled;
    audioFadeOptions.style.display = fadeEnabled ? "block" : "none";
    audioFadeInInput.value = fadeIn;
    audioFadeOutInput.value = fadeOut;
    
    // Set the audio preview player volume to match
    if (audioPreview) {
      audioPreview.volume = Math.min(1, volume / 100);
    }
  };
  
  // Parse pause slides input (comma-separated 1-based slide numbers) to array of 0-based indices
  function parsePauseSlides(inputValue) {
    if (!inputValue || !inputValue.trim()) return [];
    return inputValue.split(",")
      .map(function(s) { return parseInt(s.trim()) - 1; }) // Convert to 0-based
      .filter(function(n) { return !isNaN(n) && n >= 0; }); // Filter out invalid values
  }
  
  // Override audio form submit to include volume, pause slides, and fade settings
  var originalAudioFormSubmit = audioForm.onsubmit;
  audioForm.addEventListener("submit", function(e) {
    // Save volume, pause slides, and fade settings to track before the original handler
    if (selectedAudioIndex >= 0) {
      audioTracks[selectedAudioIndex].volume = parseInt(audioVolumeSlider.value);
      audioTracks[selectedAudioIndex].pauseSlides = parsePauseSlides(audioPauseSlidesInput.value);
      audioTracks[selectedAudioIndex].fadeEnabled = audioFadeEnabledInput.checked;
      audioTracks[selectedAudioIndex].fadeIn = parseFloat(audioFadeInInput.value) || 0.5;
      audioTracks[selectedAudioIndex].fadeOut = parseFloat(audioFadeOutInput.value) || 0.5;
    }
  });
  
  // Fade audio volume over a duration
  function fadeAudioVolume(audioElement, trackIndex, startVolume, endVolume, duration, onComplete) {
    // Clear any existing fade for this track
    if (activeFadeIntervals[trackIndex]) {
      clearInterval(activeFadeIntervals[trackIndex]);
      delete activeFadeIntervals[trackIndex];
    }
    
    // If duration is 0 or very small, just set the volume directly
    if (duration <= 0.01) {
      audioElement.volume = Math.min(1, endVolume);
      if (onComplete) onComplete();
      return;
    }
    
    var steps = Math.max(1, Math.round(duration * 50)); // 50 steps per second
    var stepDuration = (duration * 1000) / steps;
    var volumeStep = (endVolume - startVolume) / steps;
    var currentStep = 0;
    
    audioElement.volume = Math.min(1, Math.max(0, startVolume));
    
    activeFadeIntervals[trackIndex] = setInterval(function() {
      currentStep++;
      var newVolume = startVolume + (volumeStep * currentStep);
      audioElement.volume = Math.min(1, Math.max(0, newVolume));
      
      if (currentStep >= steps) {
        clearInterval(activeFadeIntervals[trackIndex]);
        delete activeFadeIntervals[trackIndex];
        audioElement.volume = Math.min(1, Math.max(0, endVolume));
        if (onComplete) onComplete();
      }
    }, stepDuration);
  }
  
  // Override updateAudio to apply volume, pause slides, and fade effects during playback
  var originalUpdateAudio = updateAudio;
  updateAudio = function() {
    for (var i = 0; i < audioTracks.length; i++) {
      var track = audioTracks[i];
      var isInRange = currentSlideIndex >= track.startSlide && currentSlideIndex <= track.endSlide;
      var fadeEnabled = !!track.fadeEnabled;
      var pauseSlides = track.pauseSlides || [];
      var shouldPauseForSlide = pauseSlides.indexOf(currentSlideIndex) !== -1;
      
      if (isInRange) {
        // Cancel any pending fade out for this track
        if (fadingOutElements[i]) {
          clearInterval(activeFadeIntervals[i]);
          delete activeFadeIntervals[i];
          // Restore the element that was fading out
          activeAudioElements[i] = fadingOutElements[i];
          delete fadingOutElements[i];
          
          // Get target volume
          var targetVolume = (track.volume !== undefined ? track.volume : 100) / 100;
          
          // Fade back in if fades are enabled, otherwise set volume immediately
          if (fadeEnabled) {
            var fadeInDuration = track.fadeIn !== undefined ? track.fadeIn : 0.5;
            fadeAudioVolume(activeAudioElements[i], i, activeAudioElements[i].volume, targetVolume, fadeInDuration, null);
          } else {
            activeAudioElements[i].volume = Math.min(1, targetVolume);
          }
        }
        
        if (!activeAudioElements[i]) {
          // Audio should start playing
          var el = new Audio(track.src);
          el.loop = !!track.loop;
          
          // Get volume and fade settings
          var targetVolume = (track.volume !== undefined ? track.volume : 100) / 100;
          
          activeAudioElements[i] = el;
          
          if (fadeEnabled) {
            // Start at volume 0 for fade in
            var fadeInDuration = track.fadeIn !== undefined ? track.fadeIn : 0.5;
            el.volume = 0;
            
            // Start playback then fade in (unless on a pause slide)
            if (!paused && !shouldPauseForSlide) {
              el.play().catch(function(){});
              fadeAudioVolume(el, i, 0, targetVolume, fadeInDuration, null);
            } else if (shouldPauseForSlide) {
              // On a pause slide - don't start playing, mark as paused for slide
              pausedForSlide[i] = true;
            }
          } else {
            // No fade - start at target volume immediately (unless on a pause slide)
            el.volume = Math.min(1, targetVolume);
            if (!paused && !shouldPauseForSlide) {
              el.play().catch(function(){});
            } else if (shouldPauseForSlide) {
              pausedForSlide[i] = true;
            }
          }
        } else {
          // Audio element exists - handle pause slides
          if (shouldPauseForSlide) {
            // Should be paused for this slide
            if (!pausedForSlide[i] && !activeAudioElements[i].paused) {
              activeAudioElements[i].pause();
              pausedForSlide[i] = true;
            }
          } else {
            // Not a pause slide - resume if was paused for slide
            if (pausedForSlide[i]) {
              delete pausedForSlide[i];
              if (!paused) {
                activeAudioElements[i].play().catch(function(){});
              }
            }
            // Update target volume (no fade for mid-track changes)
            // Only update if not currently fading
            if (!activeFadeIntervals[i]) {
              var targetVolume = (track.volume !== undefined ? track.volume : 100) / 100;
              activeAudioElements[i].volume = Math.min(1, targetVolume);
            }
          }
        }
      } else if (activeAudioElements[i] && !fadingOutElements[i]) {
        // Audio should stop (leaving range)
        var audioEl = activeAudioElements[i];
        var trackIndexToRemove = i;
        
        // Clear pause state
        delete pausedForSlide[i];
        
        if (fadeEnabled) {
          // Apply fade out
          var fadeOutDuration = track.fadeOut !== undefined ? track.fadeOut : 0.5;
          
          // Move to fading out state
          fadingOutElements[i] = audioEl;
          delete activeAudioElements[i];
          
          // Fade out then stop
          fadeAudioVolume(audioEl, i, audioEl.volume, 0, fadeOutDuration, function() {
            // Only stop if still in fading out state (not restored)
            if (fadingOutElements[trackIndexToRemove] === audioEl) {
              audioEl.pause();
              audioEl.currentTime = 0;
              delete fadingOutElements[trackIndexToRemove];
            }
          });
        } else {
          // No fade - stop immediately
          audioEl.pause();
          audioEl.currentTime = 0;
          delete activeAudioElements[i];
        }
      }
    }
  };
}

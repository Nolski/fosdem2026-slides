var isPresenter = (window.location.search.indexOf("presenter") !== -1);

if (isPresenter) {
  // ---------- PRESENTER VIEW CODE ----------
  
  document.body.innerHTML = `
    <div id="presenter-controls" style="margin-bottom: 20px;">
       <button id="startPresBtn">Start Presentation</button>
       <button id="pauseBtn" style="display:none;">Pause</button>
       <span id="timerDisplay" style="display:none;">00:00:00</span>
       <button id="bleepBtn">🔇 Bleep</button>
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

  // Helper function to render slide preview
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
          var currentTime = video.currentTime;
          var duration = video.duration;
          if (duration) {
            seekSlider.value = (currentTime / duration) * 100;
          }
        });
      }
      container.appendChild(video);
    } else if (slide.type === "placeholder") {
      var placeholderDiv = document.createElement("div");
      placeholderDiv.style.cssText = `
        background: ${slide.backgroundColor || '#333333'};
        padding: 20px;
        text-align: center;
        color: white;
        min-height: 100px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      `;
      placeholderDiv.innerHTML = `
        <h3 style="margin: 0 0 10px 0;">${slide.title || 'Placeholder'}</h3>
        <p style="margin: 0; opacity: 0.6; font-size: 0.9rem;">Slide content coming soon</p>
      `;
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
      var currentPreview = document.getElementById("current-preview");
      renderSlidePreview(curSlide, currentPreview, true);
      
      // Format notes with auto-numbering (remove manual "Slide X:" prefix)
      var notes = curSlide.notes || "";
      notes = notes.replace(/^Slide\s*\d+\s*:\s*/i, "");
      document.getElementById("current-notes").innerText = `[Slide ${currentIndex + 1}] ${notes}`;

      var nextIndex = currentIndex + 1;
      var nextPreview = document.getElementById("next-preview");
      nextPreview.innerHTML = "";
      if (nextIndex < slides.length) {
        var nextSlide = slides[nextIndex];
        renderSlidePreview(nextSlide, nextPreview, false);
        var nextNotes = nextSlide.notes || "";
        nextNotes = nextNotes.replace(/^Slide\s*\d+\s*:\s*/i, "");
        document.getElementById("next-notes").innerText = `[Slide ${nextIndex + 1}] ${nextNotes}`;
      } else {
        nextPreview.innerHTML = "<em>No upcoming slide</em>";
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
  }, false);

  document.addEventListener("keydown", function(e) {
    e.preventDefault();
    if (e.key === "ArrowRight") {
      if (window.opener && !window.opener.closed) {
        window.opener.advanceSlide();
      }
    } else if (e.key === "ArrowLeft") {
      if (window.opener && !window.opener.closed) {
        window.opener.previousSlide();
      }
    }
  });

  // BLEEP BUTTON WITH WEB AUDIO API
  const bleepBtn = document.getElementById("bleepBtn");
  let audioCtx = null;
  let oscillator = null;

  bleepBtn.addEventListener("mousedown", () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    oscillator = audioCtx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime); // 1kHz
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

} else {
  // ---------- MAIN VIEW CODE (EDIT + PRESENT) ----------
  
  // State
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
  var isEditMode = true;

  // Slide block width for timeline calculations (70px + 8px gap)
  var BLOCK_WIDTH = 78;

  // DOM Elements
  var editModeBtn = document.getElementById("editModeBtn");
  var presentModeBtn = document.getElementById("presentModeBtn");
  var presentControls = document.getElementById("present-controls");
  var editControls = document.getElementById("edit-controls");
  var editModeContainer = document.getElementById("edit-mode");
  var presentationContainer = document.getElementById("presentation");
  
  var slidesTimeline = document.getElementById("slides-timeline");
  var audioTimeline = document.getElementById("audio-timeline");
  var timelineRuler = document.getElementById("timeline-ruler");
  var slideCountDisplay = document.getElementById("slide-count-display");
  
  var slideEditor = document.getElementById("slide-editor");
  var audioEditor = document.getElementById("audio-editor");
  var slideForm = document.getElementById("slide-form");
  var audioForm = document.getElementById("audio-form");
  var editorPlaceholder = document.getElementById("editor-placeholder");
  var previewContainer = document.getElementById("preview-container");
  var slidePositionBadge = document.getElementById("slide-position-badge");
  
  var startBtnElem = document.getElementById("startBtn");
  var presenterBtnElem = document.getElementById("presenterBtn");
  var exportBtn = document.getElementById("exportBtn");
  var importBtn = document.getElementById("importBtn");
  var importInput = document.getElementById("importInput");
  
  var addVideoBtn = document.getElementById("addVideoBtn");
  var addImageBtn = document.getElementById("addImageBtn");
  var addPlaceholderBtn = document.getElementById("addPlaceholderBtn");
  var addAudioBtn = document.getElementById("addAudioBtn");
  var deleteSlideBtn = document.getElementById("deleteSlideBtn");
  var deleteAudioBtn = document.getElementById("deleteAudioBtn");
  
  // Slide form elements
  var slideTypeSelect = document.getElementById("slide-type");
  var slideSrcInput = document.getElementById("slide-src");
  var slideNotesInput = document.getElementById("slide-notes");
  var slideLoopInput = document.getElementById("slide-loop");
  var placeholderTitleInput = document.getElementById("placeholder-title");
  var placeholderColorInput = document.getElementById("placeholder-color");
  var srcGroup = document.getElementById("src-group");
  var placeholderGroup = document.getElementById("placeholder-group");
  var loopGroup = document.getElementById("loop-group");
  
  // Audio form elements
  var audioSrcInput = document.getElementById("audio-src");
  var audioStartInput = document.getElementById("audio-start");
  var audioEndInput = document.getElementById("audio-end");
  var audioLoopInput = document.getElementById("audio-loop");

  // Load data
  fetch('data.json')
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      if (data.slides) {
        slides = data.slides;
        audioTracks = data.audio || [];
      } else {
        slides = data;
      }
      renderTimelines();
    })
    .catch(function(error) {
      console.error("Error loading slide data:", error);
      slides = [];
      renderTimelines();
    });

  // ============================================
  // MODE SWITCHING
  // ============================================
  
  function switchToEditMode() {
    isEditMode = true;
    editModeBtn.classList.add("active");
    presentModeBtn.classList.remove("active");
    presentControls.style.display = "none";
    editControls.style.display = "flex";
    document.body.classList.remove("present-mode");
    editModeContainer.style.display = "grid";
    presentationContainer.classList.remove("active");
    window.presentationStarted = false;
    paused = false;
    
    // Stop any playing media
    if (window.currentMedia) {
      window.currentMedia.pause();
      window.currentMedia = null;
    }
    
    // Stop all audio
    for (let key in activeAudioElements) {
      activeAudioElements[key].pause();
      delete activeAudioElements[key];
    }
  }
  
  function switchToPresentMode() {
    isEditMode = false;
    editModeBtn.classList.remove("active");
    presentModeBtn.classList.add("active");
    presentControls.style.display = "flex";
    editControls.style.display = "none";
    editModeContainer.style.display = "none";
    presentationContainer.classList.add("active");
    
    // Start from selected slide if one is selected, otherwise from beginning
    if (selectedSlideIndex >= 0) {
      currentSlideIndex = selectedSlideIndex;
    } else {
      currentSlideIndex = 0;
    }
  }
  
  editModeBtn.addEventListener("click", switchToEditMode);
  presentModeBtn.addEventListener("click", switchToPresentMode);

  // ============================================
  // TIMELINE RENDERING
  // ============================================
  
  function renderTimelines() {
    renderSlidesTimeline();
    renderAudioTimeline();
    renderTimelineRuler();
    slideCountDisplay.textContent = slides.length + " slide" + (slides.length !== 1 ? "s" : "");
  }
  
  function renderSlidesTimeline() {
    slidesTimeline.innerHTML = "";
    
    slides.forEach(function(slide, index) {
      var block = document.createElement("div");
      block.className = "slide-block" + 
        (slide.type === "placeholder" ? " placeholder" : "") + 
        (index === selectedSlideIndex ? " selected" : "");
      block.dataset.index = index;
      
      var typeIcon = slide.type === "video" ? "🎬" : 
                     slide.type === "image" ? "🖼️" : "⏳";
      
      block.innerHTML = `
        <div class="block-number">${index + 1}</div>
        <div class="block-icon">${typeIcon}</div>
        <div class="block-type">${slide.type}</div>
        <div class="block-actions">
          <button class="block-move-btn move-left" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="Move left">◀</button>
          <button class="block-move-btn move-right" data-index="${index}" ${index === slides.length - 1 ? 'disabled' : ''} title="Move right">▶</button>
        </div>
      `;
      
      block.addEventListener("click", function(e) {
        if (!e.target.classList.contains("block-move-btn")) {
          selectSlide(index);
        }
      });
      
      slidesTimeline.appendChild(block);
    });
    
    // Add move button listeners
    document.querySelectorAll(".move-left").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var idx = parseInt(this.dataset.index);
        moveSlide(idx, idx - 1);
      });
    });
    
    document.querySelectorAll(".move-right").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var idx = parseInt(this.dataset.index);
        moveSlide(idx, idx + 1);
      });
    });
  }
  
  function renderAudioTimeline() {
    audioTimeline.innerHTML = "";
    
    if (slides.length === 0) return;
    
    audioTracks.forEach(function(track, index) {
      var audioBlock = document.createElement("div");
      audioBlock.className = "audio-track" + (index === selectedAudioIndex ? " selected" : "");
      audioBlock.dataset.index = index;
      
      // Calculate position and width based on slide positions
      var startSlide = Math.max(0, track.startSlide);
      var endSlide = Math.min(slides.length - 1, track.endSlide);
      var left = startSlide * BLOCK_WIDTH + 4;
      var width = (endSlide - startSlide + 1) * BLOCK_WIDTH - 8;
      
      audioBlock.style.left = left + "px";
      audioBlock.style.width = Math.max(60, width) + "px";
      
      // Extract filename for display
      var filename = track.src.split('/').pop();
      audioBlock.innerHTML = `<span class="audio-icon">🔊</span><span class="audio-label">${filename}</span>`;
      
      audioBlock.addEventListener("click", function() {
        selectAudioTrack(index);
      });
      
      audioTimeline.appendChild(audioBlock);
    });
    
    // Set minimum width of audio timeline to match slides
    var wrapper = document.getElementById("audio-timeline-wrapper");
    if (wrapper) {
      wrapper.style.minWidth = (slides.length * BLOCK_WIDTH) + "px";
    }
  }
  
  function renderTimelineRuler() {
    timelineRuler.innerHTML = "";
    
    slides.forEach(function(slide, index) {
      var mark = document.createElement("div");
      mark.className = "ruler-mark";
      mark.textContent = index + 1;
      timelineRuler.appendChild(mark);
    });
  }
  
  function moveSlide(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= slides.length) return;
    
    var slide = slides.splice(fromIndex, 1)[0];
    slides.splice(toIndex, 0, slide);
    
    // Update selection
    if (selectedSlideIndex === fromIndex) {
      selectedSlideIndex = toIndex;
    } else if (selectedSlideIndex === toIndex) {
      selectedSlideIndex = fromIndex;
    }
    
    renderTimelines();
    
    // Keep selection visible
    if (selectedSlideIndex >= 0) {
      updateSlidePositionBadge();
    }
  }

  // ============================================
  // SLIDE SELECTION AND EDITING
  // ============================================
  
  function selectSlide(index) {
    selectedSlideIndex = index;
    selectedAudioIndex = -1; // Deselect audio
    
    // Update timeline selection
    document.querySelectorAll(".slide-block").forEach(function(block, i) {
      block.classList.toggle("selected", i === index);
    });
    document.querySelectorAll(".audio-track").forEach(function(track) {
      track.classList.remove("selected");
    });
    
    // Show slide editor, hide audio editor
    slideEditor.style.display = "block";
    audioEditor.style.display = "none";
    editorPlaceholder.style.display = "none";
    slideForm.style.display = "flex";
    
    // Update position badge
    updateSlidePositionBadge();
    
    // Populate form
    var slide = slides[index];
    slideTypeSelect.value = slide.type;
    slideSrcInput.value = slide.src || "";
    
    // Strip "Slide X:" prefix from notes for editing
    var notes = slide.notes || "";
    notes = notes.replace(/^Slide\s*\d+\s*:\s*/i, "");
    slideNotesInput.value = notes;
    
    slideLoopInput.checked = !!slide.loop;
    placeholderTitleInput.value = slide.title || "";
    placeholderColorInput.value = slide.backgroundColor || "#333333";
    
    updateFormVisibility(slide.type);
    updatePreview(slide);
  }
  
  function updateSlidePositionBadge() {
    if (selectedSlideIndex >= 0) {
      slidePositionBadge.textContent = "Slide " + (selectedSlideIndex + 1) + " of " + slides.length;
      slidePositionBadge.style.display = "inline-block";
    } else {
      slidePositionBadge.style.display = "none";
    }
  }
  
  function selectAudioTrack(index) {
    selectedAudioIndex = index;
    selectedSlideIndex = -1; // Deselect slide
    
    // Update timeline selection
    document.querySelectorAll(".slide-block").forEach(function(block) {
      block.classList.remove("selected");
    });
    document.querySelectorAll(".audio-track").forEach(function(track, i) {
      track.classList.toggle("selected", i === index);
    });
    
    // Show audio editor, hide slide editor
    slideEditor.style.display = "none";
    audioEditor.style.display = "block";
    slidePositionBadge.style.display = "none";
    
    // Populate audio form
    var track = audioTracks[index];
    audioSrcInput.value = track.src || "";
    audioStartInput.value = track.startSlide + 1; // Display as 1-indexed
    audioEndInput.value = track.endSlide + 1;
    audioStartInput.max = slides.length;
    audioEndInput.max = slides.length;
    audioLoopInput.checked = !!track.loop;
    
    // Clear slide preview
    previewContainer.innerHTML = '<p class="preview-placeholder">Audio track selected</p>';
  }
  
  function updateFormVisibility(type) {
    if (type === "placeholder") {
      srcGroup.style.display = "none";
      placeholderGroup.style.display = "flex";
      loopGroup.style.display = "none";
    } else {
      srcGroup.style.display = "flex";
      placeholderGroup.style.display = "none";
      loopGroup.style.display = "flex";
    }
  }
  
  slideTypeSelect.addEventListener("change", function() {
    updateFormVisibility(this.value);
  });
  
  function updatePreview(slide) {
    previewContainer.innerHTML = "";
    
    if (slide.type === "video") {
      var video = document.createElement("video");
      video.src = slide.src;
      video.controls = true;
      video.muted = true;
      video.style.maxWidth = "100%";
      video.style.maxHeight = "100%";
      previewContainer.appendChild(video);
    } else if (slide.type === "image") {
      var img = document.createElement("img");
      img.src = slide.src;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      previewContainer.appendChild(img);
    } else if (slide.type === "placeholder") {
      var div = document.createElement("div");
      div.className = "placeholder-preview";
      div.style.backgroundColor = slide.backgroundColor || "#333333";
      div.innerHTML = `
        <h3>${slide.title || 'Placeholder'}</h3>
        <p>Slide content coming soon</p>
      `;
      previewContainer.appendChild(div);
    }
  }
  
  // Save slide changes
  slideForm.addEventListener("submit", function(e) {
    e.preventDefault();
    if (selectedSlideIndex < 0) return;
    
    var slide = slides[selectedSlideIndex];
    slide.type = slideTypeSelect.value;
    
    if (slide.type === "placeholder") {
      slide.title = placeholderTitleInput.value;
      slide.backgroundColor = placeholderColorInput.value;
      delete slide.src;
      delete slide.loop;
    } else {
      slide.src = slideSrcInput.value;
      slide.loop = slideLoopInput.checked;
      delete slide.title;
      delete slide.backgroundColor;
    }
    
    // Store notes without "Slide X:" prefix - auto-numbering handles this
    slide.notes = slideNotesInput.value;
    
    renderTimelines();
    updatePreview(slide);
    
    // Re-select to update UI
    selectSlide(selectedSlideIndex);
    
    // Flash save confirmation
    var saveBtn = slideForm.querySelector(".save-btn");
    var originalText = saveBtn.innerText;
    saveBtn.innerText = "✓ Saved!";
    saveBtn.style.background = "#27ae60";
    setTimeout(function() {
      saveBtn.innerText = originalText;
      saveBtn.style.background = "";
    }, 1500);
  });
  
  // Save audio track changes
  audioForm.addEventListener("submit", function(e) {
    e.preventDefault();
    if (selectedAudioIndex < 0) return;
    
    var track = audioTracks[selectedAudioIndex];
    track.src = audioSrcInput.value;
    track.startSlide = Math.max(0, parseInt(audioStartInput.value) - 1); // Convert to 0-indexed
    track.endSlide = Math.max(track.startSlide, parseInt(audioEndInput.value) - 1);
    track.loop = audioLoopInput.checked;
    
    renderAudioTimeline();
    
    // Flash save confirmation
    var saveBtn = audioForm.querySelector(".save-btn");
    var originalText = saveBtn.innerText;
    saveBtn.innerText = "✓ Saved!";
    saveBtn.style.background = "#27ae60";
    setTimeout(function() {
      saveBtn.innerText = originalText;
      saveBtn.style.background = "";
    }, 1500);
  });

  // ============================================
  // ADD / DELETE SLIDES
  // ============================================
  
  function addSlide(type) {
    var newSlide = {
      type: type,
      notes: ""
    };
    
    if (type === "video") {
      newSlide.src = "media/video/";
      newSlide.loop = false;
    } else if (type === "image") {
      newSlide.src = "media/";
    } else if (type === "placeholder") {
      newSlide.title = "Coming Soon";
      newSlide.backgroundColor = "#333333";
    }
    
    // Insert after selected slide, or at end
    var insertIndex = selectedSlideIndex >= 0 ? selectedSlideIndex + 1 : slides.length;
    slides.splice(insertIndex, 0, newSlide);
    
    renderTimelines();
    selectSlide(insertIndex);
    
    // Scroll to new slide
    setTimeout(function() {
      var newBlock = slidesTimeline.querySelector('[data-index="' + insertIndex + '"]');
      if (newBlock) {
        newBlock.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }, 50);
  }
  
  function addAudioTrack() {
    var newTrack = {
      src: "media/audio/",
      startSlide: selectedSlideIndex >= 0 ? selectedSlideIndex : 0,
      endSlide: selectedSlideIndex >= 0 ? Math.min(selectedSlideIndex + 5, slides.length - 1) : Math.min(5, slides.length - 1),
      loop: false
    };
    
    audioTracks.push(newTrack);
    renderAudioTimeline();
    selectAudioTrack(audioTracks.length - 1);
  }
  
  addVideoBtn.addEventListener("click", function() { addSlide("video"); });
  addImageBtn.addEventListener("click", function() { addSlide("image"); });
  addPlaceholderBtn.addEventListener("click", function() { addSlide("placeholder"); });
  addAudioBtn.addEventListener("click", addAudioTrack);
  
  deleteSlideBtn.addEventListener("click", function() {
    if (selectedSlideIndex < 0) return;
    
    if (confirm("Are you sure you want to delete this slide?")) {
      slides.splice(selectedSlideIndex, 1);
      
      // Adjust selection
      if (slides.length === 0) {
        selectedSlideIndex = -1;
        editorPlaceholder.style.display = "block";
        slideForm.style.display = "none";
        slidePositionBadge.style.display = "none";
        previewContainer.innerHTML = '<p class="preview-placeholder">Select a slide to preview</p>';
      } else if (selectedSlideIndex >= slides.length) {
        selectedSlideIndex = slides.length - 1;
        selectSlide(selectedSlideIndex);
      } else {
        selectSlide(selectedSlideIndex);
      }
      
      renderTimelines();
    }
  });
  
  deleteAudioBtn.addEventListener("click", function() {
    if (selectedAudioIndex < 0) return;
    
    if (confirm("Are you sure you want to delete this audio track?")) {
      audioTracks.splice(selectedAudioIndex, 1);
      selectedAudioIndex = -1;
      
      // Hide audio editor, show slide editor placeholder
      audioEditor.style.display = "none";
      slideEditor.style.display = "block";
      editorPlaceholder.style.display = "block";
      slideForm.style.display = "none";
      
      renderAudioTimeline();
    }
  });

  // ============================================
  // IMPORT / EXPORT
  // ============================================
  
  exportBtn.addEventListener("click", function() {
    var exportData = {
      slides: slides,
      audio: audioTracks
    };
    
    var dataStr = JSON.stringify(exportData, null, 2);
    var blob = new Blob([dataStr], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    
    var a = document.createElement("a");
    a.href = url;
    a.download = "data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  
  importBtn.addEventListener("click", function() {
    importInput.click();
  });
  
  importInput.addEventListener("change", function(e) {
    var file = e.target.files[0];
    if (!file) return;
    
    var reader = new FileReader();
    reader.onload = function(event) {
      try {
        var data = JSON.parse(event.target.result);
        if (data.slides) {
          slides = data.slides;
          audioTracks = data.audio || [];
        } else if (Array.isArray(data)) {
          slides = data;
          audioTracks = [];
        }
        
        selectedSlideIndex = -1;
        selectedAudioIndex = -1;
        editorPlaceholder.style.display = "block";
        slideForm.style.display = "none";
        audioEditor.style.display = "none";
        slideEditor.style.display = "block";
        slidePositionBadge.style.display = "none";
        previewContainer.innerHTML = '<p class="preview-placeholder">Select a slide to preview</p>';
        
        renderTimelines();
        alert("Slides imported successfully!");
      } catch (err) {
        alert("Error parsing JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
    
    // Reset input
    importInput.value = "";
  });

  // ============================================
  // PRESENTATION MODE
  // ============================================
  
  window.addEventListener("message", function(e) {
    if (e.data.type === "togglePause") {
      togglePause();
    }
  });

  function togglePause() {
    if (window.currentMedia && window.currentMedia.tagName === "VIDEO") {
      if (!paused) {
        window.currentMedia.pause();
      } else {
        window.currentMedia.play();
      }
    }
    paused = !paused;
    for (let key in activeAudioElements) {
      if (paused) {
        activeAudioElements[key].pause();
      } else {
        activeAudioElements[key].play().catch(e => console.error("Audio play error:", e));
      }
    }
    updatePresenterView();
  }

  function startPresentation() {
    if (window.presentationStarted) return;
    window.presentationStarted = true;
    document.body.classList.add("present-mode");
    loadSlide(currentSlideIndex);
  }
  window.startPresentation = startPresentation;

  function loadSlide(index) {
    var container = document.getElementById("presentation");
    container.innerHTML = "";
    if (index < 0 || index >= slides.length) {
      container.innerHTML = "<h1 style='color:white;'>End of Presentation</h1>";
      return;
    }
    var slide = slides[index];
    
    if (slide.type === "image") {
      var img = document.createElement("img");
      img.src = slide.src;
      container.appendChild(img);
      window.currentMedia = null;
    } else if (slide.type === "video") {
      var video = document.createElement("video");
      video.src = slide.src;
      video.autoplay = true;
      video.controls = false;
      if (slide.loop) {
        video.loop = true;
      }
      container.appendChild(video);
      window.currentMedia = video;
      video.addEventListener("loadeddata", function () {
        video.play().catch(function (error) {
          console.error("Video play failed:", error);
        });
      });
    } else if (slide.type === "placeholder") {
      var placeholderDiv = document.createElement("div");
      placeholderDiv.className = "placeholder-slide";
      placeholderDiv.style.backgroundColor = slide.backgroundColor || "#333333";
      placeholderDiv.innerHTML = `
        <h1>${slide.title || 'Placeholder'}</h1>
        <p>Slide content coming soon</p>
      `;
      container.appendChild(placeholderDiv);
      window.currentMedia = null;
    }
    
    updatePresenterView();
    updateAudio();
  }

  function updateAudio() {
    for (let i = 0; i < audioTracks.length; i++) {
      let track = audioTracks[i];
      if (currentSlideIndex >= track.startSlide && currentSlideIndex <= track.endSlide) {
        if (!activeAudioElements[i]) {
          let audioEl = new Audio(track.src);
          audioEl.loop = !!track.loop;
          activeAudioElements[i] = audioEl;
          if (!paused) {
            audioEl.play().catch(e => console.error("Audio play error:", e));
          }
        } else {
          let audioEl = activeAudioElements[i];
          if (audioEl.ended) {
            audioEl.currentTime = 0;
            if (!paused) {
              audioEl.play().catch(e => console.error("Audio play error:", e));
            }
          } else if (!paused && audioEl.paused) {
            audioEl.play().catch(e => console.error("Audio play error:", e));
          }
        }
      } else {
        if (activeAudioElements[i]) {
          activeAudioElements[i].pause();
          activeAudioElements[i].currentTime = 0;
          delete activeAudioElements[i];
        }
      }
    }
  }

  function advanceSlide() {
    if (!window.presentationStarted || !canChangeSlide) return;
    canChangeSlide = false;
    if (currentSlideIndex < slides.length - 1) {
      currentSlideIndex++;
      loadSlide(currentSlideIndex);
    }
    setTimeout(function () {
      canChangeSlide = true;
    }, 500);
  }
  window.advanceSlide = advanceSlide;

  function previousSlide() {
    if (!window.presentationStarted || !canChangeSlide) return;
    canChangeSlide = false;
    if (currentSlideIndex > 0) {
      currentSlideIndex--;
      loadSlide(currentSlideIndex);
    }
    setTimeout(function () {
      canChangeSlide = true;
    }, 500);
  }
  window.previousSlide = previousSlide;

  function updatePresenterView() {
    if (presenterWindow && !presenterWindow.closed) {
      presenterWindow.postMessage({
        type: "update",
        currentSlideIndex: currentSlideIndex,
        slides: slides,
        paused: paused
      }, "*");
    }
  }

  if (startBtnElem) {
    startBtnElem.addEventListener("click", function() {
      startPresentation();
    });
  }

  if (presenterBtnElem) {
    presenterBtnElem.addEventListener("click", function () {
      if (!presenterWindow || presenterWindow.closed) {
        presenterWindow = window.open(window.location.href + "?presenter", "PresenterView", "width=800,height=600");
      } else {
        presenterWindow.focus();
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    // Only handle keys in present mode when presentation has started
    if (!window.presentationStarted) return;
    
    if (e.key === "ArrowRight") {
      advanceSlide();
    } else if (e.key === "ArrowLeft") {
      previousSlide();
    } else if (e.key === "Escape") {
      // Exit present mode
      switchToEditMode();
    }
  });
}

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

  var BLOCK_WIDTH = 76; // 70px + 6px gap

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
  var placeholderTitleInput = document.getElementById("placeholder-title");
  var placeholderTextInput = document.getElementById("placeholder-text");
  var placeholderColorInput = document.getElementById("placeholder-color");
  var srcGroup = document.getElementById("src-group");
  var placeholderGroup = document.getElementById("placeholder-group");
  var loopGroup = document.getElementById("loop-group");
  var zoompanGroup = document.getElementById("zoompan-group");
  
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

  // Load data
  fetch('data.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      slides = data.slides || data;
      audioTracks = data.audio || [];
      renderTimelines();
    })
    .catch(function(e) {
      console.error("Error loading data:", e);
      slides = [];
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
      el.style.left = (start * BLOCK_WIDTH + 4) + "px";
      el.style.width = Math.max(50, (end - start + 1) * BLOCK_WIDTH - 8) + "px";
      
      var filename = track.src.split('/').pop();
      el.innerHTML = '<span class="audio-icon">🔊</span><span class="audio-label">' + filename + '</span>';
      el.addEventListener("click", function() { selectAudioTrack(i); });
      audioTimeline.appendChild(el);
    });
    
    var wrapper = document.getElementById("audio-timeline-wrapper");
    if (wrapper) wrapper.style.minWidth = (slides.length * BLOCK_WIDTH) + "px";
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
    
    // Show Edit Video button only for video slides
    var editVideoGroup = document.getElementById("edit-video-group");
    if (editVideoGroup) {
      editVideoGroup.style.display = type === "video" ? "flex" : "none";
    }
  }
  
  slideTypeSelect.addEventListener("change", function() { updateFormVisibility(this.value); });
  
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
      delete slide.src; delete slide.loop; delete slide.zoompan;
    } else if (slide.type === "image") {
      slide.src = slideSrcInput.value;
      slide.zoompan = slideZoompanInput.checked;
      delete slide.title; delete slide.text; delete slide.backgroundColor; delete slide.loop;
    } else {
      slide.src = slideSrcInput.value;
      slide.loop = slideLoopInput.checked;
      delete slide.title; delete slide.text; delete slide.backgroundColor; delete slide.zoompan;
    }
    slide.notes = slideNotesInput.value;
    
    renderTimelines();
    updatePreview(slide);
    selectSlide(selectedSlideIndex);
    
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
      loop: false
    });
    renderAudioTimeline();
    selectAudioTrack(audioTracks.length - 1);
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
      if (slide.zoompan) img.className = "zoompan";
      container.appendChild(img);
      window.currentMedia = null;
    } else if (slide.type === "video") {
      var video = document.createElement("video");
      video.src = slide.src;
      video.autoplay = true;
      if (slide.loop) video.loop = true;
      container.appendChild(video);
      window.currentMedia = video;
      video.addEventListener("loadeddata", function() { video.play().catch(function(){}); });
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
  var veVolumeSlider = document.getElementById("ve-volume");
  var veVolumeValue = document.getElementById("ve-volume-value");
  var veTextEnabled = document.getElementById("ve-text-enabled");
  var veTextOptions = document.getElementById("ve-text-options");
  var veTextInput = document.getElementById("ve-text-input");
  var veFontFamily = document.getElementById("ve-font-family");
  var veFontSize = document.getElementById("ve-font-size");
  var veFontColor = document.getElementById("ve-font-color");
  var veApplyBtn = document.getElementById("ve-apply-btn");
  var veCancelBtn = document.getElementById("ve-cancel-btn");
  var veDoneBtn = document.getElementById("ve-done-btn");
  var veErrorRetryBtn = document.getElementById("ve-error-retry-btn");
  var editVideoBtn = document.getElementById("editVideoBtn");
  var editVideoGroup = document.getElementById("edit-video-group");
  
  var ffmpeg = null;
  var ffmpegLoaded = false;
  var currentEditVideoSrc = null;
  var currentEditVideoBlob = null;
  var selectedTextPosition = "middle-center";
  
  // Helper to convert local file to blob URL
  async function toBlobURL(url, mimeType) {
    var response = await fetch(url);
    var blob = await response.blob();
    return URL.createObjectURL(new Blob([blob], { type: mimeType }));
  }
  
  // FFmpeg loading - uses local files converted to blob URLs
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
      
      veFFmpegStatus.textContent = "Loading FFmpeg core files...";
      
      // Convert local files to blob URLs to ensure proper loading
      var coreURL = await toBlobURL("lib/ffmpeg/ffmpeg-core.js", "text/javascript");
      veFFmpegStatus.textContent = "Loading FFmpeg WebAssembly (~30MB)...";
      var wasmURL = await toBlobURL("lib/ffmpeg/ffmpeg-core.wasm", "application/wasm");
      var workerURL = await toBlobURL("lib/ffmpeg/814.ffmpeg.js", "text/javascript");
      
      veFFmpegStatus.textContent = "Initializing FFmpeg...";
      
      await ffmpeg.load({
        coreURL: coreURL,
        wasmURL: wasmURL,
        classWorkerURL: workerURL
      });
      
      ffmpegLoaded = true;
      console.log("FFmpeg loaded successfully");
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
    veVolumeSlider.value = 100;
    veVolumeValue.textContent = "100%";
    veTextEnabled.checked = false;
    veTextOptions.style.display = "none";
    veTextInput.value = "";
    veFontFamily.value = "Arial";
    veFontSize.value = "48";
    veFontColor.value = "#ffffff";
    selectedTextPosition = "middle-center";
    updatePositionButtons();
    
    // Load video preview
    vePreviewVideo.src = videoSrc;
    
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
  
  function updatePositionButtons() {
    document.querySelectorAll(".ve-pos-btn").forEach(function(btn) {
      btn.classList.toggle("active", btn.dataset.pos === selectedTextPosition);
    });
  }
  
  // Position button clicks
  document.querySelectorAll(".ve-pos-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      selectedTextPosition = this.dataset.pos;
      updatePositionButtons();
    });
  });
  
  // Volume slider
  veVolumeSlider.addEventListener("input", function() {
    veVolumeValue.textContent = this.value + "%";
  });
  
  // Text overlay toggle
  veTextEnabled.addEventListener("change", function() {
    veTextOptions.style.display = this.checked ? "block" : "none";
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
  
  // Get text position coordinates for FFmpeg drawtext
  function getTextPosition(position, fontSize) {
    var padding = 20;
    var positions = {
      "top-left": { x: padding, y: padding },
      "top-center": { x: "(w-text_w)/2", y: padding },
      "top-right": { x: "w-text_w-" + padding, y: padding },
      "middle-left": { x: padding, y: "(h-text_h)/2" },
      "middle-center": { x: "(w-text_w)/2", y: "(h-text_h)/2" },
      "middle-right": { x: "w-text_w-" + padding, y: "(h-text_h)/2" },
      "bottom-left": { x: padding, y: "h-text_h-" + padding },
      "bottom-center": { x: "(w-text_w)/2", y: "h-text_h-" + padding },
      "bottom-right": { x: "w-text_w-" + padding, y: "h-text_h-" + padding }
    };
    return positions[position] || positions["middle-center"];
  }
  
  // Convert hex color to FFmpeg format
  function hexToFFmpegColor(hex) {
    // FFmpeg uses format like 0xRRGGBB or white, black, etc
    return hex.replace("#", "0x");
  }
  
  // Apply edits and download
  veApplyBtn.addEventListener("click", async function() {
    if (!ffmpeg || !currentEditVideoSrc) return;
    
    setVideoEditState("processing");
    veProgressFill.style.width = "0%";
    veProgressText.textContent = "0%";
    veProcessingStatus.textContent = "Fetching video file...";
    
    try {
      // Fetch the video file
      var response = await fetch(currentEditVideoSrc);
      var videoData = await response.arrayBuffer();
      
      // Determine input file extension
      var inputExt = currentEditVideoSrc.split('.').pop().toLowerCase();
      if (inputExt === "m4v") inputExt = "mp4"; // Treat m4v as mp4
      var inputFile = "input." + inputExt;
      var outputFile = "output.mp4";
      
      veProcessingStatus.textContent = "Writing video to FFmpeg...";
      
      // Write input file to FFmpeg
      await ffmpeg.writeFile(inputFile, new Uint8Array(videoData));
      
      veProcessingStatus.textContent = "Processing video...";
      
      // Build FFmpeg command
      var filters = [];
      var audioFilters = [];
      
      // Volume adjustment
      var volume = parseInt(veVolumeSlider.value) / 100;
      if (volume !== 1) {
        audioFilters.push("volume=" + volume);
      }
      
      // Text overlay
      if (veTextEnabled.checked && veTextInput.value.trim()) {
        var text = veTextInput.value.trim().replace(/'/g, "\\'").replace(/:/g, "\\:");
        var fontFamily = veFontFamily.value;
        var fontSize = veFontSize.value;
        var fontColor = hexToFFmpegColor(veFontColor.value);
        var pos = getTextPosition(selectedTextPosition, fontSize);
        
        // Build drawtext filter
        var drawtext = "drawtext=text='" + text + "'";
        drawtext += ":fontsize=" + fontSize;
        drawtext += ":fontcolor=" + fontColor;
        drawtext += ":x=" + pos.x;
        drawtext += ":y=" + pos.y;
        drawtext += ":borderw=2:bordercolor=black";
        
        filters.push(drawtext);
      }
      
      // Build command arguments
      var args = ["-i", inputFile];
      
      // Add filters if any
      if (filters.length > 0 || audioFilters.length > 0) {
        var filterComplex = [];
        if (filters.length > 0) {
          filterComplex.push(filters.join(","));
        }
        if (audioFilters.length > 0) {
          args.push("-af", audioFilters.join(","));
        }
        if (filters.length > 0) {
          args.push("-vf", filters.join(","));
        }
      } else if (audioFilters.length > 0) {
        args.push("-af", audioFilters.join(","));
      }
      
      // Output settings
      args.push("-c:v", "libx264");
      args.push("-preset", "fast");
      args.push("-crf", "23");
      args.push("-c:a", "aac");
      args.push("-b:a", "128k");
      args.push("-movflags", "+faststart");
      args.push(outputFile);
      
      console.log("FFmpeg command:", args.join(" "));
      
      // Run FFmpeg
      await ffmpeg.exec(args);
      
      veProcessingStatus.textContent = "Reading output file...";
      
      // Read output file
      var outputData = await ffmpeg.readFile(outputFile);
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
      await ffmpeg.deleteFile(inputFile);
      await ffmpeg.deleteFile(outputFile);
      
      // Show complete state
      veOriginalPath.value = currentEditVideoSrc;
      setVideoEditState("complete");
      
    } catch (error) {
      console.error("Video processing error:", error);
      veErrorMessage.textContent = "Error processing video: " + error.message;
      setVideoEditState("error");
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
  // AUDIO VOLUME CONTROL
  // ============================================
  
  var audioVolumeSlider = document.getElementById("audio-volume");
  var audioVolumeValue = document.getElementById("audio-volume-value");
  
  // Update volume display
  audioVolumeSlider.addEventListener("input", function() {
    audioVolumeValue.textContent = this.value + "%";
  });
  
  // Override selectAudioTrack to include volume
  var originalSelectAudioTrack = selectAudioTrack;
  selectAudioTrack = function(index) {
    originalSelectAudioTrack(index);
    
    // Load volume setting
    var track = audioTracks[index];
    var volume = track.volume !== undefined ? track.volume : 100;
    audioVolumeSlider.value = volume;
    audioVolumeValue.textContent = volume + "%";
  };
  
  // Override audio form submit to include volume
  var originalAudioFormSubmit = audioForm.onsubmit;
  audioForm.addEventListener("submit", function(e) {
    // Save volume to track before the original handler
    if (selectedAudioIndex >= 0) {
      audioTracks[selectedAudioIndex].volume = parseInt(audioVolumeSlider.value);
    }
  });
  
  // Override updateAudio to apply volume during playback
  var originalUpdateAudio = updateAudio;
  updateAudio = function() {
    for (var i = 0; i < audioTracks.length; i++) {
      var track = audioTracks[i];
      if (currentSlideIndex >= track.startSlide && currentSlideIndex <= track.endSlide) {
        if (!activeAudioElements[i]) {
          var el = new Audio(track.src);
          el.loop = !!track.loop;
          // Apply volume
          var volume = track.volume !== undefined ? track.volume : 100;
          el.volume = Math.min(1, volume / 100);
          activeAudioElements[i] = el;
          if (!paused) el.play().catch(function(){});
        } else {
          // Update volume if track settings changed
          var volume = track.volume !== undefined ? track.volume : 100;
          activeAudioElements[i].volume = Math.min(1, volume / 100);
        }
      } else if (activeAudioElements[i]) {
        activeAudioElements[i].pause();
        activeAudioElements[i].currentTime = 0;
        delete activeAudioElements[i];
      }
    }
  };
}

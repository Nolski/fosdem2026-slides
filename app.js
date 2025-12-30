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

  window.addEventListener("message", function(event) {
    if (event.data.type === "update") {
      var currentIndex = event.data.currentSlideIndex;
      var slides = event.data.slides;

      var curSlide = slides[currentIndex];
      var currentPreview = document.getElementById("current-preview");
      currentPreview.innerHTML = "";
      if (curSlide.type === "image") {
        var img = document.createElement("img");
        img.src = curSlide.src;
        img.style.maxWidth = "100%";
        currentPreview.appendChild(img);
        document.getElementById("video-controls").style.display = "none";
        presenterVideo = null;
      } else if (curSlide.type === "video") {
        var video = document.createElement("video");
        video.src = curSlide.src;
        video.style.maxWidth = "100%";
        video.controls = true;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.loop = true; // Optional: remove if you don’t want looping
        currentPreview.appendChild(video);
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
      document.getElementById("current-notes").innerText = curSlide.notes || "";

      var nextIndex = currentIndex + 1;
      var nextPreview = document.getElementById("next-preview");
      nextPreview.innerHTML = "";
      if (nextIndex < slides.length) {
        var nextSlide = slides[nextIndex];
        if (nextSlide.type === "image") {
          var img2 = document.createElement("img");
          img2.src = nextSlide.src;
          img2.style.maxWidth = "100%";
          nextPreview.appendChild(img2);
        } else if (nextSlide.type === "video") {
          var video2 = document.createElement("video");
          video2.src = nextSlide.src;
          video2.style.maxWidth = "100%";
          video2.controls = true;
          nextPreview.appendChild(video2);
        }
        document.getElementById("next-notes").innerText = nextSlide.notes || "";
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
  // ---------- MAIN PRESENTATION VIEW CODE ----------
  var startBtnElem = document.getElementById("startBtn");
  if (startBtnElem) {
    startBtnElem.style.display = "none";
  }
  var presenterBtnElem = document.getElementById("presenterBtn");

  var slides = [];
  var currentSlideIndex = 0;
  var presenterWindow = null;
  window.presentationStarted = false;
  var paused = false;
  window.currentMedia = null;
  var audioTracks = [];
  var activeAudioElements = {};
  var canChangeSlide = true;

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
    })
    .catch(function(error) {
      console.error("Error loading slide data:", error);
    });

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

  if (presenterBtnElem) {
    presenterBtnElem.addEventListener("click", function () {
      if (!presenterWindow || presenterWindow.closed) {
        presenterWindow = window.open(window.location.href + "?presenter", "PresenterView", "width=800,height=600");
        presenterBtnElem.style.display = "none";
      } else {
        presenterWindow.focus();
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    if (!window.presentationStarted) return;
    if (e.key === "ArrowRight") {
      advanceSlide();
    } else if (e.key === "ArrowLeft") {
      previousSlide();
    }
  });
}


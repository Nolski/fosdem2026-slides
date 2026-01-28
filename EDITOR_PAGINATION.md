# Editor Slide Pagination

## Overview

This feature implements a 10-slide scrolling/pagination window in the editor to prevent crashes and improve performance when working with large presentations.

## Problem

Large presentations with many slides can cause browser crashes due to:
- Excessive DOM elements for slide thumbnails
- Memory consumption from preloaded media (images, video thumbnails)
- Performance degradation during rendering and updates

## Solution

The editor now limits the number of slides loaded at any given time to a maximum of **10 slides**. This creates a "sliding window" that moves as you navigate through the presentation.

### Key Features

1. **10-Slide Window**: Only 10 slides are fully rendered in the timeline at once
2. **Automatic Window Adjustment**: The window automatically shifts when:
   - Navigating to slides outside the current window
   - Selecting slides via navigation buttons
   - Scrolling through the timeline
3. **Pagination Controls**: Visual indicators show:
   - Current window position (e.g., "Slides 1-10 of 50")
   - Quick navigation to first/last page
   - Page-by-page navigation
4. **Seamless Experience**: The pagination is transparent to users - they can still navigate to any slide, the window just shifts to accommodate

### Configuration

The window size is configurable via the `SLIDE_WINDOW_SIZE` constant in `app.js`:

```javascript
var SLIDE_WINDOW_SIZE = 10;  // Number of slides loaded at once
```

### How It Works

1. **Window Tracking**: The system tracks `windowStart` and `windowEnd` indices
2. **Smart Loading**: When navigating outside the window, it shifts to center on the target slide
3. **Memory Management**: Slides outside the window are represented by lightweight placeholders
4. **Navigation Preservation**: All navigation features (first, prev, next, last, direct selection) work seamlessly

### UI Changes

- Pagination indicator in the toolbar shows current window position
- Page navigation buttons allow jumping by window size
- Timeline displays placeholder blocks for slides outside the current window

### Benefits

- Prevents browser crashes with large presentations
- Improves editor responsiveness
- Reduces memory footprint
- Maintains full functionality for presentations of any size

## Implementation Status

- [x] Documentation
- [ ] Window tracking system
- [ ] Pagination UI controls
- [ ] Window shift logic on navigation
- [ ] Integration with existing slide operations

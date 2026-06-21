# Project Structure

```text
pathback-pwa/
├── index.html                  # Main app UI and tabs
├── styles.css                  # Complete responsive styling
├── app.js                      # Full tracking, drawing, storage, checkpoint, return logic
├── manifest.webmanifest        # PWA install metadata
├── service-worker.js           # Offline cache service worker
├── vercel.json                 # Vercel SPA rewrite and permissions policy headers
├── README.md                   # Setup, deploy, and usage guide
└── icons/
    ├── icon-192.svg            # PWA icon
    └── icon-512.svg            # PWA icon
```

## Main app modules inside app.js

```text
State Management
├── Local storage load/save
├── Sessions
├── Settings
├── Floors
├── Checkpoints

Sensor Layer
├── DeviceOrientationEvent heading
├── DeviceMotionEvent step detection
├── Geolocation anchor
├── Manual step fallback

Tracking Engine
├── Step to x/y coordinate conversion
├── Distance calculation
├── Floor-aware point storage
├── Checkpoint correction

Canvas Renderer
├── Grid
├── Floor map overlay
├── Breadcrumb path
├── Start/current/next markers
├── Heading arrow

Return Mode
├── Reverse breadcrumb loading
├── Next target point
├── Relative direction instruction
├── Distance to next point

PWA Layer
├── Manifest
├── Service worker
├── Install prompt
```

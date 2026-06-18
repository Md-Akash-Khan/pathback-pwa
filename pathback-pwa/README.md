# PathBack - Indoor Breadcrumb Tracker

PathBack is a privacy-first static PWA that records a user's own indoor walking path and helps them return to the starting point using the same breadcrumb trail.

It is designed for places like shopping malls, campuses, hospitals, fairs, parking zones, markets, and large buildings where normal map apps may not provide reliable indoor path routing.

## What is included

- Start, pause, stop, reset journey
- Live indoor breadcrumb path drawing on canvas
- Manual step button for browser/device fallback
- Device motion based step detection
- Device orientation based heading direction
- GPS starting anchor where available
- Floor selector and custom floor creation
- Floor map image overlay per floor
- Saved local sessions
- Return-to-start mode with next breadcrumb guidance
- Local checkpoint correction system
- QR/checkpoint scanning using browser BarcodeDetector where supported
- Manual checkpoint code fallback
- Export and import JSON backup
- PWA manifest and service worker
- Vercel-ready static deployment
- No backend and no external package dependency

## Important reality check

Indoor tracking from a web browser is not perfect. Phone sensors drift over time. This app solves that by combining:

1. Step-based dead reckoning
2. Heading/orientation data
3. Manual step fallback
4. Floor map overlay
5. Checkpoint correction
6. Return path replay

For a stronger commercial version, the next upgrades would be BLE beacons, Wi-Fi RTT, native Android/iOS sensor APIs, and building-specific calibrated indoor maps.

## How to run without local setup

### Option 1: Deploy directly on Vercel

1. Create a GitHub repository.
2. Upload all files from this folder.
3. Go to Vercel dashboard.
4. Click **Add New Project**.
5. Import your GitHub repository.
6. Keep framework preset as **Other** if Vercel asks.
7. Build command: leave empty.
8. Output directory: leave empty.
9. Deploy.

Because this is a static app, Vercel can serve it directly.

### Option 2: Run in StackBlitz or CodeSandbox

1. Create a vanilla/static web project.
2. Upload these files.
3. Open `index.html`.
4. For real sensor testing, open the preview on a mobile phone using HTTPS.

### Option 3: Run locally later

No Node setup is required. You can open `index.html` directly, but sensors, camera, and geolocation usually need HTTPS or localhost.

For a local test server later:

```bash
npx serve .
```

## Best testing method

1. Deploy to Vercel first.
2. Open the Vercel link on your phone.
3. Tap **Enable sensors**.
4. Tap **Start journey** near your start point.
5. Walk normally while keeping your phone roughly facing your walking direction.
6. Tap **Stop & save**.
7. Tap **Return to start**.
8. Follow the highlighted return breadcrumb.

## Checkpoint workflow

1. Go to a known real-world point, such as Main Entrance.
2. Tap **Save current point** in the Checkpoints tab.
3. Copy the checkpoint code.
4. Put that code into any QR generator and print it.
5. Place the QR at the real location.
6. During tracking, scan the QR to correct drift.

If QR scanning is not supported in the browser, use **Paste code**.

## Folder structure

```text
pathback-pwa/
├── index.html
├── styles.css
├── app.js
├── manifest.webmanifest
├── service-worker.js
├── vercel.json
├── README.md
└── icons/
    ├── icon-192.svg
    └── icon-512.svg
```

## Privacy

PathBack stores sessions, checkpoints, and floor maps in the user's browser storage only. There is no backend server, no account system, and no hidden tracking.

## Limitations

- Browser sensor support varies by phone and browser.
- iOS may require a user gesture before motion/orientation permission.
- QR scanning depends on the browser Barcode Detection API.
- Indoor route accuracy will drift without checkpoints.
- Floor detection is manual in this web version.

## Recommended future V2 native upgrade

If the app becomes serious, rebuild the tracking engine as a native Android/iOS app or Flutter app with:

- Native pedometer APIs
- Sensor fusion
- BLE beacon support
- Wi-Fi RTT support
- Indoor floor calibration
- AR arrows
- Cloud sync for maps/checkpoints

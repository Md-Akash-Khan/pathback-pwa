(() => {
  'use strict';

  const STORAGE_KEY = 'pathback.v1.data';
  const APP_VERSION = '2.0.3-immersive-map';
  const DEFAULT_FLOORS = ['Ground'];
  const $ = (id) => document.getElementById(id);

  const ui = {
    gpsStatus: $('gpsStatus'),
    sensorStatus: $('sensorStatus'),
    modeStatus: $('modeStatus'),
    floorLabel: $('floorLabel'),
    pathSummary: $('pathSummary'),
    pathCanvas: $('pathCanvas'),
    returnCanvas: $('returnCanvas'),
    requestPermissionBtn: $('requestPermissionBtn'),
    startBtn: $('startBtn'),
    pauseBtn: $('pauseBtn'),
    stopBtn: $('stopBtn'),
    resetBtn: $('resetBtn'),
    calibrateBtn: $('calibrateBtn'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomInBtn: $('zoomInBtn'),
    centerBtn: $('centerBtn'),
    floorInput: $('floorInput'),
    floorOptions: $('floorOptions'),
    floorMinusBtn: $('floorMinusBtn'),
    floorPlusBtn: $('floorPlusBtn'),
    floorChips: $('floorChips'),
    setMapBtn: $('setMapBtn'),
    mapUpload: $('mapUpload'),
    stepsStat: $('stepsStat'),
    distanceStat: $('distanceStat'),
    headingStat: $('headingStat'),
    durationStat: $('durationStat'),
    returnSummary: $('returnSummary'),
    startReturnBtn: $('startReturnBtn'),
    compassNeedle: $('compassNeedle'),
    guidanceTitle: $('guidanceTitle'),
    guidanceText: $('guidanceText'),
    prevTargetBtn: $('prevTargetBtn'),
    nextTargetBtn: $('nextTargetBtn'),
    stopReturnBtn: $('stopReturnBtn'),
    sessionsList: $('sessionsList'),
    exportBtn: $('exportBtn'),
    importBtn: $('importBtn'),
    importFile: $('importFile'),
    checkpointName: $('checkpointName'),
    addCheckpointBtn: $('addCheckpointBtn'),
    applyCheckpointBtn: $('applyCheckpointBtn'),
    scanCheckpointBtn: $('scanCheckpointBtn'),
    manualCheckpointBtn: $('manualCheckpointBtn'),
    scannerVideo: $('scannerVideo'),
    checkpointCodeBox: $('checkpointCodeBox'),
    checkpointList: $('checkpointList'),
    trackingProfileInput: $('trackingProfileInput'),
    viewModeInput: $('viewModeInput'),
    headingModeInput: $('headingModeInput'),
    mapDetailInput: $('mapDetailInput'),
    resetCalibrationBtn: $('resetCalibrationBtn'),
    saveSettingsBtn: $('saveSettingsBtn'),
    demoBtn: $('demoBtn'),
    clearMapsBtn: $('clearMapsBtn'),
    clearAllBtn: $('clearAllBtn'),
    compatText: $('compatText'),
    installBtn: $('installBtn'),
    toast: $('toast')
  };

  const state = {
    mode: 'idle',
    current: makePoint(0, 0, 'Ground'),
    currentSession: null,
    returnSession: null,
    returnPath: [],
    returnIndex: -1,
    heading: 0,
    rawHeading: 0,
    headingOrigin: null,
    lastDrawAt: 0,
    drawPending: false,
    gps: null,
    lastStepAt: 0,
    motionAverage: 9.81,
    zoom: 1,
    panX: 0,
    panY: 0,
    centerOnCurrent: false,
    timerId: null,
    watchId: null,
    scannerStream: null,
    deferredPrompt: null,
    animationId: null,
    lastRoutePointAt: 0,
    data: loadData(),
    floorImages: new Map()
  };

  function defaultData() {
    return {
      floors: DEFAULT_FLOORS,
      floorMaps: {},
      checkpoints: [],
      sessions: [],
      settings: {
        stepLength: 0.72,
        sensitivity: 1.1,
        minStepGap: 240,
        pixelsPerMeter: 18,
        trackingProfile: 'balanced',
        viewMode: 'fit',
        headingMode: 'normal',
        mapDetail: 'detailed',
        mapStyle: 'immersive3d'
      }
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      const merged = { ...defaultData(), ...parsed };
      merged.settings = { ...defaultData().settings, ...(parsed.settings || {}) };
      merged.floors = Array.isArray(merged.floors) && merged.floors.length ? merged.floors : DEFAULT_FLOORS;
      merged.floorMaps = merged.floorMaps || {};
      merged.checkpoints = Array.isArray(merged.checkpoints) ? merged.checkpoints : [];
      merged.sessions = Array.isArray(merged.sessions) ? merged.sessions : [];
      return merged;
    } catch (error) {
      console.warn('Failed to load local data', error);
      return defaultData();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    } catch (error) {
      toast('Storage is full. Try clearing old floor maps or sessions.');
      console.error(error);
    }
  }

  function makePoint(x, y, floor, extra = {}) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      x,
      y,
      floor,
      heading: 0,
      ts: Date.now(),
      ...extra
    };
  }

  function meters(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(total / 60).toString().padStart(2, '0');
    const secs = (total % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function setStatus(el, text, cls = 'muted') {
    el.className = `status-pill ${cls}`.trim();
    el.textContent = text;
  }

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ui.toast.classList.remove('show'), 3200);
  }

  function getActiveFloor() {
    const typed = (ui.floorInput?.value || '').trim();
    return typed || state.current.floor || state.data.floors[0] || 'Ground';
  }

  function normalizeFloorName(value) {
    const clean = String(value || '').trim();
    if (!clean) return 'Ground';
    if (/^g(round)?$/i.test(clean)) return 'Ground';
    const levelMatch = clean.match(/^(level|floor|l)\s*(-?\d+)$/i);
    if (levelMatch) return Number(levelMatch[2]) <= 0 ? 'Ground' : `Level ${Number(levelMatch[2])}`;
    return clean.replace(/\s+/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
  }

  function floorNumber(name) {
    if (/^ground$/i.test(name)) return 0;
    const match = String(name).match(/-?\d+/);
    return match ? Number(match[0]) : 0;
  }

  function ensureFloor(name, switchTo = true) {
    const clean = normalizeFloorName(name);
    if (!state.data.floors.includes(clean)) state.data.floors.push(clean);
    state.data.floors.sort((a, b) => floorNumber(a) - floorNumber(b) || a.localeCompare(b));
    if (switchTo) setCurrentFloor(clean, false);
    saveData();
    renderFloors();
    return clean;
  }

  function setCurrentFloor(name, save = true) {
    const clean = normalizeFloorName(name);
    state.current.floor = clean;
    if (ui.floorInput) ui.floorInput.value = clean;
    if (state.mode === 'recording' && state.currentSession) {
      if (!state.currentSession.floors.includes(clean)) state.currentSession.floors.push(clean);
      const last = state.currentSession.points[state.currentSession.points.length - 1];
      if (!last || last.floor !== clean) {
        state.currentSession.points.push(makePoint(state.current.x, state.current.y, clean, { heading: state.heading, floorChange: true }));
      }
    }
    if (save) ensureFloor(clean, false);
    renderStats();
    drawAll();
  }

  function renderFloors() {
    if (ui.floorOptions) {
      ui.floorOptions.innerHTML = '';
      state.data.floors.forEach((floor) => {
        const opt = document.createElement('option');
        opt.value = floor;
        ui.floorOptions.appendChild(opt);
      });
    }
    if (!state.data.floors.includes(state.current.floor)) state.current.floor = state.data.floors[0] || 'Ground';
    if (ui.floorInput) ui.floorInput.value = state.current.floor;
    if (ui.floorLabel) ui.floorLabel.textContent = `Floor: ${state.current.floor}`;
    if (ui.floorChips) {
      ui.floorChips.innerHTML = '';
      state.data.floors.forEach((floor) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `floor-chip${floor === state.current.floor ? ' active' : ''}`;
        chip.textContent = floor;
        chip.addEventListener('click', () => setCurrentFloor(floor));
        ui.floorChips.appendChild(chip);
      });
    }
  }

  function renderStats() {
    const session = state.currentSession;
    const steps = session ? session.steps : 0;
    const distance = session ? session.distance : 0;
    const duration = session ? Date.now() - session.startedAt : 0;
    ui.stepsStat.textContent = steps.toString();
    ui.distanceStat.textContent = `${distance.toFixed(1)} m`;
    ui.headingStat.textContent = `${Math.round(state.heading)}°`;
    ui.durationStat.textContent = formatTime(duration);
    ui.pathSummary.textContent = `${steps} steps • ${distance.toFixed(1)} m • ${session?.points?.length || 0} points`;
    ui.floorLabel.textContent = `Floor: ${state.current.floor}`;

    const modeText = {
      idle: 'Ready',
      recording: 'Recording',
      paused: 'Paused',
      returning: 'Returning'
    }[state.mode] || 'Ready';
    const modeClass = state.mode === 'recording' ? 'good' : state.mode === 'returning' ? 'warn' : state.mode === 'paused' ? 'warn' : '';
    setStatus(ui.modeStatus, modeText, modeClass);
  }

  function getProfileSettings() {
    const profile = state.data.settings.trackingProfile || 'balanced';
    const map = {
      responsive: { stepLength: 0.74, sensitivity: 0.58, minStepGap: 135 },
      balanced: { stepLength: 0.72, sensitivity: 0.74, minStepGap: 165 },
      stable: { stepLength: 0.70, sensitivity: 0.96, minStepGap: 230 }
    };
    return map[profile] || map.balanced;
  }

  function renderSettings() {
    const s = state.data.settings;
    if (ui.trackingProfileInput) ui.trackingProfileInput.value = s.trackingProfile || 'balanced';
    if (ui.viewModeInput) ui.viewModeInput.value = s.viewMode || 'fit';
    if (ui.headingModeInput) ui.headingModeInput.value = s.headingMode || 'normal';
    if (ui.mapDetailInput) ui.mapDetailInput.value = s.mapDetail || 'detailed';
  }

  function readSettingsFromInputs() {
    const s = state.data.settings;
    if (ui.trackingProfileInput) s.trackingProfile = ui.trackingProfileInput.value;
    if (ui.viewModeInput) s.viewMode = ui.viewModeInput.value;
    if (ui.headingModeInput) s.headingMode = ui.headingModeInput.value;
    if (ui.mapDetailInput) s.mapDetail = ui.mapDetailInput.value;
    renderSettings();
    drawAll();
  }

  function calibrateHeading() {
    state.headingOrigin = state.rawHeading || 0;
    state.heading = 0;
    renderStats();
    drawAll();
    toast('Heading calibrated. Keep the phone facing your walking direction.');
  }

  function startJourney() {
    if (state.mode === 'recording') return;
    const floor = ensureFloor(getActiveFloor());
    state.headingOrigin = state.rawHeading || 0;
    state.heading = 0;
    state.current = makePoint(0, 0, floor, { heading: state.heading });
    state.currentSession = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title: `Journey ${new Date().toLocaleString()}`,
      startedAt: Date.now(),
      endedAt: null,
      startGps: state.gps,
      steps: 0,
      distance: 0,
      floors: [floor],
      points: [state.current]
    };
    state.mode = 'recording';
    setStatus(ui.modeStatus, 'Recording', 'good');
    requestGps();
    startTimer();
    toast('Journey started. Walk normally and keep phone facing your direction.');
    renderStats();
    drawAll();
  }

  function pauseJourney() {
    if (state.mode === 'recording') {
      state.mode = 'paused';
      toast('Journey paused.');
    } else if (state.mode === 'paused') {
      state.mode = 'recording';
      toast('Journey resumed.');
    }
    renderStats();
  }

  function stopJourney() {
    if (!state.currentSession) {
      toast('No active journey to save.');
      return;
    }
    state.currentSession.endedAt = Date.now();
    const title = prompt('Session title:', state.currentSession.title) || state.currentSession.title;
    state.currentSession.title = title.trim() || state.currentSession.title;
    state.data.sessions.unshift(state.currentSession);
    state.data.sessions = state.data.sessions.slice(0, 80);
    saveData();
    state.mode = 'idle';
    state.currentSession = null;
    renderSessions();
    renderStats();
    drawAll();
    toast('Journey saved locally.');
  }

  function resetCurrent() {
    if (!confirm('Reset current unsaved journey? Saved sessions will remain.')) return;
    state.mode = 'idle';
    state.currentSession = null;
    state.returnSession = null;
    state.returnPath = [];
    state.returnIndex = -1;
    state.current = makePoint(0, 0, getActiveFloor());
    renderStats();
    drawAll();
    toast('Current journey reset.');
  }

  function onStep(source = 'sensor') {
    const now = Date.now();
    const profile = getProfileSettings();
    if (source === 'sensor' && now - state.lastStepAt < profile.minStepGap) return;
    state.lastStepAt = now;

    const step = profile.stepLength;
    const rad = (state.heading * Math.PI) / 180;
    state.current = makePoint(
      state.current.x + Math.sin(rad) * step,
      state.current.y - Math.cos(rad) * step,
      state.current.floor,
      { heading: state.heading }
    );

    if (state.mode === 'recording' && state.currentSession) {
      state.currentSession.steps += 1;
      state.currentSession.distance += step;
      if (!state.currentSession.floors.includes(state.current.floor)) state.currentSession.floors.push(state.current.floor);
      state.currentSession.points.push(state.current);
    }

    if (state.mode === 'returning') updateReturnTarget();

    renderStats();
    drawAll();
  }

  async function requestSensorPermission() {
    let orientationGranted = true;
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const result = await DeviceOrientationEvent.requestPermission();
        orientationGranted = result === 'granted';
      }
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        await DeviceMotionEvent.requestPermission();
      }
    } catch (error) {
      orientationGranted = false;
      console.warn(error);
    }

    if (orientationGranted) {
      bindSensors();
      setStatus(ui.sensorStatus, 'Sensors active', 'good');
      toast('Sensors enabled.');
    } else {
      setStatus(ui.sensorStatus, 'Sensor blocked', 'bad');
      toast('Sensor permission was blocked. Try Chrome on mobile, then enable motion/location permissions.');
    }
  }

  let sensorsBound = false;
  function bindSensors() {
    if (sensorsBound) return;
    sensorsBound = true;

    window.addEventListener('deviceorientation', (event) => {
      const heading = extractHeading(event);
      if (typeof heading === 'number' && Number.isFinite(heading)) {
        state.rawHeading = smoothAngle(state.rawHeading, heading, 0.28);
        if (state.headingOrigin === null) state.headingOrigin = state.rawHeading;
        state.heading = normalize360(state.rawHeading - state.headingOrigin);
        ui.headingStat.textContent = `${Math.round(state.heading)}°`;
        updateReturnTarget();
        drawAll();
      }
    }, true);

    window.addEventListener('devicemotion', (event) => {
      if (state.mode !== 'recording' && state.mode !== 'returning') return;
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;
      const x = acc.x || 0;
      const y = acc.y || 0;
      const z = acc.z || 0;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      state.motionAverage = state.motionAverage * 0.88 + magnitude * 0.12;
      const delta = Math.abs(magnitude - state.motionAverage);
      const profile = getProfileSettings();
      if (delta > profile.sensitivity) onStep('sensor');
    }, true);
  }

  function extractHeading(event) {
    const webkitHeading = event.webkitCompassHeading;
    let raw = null;
    if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
      raw = webkitHeading;
    } else if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
      raw = 360 - event.alpha;
    }
    if (raw === null) return null;
    raw = normalize360(raw);
    if ((state.data.settings.headingMode || 'normal') === 'mirrored') raw = normalize360(360 - raw);
    return raw;
  }

  function normalize360(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function smoothAngle(previous, next, factor) {
    if (!Number.isFinite(previous)) return next;
    const diff = ((next - previous + 540) % 360) - 180;
    return normalize360(previous + diff * factor);
  }

  function requestGps() {
    if (!('geolocation' in navigator)) {
      setStatus(ui.gpsStatus, 'GPS unavailable', 'bad');
      return;
    }
    setStatus(ui.gpsStatus, 'GPS requesting', 'warn');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.gps = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: Date.now()
        };
        setStatus(ui.gpsStatus, `GPS ±${Math.round(pos.coords.accuracy)}m`, 'good');
        if (state.currentSession && !state.currentSession.startGps) state.currentSession.startGps = state.gps;
      },
      () => setStatus(ui.gpsStatus, 'GPS blocked', 'bad'),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 }
    );
  }

  function startTimer() {
    clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      renderStats();
      if (state.mode === 'returning') updateReturnTarget();
    }, 1000);
  }

  function drawAll() {
    if (state.drawPending) return;
    state.drawPending = true;
    requestAnimationFrame(() => {
      state.drawPending = false;
      drawMap(ui.pathCanvas, state.currentSession || state.returnSession, false);
      drawMap(ui.returnCanvas, state.returnSession || state.currentSession, true);
    });
  }

  function getFloorImage(floor) {
    const src = state.data.floorMaps[floor];
    if (!src) return null;
    if (state.floorImages.has(src)) return state.floorImages.get(src);
    const img = new Image();
    img.src = src;
    img.onload = drawAll;
    state.floorImages.set(src, img);
    return img;
  }

  function drawMap(canvas, session, isReturn) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(Math.max(rect.height, canvas.dataset.mobileReturn === 'true' ? 360 : 420) * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = width / dpr;
    const h = height / dpr;
    ctx.clearRect(0, 0, w, h);

    const floor = state.current.floor || getActiveFloor();
    const sessionPoints = (session?.points || []).filter((p) => p.floor === floor);
    const routePoints = isReturn && state.returnPath?.length
      ? state.returnPath.filter((p) => p.floor === floor)
      : sessionPoints;
    const viewportPoints = [...routePoints, state.current].filter(Boolean);
    const viewport = computeViewport(w, h, viewportPoints);
    const { origin, scale } = viewport;

    drawScene(ctx, w, h, floor, origin, scale);
    drawCheckpoints(ctx, floor, origin, scale);

    if (isReturn && sessionPoints.length > 1) {
      drawRoute(ctx, sessionPoints, origin, scale, 'rgba(96, 165, 250, 0.22)', 3, false);
    }

    if (routePoints.length > 1) {
      drawRoute(ctx, routePoints, origin, scale, isReturn ? 'rgba(249, 115, 22, 0.98)' : 'rgba(96, 165, 250, 0.98)', isReturn ? 6 : 5, true);
      drawRouteArrows(ctx, routePoints, origin, scale, isReturn ? '#fed7aa' : '#dbeafe');
    }

    if (session?.points?.length) {
      const start = session.points[0];
      if (start.floor === floor) drawPin(ctx, worldToScreen(start, origin, scale), '#22c55e', 'START');
    }

    if (state.current.floor === floor) {
      drawHeading(ctx, state.current, origin, scale);
      drawPin(ctx, worldToScreen(state.current, origin, scale), '#60a5fa', 'YOU');
    }

    if (isReturn && state.returnPath?.length && state.returnIndex >= 0) {
      const target = state.returnPath[state.returnIndex];
      if (target?.floor === floor) {
        drawPin(ctx, worldToScreen(target, origin, scale), '#f97316', 'NEXT');
        const from = worldToScreen(state.current, origin, scale);
        const to = worldToScreen(target, origin, scale);
        ctx.save();
        ctx.strokeStyle = 'rgba(249,115,22,0.62)';
        ctx.lineWidth = 2;
        ctx.setLineDash([9, 9]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawFloorBadge(ctx, w, h, floor, viewport);
  }

  function computeViewport(w, h, points) {
    const base = state.data.settings.pixelsPerMeter * state.zoom;
    const useFollow = (state.data.settings.viewMode === 'follow');
    if (useFollow || points.length < 2) {
      return {
        scale: base,
        origin: {
          x: w / 2 - state.current.x * base + state.panX,
          y: h / 2 - state.current.y * base + state.panY
        },
        fitted: false
      };
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = Math.max(6, maxX - minX);
    const rangeY = Math.max(6, maxY - minY);
    const pad = Math.min(150, Math.max(56, w * 0.11));
    const availableW = Math.max(220, w - pad * 2);
    const availableH = Math.max(220, h - pad * 2);
    const fitScale = Math.min(availableW / rangeX, availableH / rangeY, base);
    const scale = Math.max(8, fitScale);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
      scale,
      origin: { x: w / 2 - cx * scale + state.panX, y: h / 2 - cy * scale + state.panY },
      fitted: true
    };
  }

  function drawScene(ctx, w, h, floor, origin, scale) {
    const t = performance.now() / 1000;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#051421');
    bg.addColorStop(0.45, '#0b2036');
    bg.addColorStop(1, '#07111f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    drawAmbientOrbs(ctx, w, h, t);
    drawHologramFloor(ctx, w, h, floor, t);

    const img = getFloorImage(floor);
    if (img && img.complete) drawFloorImage(ctx, img, origin, scale);

    if ((state.data.settings.mapDetail || 'detailed') === 'detailed') {
      drawPerspectiveGlow(ctx, w, h, t);
      drawCyberGrid(ctx, w, h, origin, scale, t);
      drawDepthRulers(ctx, w, h, origin, scale, t);
      drawFloorPlate(ctx, w, h, floor);
    } else {
      drawMeterGrid(ctx, w, h, origin, scale, true);
    }
  }

  function drawAmbientOrbs(ctx, w, h, t) {
    ctx.save();
    const orb = ctx.createRadialGradient(w * 0.18, h * 0.28, 0, w * 0.18, h * 0.28, Math.max(w, h) * 0.55);
    orb.addColorStop(0, 'rgba(14,165,233,0.16)');
    orb.addColorStop(0.5, 'rgba(34,197,94,0.045)');
    orb.addColorStop(1, 'rgba(2,6,23,0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, w, h);
    const orb2 = ctx.createRadialGradient(w * (0.72 + Math.sin(t * .35) * .03), h * 0.62, 0, w * 0.72, h * 0.62, Math.max(w, h) * 0.44);
    orb2.addColorStop(0, 'rgba(96,165,250,0.10)');
    orb2.addColorStop(1, 'rgba(2,6,23,0)');
    ctx.fillStyle = orb2;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawHologramFloor(ctx, w, h, floor, t) {
    const margin = Math.max(22, Math.min(58, w * 0.04));
    const top = Math.max(20, h * 0.05);
    const bottom = h - Math.max(22, h * 0.08);
    const skew = Math.min(86, w * 0.075);

    ctx.save();
    ctx.shadowColor = 'rgba(14,165,233,0.22)';
    ctx.shadowBlur = 38;
    const plate = ctx.createLinearGradient(0, top, 0, bottom);
    plate.addColorStop(0, 'rgba(8, 47, 73, 0.22)');
    plate.addColorStop(0.55, 'rgba(14, 116, 144, 0.08)');
    plate.addColorStop(1, 'rgba(15, 23, 42, 0.42)');
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.moveTo(margin + skew, top);
    ctx.lineTo(w - margin, top);
    ctx.lineTo(w - margin - skew, bottom);
    ctx.lineTo(margin, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(125, 211, 252, 0.20)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Subtle animated scan band like a live indoor map surface.
    const y = top + ((t * 54) % Math.max(1, bottom - top));
    const scan = ctx.createLinearGradient(0, y - 30, 0, y + 30);
    scan.addColorStop(0, 'rgba(14,165,233,0)');
    scan.addColorStop(0.5, 'rgba(96,165,250,0.12)');
    scan.addColorStop(1, 'rgba(14,165,233,0)');
    ctx.fillStyle = scan;
    ctx.beginPath();
    ctx.moveTo(margin + skew, Math.max(top, y - 30));
    ctx.lineTo(w - margin, Math.max(top, y - 30));
    ctx.lineTo(w - margin - skew, Math.min(bottom, y + 30));
    ctx.lineTo(margin, Math.min(bottom, y + 30));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFloorImage(ctx, img, origin, scale) {
    const mapWidthM = 86;
    const imgW = mapWidthM * scale;
    const imgH = img.height ? imgW * (img.height / img.width) : imgW * 0.65;
    ctx.save();
    ctx.globalAlpha = 0.48;
    ctx.shadowColor = 'rgba(96,165,250,.35)';
    ctx.shadowBlur = 22;
    ctx.drawImage(img, origin.x - imgW / 2, origin.y - imgH / 2, imgW, imgH);
    ctx.restore();
  }

  function drawPerspectiveGlow(ctx, w, h, t) {
    const glow = ctx.createRadialGradient(w * 0.52, h * 0.48, 0, w * 0.52, h * 0.48, Math.max(w, h) * 0.66);
    glow.addColorStop(0, 'rgba(96,165,250,0.12)');
    glow.addColorStop(0.48, 'rgba(14,165,233,0.035)');
    glow.addColorStop(1, 'rgba(2,6,23,0.48)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  function drawCyberGrid(ctx, w, h, origin, scale, t) {
    ctx.save();
    const meterStep = scale < 12 ? 5 : scale < 24 ? 2 : 1;
    const step = meterStep * scale;
    const startX = ((origin.x % step) + step) % step;
    const startY = ((origin.y % step) + step) % step;

    for (let x = startX; x < w; x += step) {
      const worldX = Math.round((x - origin.x) / scale);
      const alpha = worldX % 10 === 0 ? 0.22 : 0.075;
      ctx.strokeStyle = `rgba(96,165,250,${alpha})`;
      ctx.lineWidth = worldX % 10 === 0 ? 1.15 : 0.65;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - h * 0.18, h);
      ctx.stroke();
    }

    for (let y = startY; y < h; y += step) {
      const worldY = Math.round((y - origin.y) / scale);
      const alpha = worldY % 10 === 0 ? 0.22 : 0.07;
      ctx.strokeStyle = `rgba(45,212,191,${alpha})`;
      ctx.lineWidth = worldY % 10 === 0 ? 1.15 : 0.65;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y - w * 0.05);
      ctx.stroke();
    }

    // Animated digital nodes. Deterministic pattern so it feels like a live map, not random noise.
    ctx.fillStyle = 'rgba(125,211,252,0.42)';
    for (let i = 0; i < 48; i += 1) {
      const x = ((i * 137 + t * 18) % (w + 120)) - 60;
      const y = ((i * 83 + Math.sin(t + i) * 8) % (h + 80)) - 40;
      const r = 0.8 + ((i % 5) * 0.24);
      ctx.globalAlpha = 0.2 + ((i % 7) / 18);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawDepthRulers(ctx, w, h, origin, scale, t) {
    ctx.save();
    const midX = origin.x;
    const midY = origin.y;
    ctx.strokeStyle = 'rgba(191,219,254,0.20)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, h);
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Soft sonar ring centered at the user.
    if (state.current) {
      const user = worldToScreen(state.current, origin, scale);
      for (let i = 0; i < 3; i += 1) {
        const radius = 22 + ((t * 42 + i * 34) % 100);
        ctx.strokeStyle = `rgba(96,165,250,${0.18 - i * 0.04})`;
        ctx.beginPath();
        ctx.arc(user.x, user.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawMeterGrid(ctx, w, h, origin, scale, clean = false) {
    ctx.save();
    const meterStep = scale < 12 ? 5 : scale < 24 ? 2 : 1;
    const step = meterStep * scale;
    const startX = ((origin.x % step) + step) % step;
    const startY = ((origin.y % step) + step) % step;
    ctx.lineWidth = 1;
    for (let x = startX; x < w; x += step) {
      const worldX = Math.round((x - origin.x) / scale);
      ctx.strokeStyle = worldX % 10 === 0 ? 'rgba(96,165,250,0.13)' : 'rgba(148,163,184,0.055)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = startY; y < h; y += step) {
      const worldY = Math.round((y - origin.y) / scale);
      ctx.strokeStyle = worldY % 10 === 0 ? 'rgba(96,165,250,0.13)' : 'rgba(148,163,184,0.055)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    if (!clean) {
      ctx.strokeStyle = 'rgba(34,197,94,0.07)';
      for (let x = -h; x < w + h; x += 86) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + h * 0.7, 0);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFloorPlate(ctx, w, h, floor) {
    ctx.save();
    const x = Math.max(16, w - 184);
    const y = Math.max(16, h - 88);
    ctx.shadowColor = 'rgba(96,165,250,0.22)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.64)';
    ctx.strokeStyle = 'rgba(96,165,250,0.28)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, 158, 56, 18);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#dbeafe';
    ctx.font = '900 12px Inter, sans-serif';
    ctx.fillText('Active floor', x + 18, y + 22);
    ctx.fillStyle = '#60a5fa';
    ctx.font = '950 18px Inter, sans-serif';
    ctx.fillText(String(floor).slice(0, 16), x + 18, y + 44);
    ctx.restore();
  }

  function drawRoute(ctx, points, origin, scale, color, width, glow) {
    if (points.length < 2) return;
    ctx.save();
    // raised route shadow for the 3D map feel
    ctx.strokeStyle = 'rgba(0,0,0,0.40)';
    ctx.lineWidth = width + 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, idx) => {
      const pt = worldToScreen(p, origin, scale);
      if (idx === 0) ctx.moveTo(pt.x + 7, pt.y + 10);
      else ctx.lineTo(pt.x + 7, pt.y + 10);
    });
    ctx.stroke();

    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 22;
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.beginPath();
    points.forEach((p, idx) => {
      const pt = worldToScreen(p, origin, scale);
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, width - 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.52)';
    ctx.stroke();
    ctx.restore();
  }

  function drawRouteArrows(ctx, points, origin, scale, color) {
    if (points.length < 3) return;
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 1; i < points.length; i += Math.max(2, Math.floor(points.length / 10))) {
      const a = worldToScreen(points[i - 1], origin, scale);
      const b = worldToScreen(points[i], origin, scale);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 16) continue;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCheckpoints(ctx, floor, origin, scale) {
    state.data.checkpoints.filter((c) => c.floor === floor).forEach((c) => {
      const pt = worldToScreen(c, origin, scale);
      drawCheckpointMarker(ctx, pt, c.name);
    });
  }

  function drawCheckpointMarker(ctx, pt, name) {
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowColor = 'rgba(245, 158, 11, 0.9)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y + 20);
    ctx.bezierCurveTo(pt.x - 16, pt.y + 2, pt.x - 13, pt.y - 20, pt.x, pt.y - 20);
    ctx.bezierCurveTo(pt.x + 13, pt.y - 20, pt.x + 16, pt.y + 2, pt.x, pt.y + 20);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y - 4, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef3c7';
    ctx.font = '900 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◆', pt.x, pt.y);
    ctx.textAlign = 'left';
    const label = String(name || 'Checkpoint').slice(0, 24);
    ctx.font = '850 12px Inter, sans-serif';
    const labelW = Math.min(186, ctx.measureText(label).width + 24);
    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    ctx.strokeStyle = 'rgba(245,158,11,0.42)';
    roundRect(ctx, pt.x + 18, pt.y - 28, labelW, 30, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fef3c7';
    ctx.fillText(label, pt.x + 30, pt.y - 9);
    ctx.restore();
  }

  function drawPin(ctx, pt, color, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(pt.x + 8, pt.y + 13, 17, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.82)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
    ctx.font = '950 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, pt.x, pt.y - 20);
    ctx.restore();
  }

  function drawHeading(ctx, point, origin, scale) {
    const pt = worldToScreen(point, origin, scale);
    const rad = (state.heading * Math.PI) / 180;
    const end = { x: pt.x + Math.sin(rad) * 48, y: pt.y - Math.cos(rad) * 48 };
    ctx.save();
    ctx.strokeStyle = 'rgba(191, 219, 254, 0.94)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(96,165,250,.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.fillStyle = '#bfdbfe';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFloorBadge(ctx, w, h, floor, viewport) {
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.64)';
    ctx.strokeStyle = 'rgba(148,163,184,0.20)';
    roundRect(ctx, 16, h - 60, 202, 42, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '850 12px Inter, sans-serif';
    ctx.fillText(`${floor} • ${viewport.fitted ? 'auto-fit full route' : 'live follow'}`, 30, h - 34);
    ctx.restore();
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function worldToScreen(p, origin, scale) {
    return { x: origin.x + p.x * scale, y: origin.y + p.y * scale };
  }

  function renderSessions() {
    ui.sessionsList.innerHTML = '';
    if (!state.data.sessions.length) {
      ui.sessionsList.innerHTML = '<div class="notice">No saved sessions yet. Start a journey and save it here.</div>';
      return;
    }

    state.data.sessions.forEach((session) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const duration = session.endedAt ? formatTime(session.endedAt - session.startedAt) : 'Unsaved';
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(session.title)}</strong>
          <small>${new Date(session.startedAt).toLocaleString()} • ${session.steps} steps • ${session.distance.toFixed(1)} m • ${duration}<br>${session.floors.join(', ')}</small>
        </div>
        <div class="list-actions">
          <button class="ghost" data-action="view" data-id="${session.id}">View</button>
          <button class="primary" data-action="return" data-id="${session.id}">Return</button>
          <button class="danger" data-action="delete" data-id="${session.id}">Delete</button>
        </div>`;
      ui.sessionsList.appendChild(item);
    });
  }

  function renderCheckpoints() {
    ui.checkpointList.innerHTML = '';
    if (!state.data.checkpoints.length) {
      ui.checkpointList.innerHTML = '<div class="notice">No checkpoints yet. Save your current point as a known indoor landmark.</div>';
      return;
    }
    state.data.checkpoints.forEach((c) => {
      const code = encodeCheckpoint(c);
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <small>${c.floor} • x ${c.x.toFixed(1)}m • y ${c.y.toFixed(1)}m</small>
        </div>
        <div class="list-actions">
          <button class="success" data-action="apply-cp" data-id="${c.id}">Apply</button>
          <button class="ghost" data-action="copy-cp" data-id="${c.id}">Copy code</button>
          <button class="danger" data-action="delete-cp" data-id="${c.id}">Delete</button>
        </div>`;
      item.dataset.code = code;
      ui.checkpointList.appendChild(item);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function addCheckpoint() {
    const name = ui.checkpointName.value.trim() || `Checkpoint ${state.data.checkpoints.length + 1}`;
    const cp = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      x: state.current.x,
      y: state.current.y,
      floor: state.current.floor,
      ts: Date.now()
    };
    state.data.checkpoints.unshift(cp);
    saveData();
    ui.checkpointName.value = '';
    renderCheckpoints();
    drawAll();
    showCheckpointCode(cp);
    toast('Checkpoint saved.');
  }

  function encodeCheckpoint(cp) {
    return btoa(unescape(encodeURIComponent(JSON.stringify({ type: 'pathback-checkpoint', ...cp }))));
  }

  function decodeCheckpoint(code) {
    const trimmed = String(code || '').trim();
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(trimmed))));
      if (parsed.type !== 'pathback-checkpoint') throw new Error('Invalid checkpoint type');
      return parsed;
    } catch (error) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type !== 'pathback-checkpoint') throw new Error('Invalid checkpoint type');
        return parsed;
      } catch (_) {
        throw error;
      }
    }
  }

  function showCheckpointCode(cp) {
    const code = encodeCheckpoint(cp);
    ui.checkpointCodeBox.classList.remove('hidden');
    ui.checkpointCodeBox.innerHTML = `<strong>Checkpoint code:</strong><br>${code}<br><br>Copy this into any QR generator, print it, and place it at that real-world point.`;
  }

  function applyCheckpoint(cp) {
    state.current = makePoint(cp.x, cp.y, cp.floor, { heading: state.heading });
    if (state.mode === 'recording' && state.currentSession) {
      state.currentSession.points.push({ ...state.current, correctedBy: cp.name });
      if (!state.currentSession.floors.includes(cp.floor)) state.currentSession.floors.push(cp.floor);
    }
    setCurrentFloor(cp.floor, false);
    renderFloors();
    updateReturnTarget();
    drawAll();
    toast(`Corrected position to ${cp.name}.`);
  }

  function startReturnWithSession(session) {
    if (!session || !session.points?.length) {
      toast('No path available for return mode.');
      return;
    }
    state.returnSession = JSON.parse(JSON.stringify(session));
    state.returnPath = buildReturnPath(state.returnSession.points);
    state.current = { ...state.returnPath[0] };
    state.returnIndex = Math.min(1, state.returnPath.length - 1);
    state.mode = 'returning';
    state.currentSession = null;
    state.headingOrigin = state.rawHeading || state.headingOrigin || 0;
    setCurrentFloor(state.current.floor, false);
    renderFloors();
    startTimer();
    activateTab('return');
    updateReturnTarget();
    drawAll();
    toast('Return mode started. Follow the orange route and checkpoint markers.');
  }

  function buildReturnPath(points) {
    const reversed = [...points].reverse();
    if (reversed.length <= 2) return reversed;
    const simplified = [reversed[0]];
    for (let i = 1; i < reversed.length - 1; i += 1) {
      const last = simplified[simplified.length - 1];
      const current = reversed[i];
      const next = reversed[i + 1];
      const floorChanged = current.floor !== last.floor || current.floor !== next.floor;
      const turned = Math.abs(normalizeAngle((current.heading || 0) - (last.heading || 0))) > 28;
      if (floorChanged || turned || meters(last, current) >= 1.6 || current.correctedBy || current.floorChange) {
        simplified.push(current);
      }
    }
    simplified.push(reversed[reversed.length - 1]);
    return simplified;
  }

  function updateReturnTarget() {
    if (state.mode !== 'returning' || !state.returnSession || !state.returnPath.length) return;
    const target = state.returnPath[state.returnIndex];
    if (!target) {
      ui.guidanceTitle.textContent = 'You are back near the start';
      ui.guidanceText.textContent = 'Return path completed.';
      ui.returnSummary.textContent = 'Completed';
      ui.compassNeedle.style.transform = 'rotate(0deg)';
      drawAll();
      return;
    }

    const d = meters(state.current, target);
    if (d < 1.4 && state.returnIndex < state.returnPath.length - 1) {
      state.returnIndex += 1;
      updateReturnTarget();
      return;
    }
    if (d < 1.4 && state.returnIndex >= state.returnPath.length - 1) {
      ui.guidanceTitle.textContent = 'You are near the start';
      ui.guidanceText.textContent = 'Look around for your entrance or starting landmark.';
      ui.returnSummary.textContent = 'Near start point';
      ui.compassNeedle.style.transform = 'rotate(0deg)';
      drawAll();
      return;
    }

    if (target.floor !== state.current.floor) {
      ui.guidanceTitle.textContent = `Switch to ${target.floor}`;
      ui.guidanceText.textContent = `Your next breadcrumb is on ${target.floor}. Change floor first, then continue.`;
      ui.returnSummary.textContent = `${Math.round(d)} m to next point • floor change needed`;
      drawAll();
      return;
    }

    const bearing = bearingBetween(state.current, target);
    const relative = normalizeAngle(bearing - state.heading);
    ui.compassNeedle.style.transform = `rotate(${relative}deg)`;
    const turn = relativeInstruction(relative);
    const remaining = returnDistanceRemaining();
    ui.guidanceTitle.textContent = `${turn} • ${d.toFixed(1)} m`;
    ui.guidanceText.textContent = `Next breadcrumb ${state.returnIndex} of ${state.returnPath.length - 1}. Estimated ${remaining.toFixed(1)} m remaining.`;
    ui.returnSummary.textContent = `${remaining.toFixed(1)} m remaining • target ${state.returnIndex}/${state.returnPath.length - 1}`;
    drawAll();
  }

  function returnDistanceRemaining() {
    if (!state.returnPath?.length || state.returnIndex < 0) return 0;
    let total = meters(state.current, state.returnPath[state.returnIndex] || state.current);
    for (let i = state.returnIndex + 1; i < state.returnPath.length; i += 1) {
      total += meters(state.returnPath[i - 1], state.returnPath[i]);
    }
    return total;
  }

  function bearingBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rad = Math.atan2(dx, -dy);
    return (rad * 180 / Math.PI + 360) % 360;
  }

  function normalizeAngle(angle) {
    return ((angle + 540) % 360) - 180;
  }

  function relativeInstruction(angle) {
    const abs = Math.abs(angle);
    if (abs < 18) return 'Go straight';
    if (abs < 65) return angle > 0 ? 'Slight right' : 'Slight left';
    if (abs < 130) return angle > 0 ? 'Turn right' : 'Turn left';
    return 'Turn back';
  }

  async function handleMapUpload(file) {
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 1600);
      state.data.floorMaps[getActiveFloor()] = dataUrl;
      saveData();
      state.floorImages.clear();
      drawAll();
      toast('Floor map added.');
    } catch (error) {
      console.error(error);
      toast('Could not save this image. Try a smaller map image.');
    }
  }

  function resizeImage(file, maxSize) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function scanCheckpoint() {
    if (!('BarcodeDetector' in window)) {
      toast('BarcodeDetector is not supported in this browser. Use Paste code instead.');
      return;
    }
    try {
      if (!state.scannerStream) {
        state.scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        ui.scannerVideo.srcObject = state.scannerStream;
        ui.scannerVideo.classList.remove('hidden');
        await ui.scannerVideo.play();
      }
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => {
        if (!state.scannerStream) return;
        const codes = await detector.detect(ui.scannerVideo);
        if (codes.length) {
          stopScanner();
          try {
            const cp = decodeCheckpoint(codes[0].rawValue);
            applyScannedCheckpoint(cp);
          } catch (error) {
            toast('QR found, but it is not a valid PathBack checkpoint.');
          }
          return;
        }
        requestAnimationFrame(loop);
      };
      loop();
      toast('Scanner started. Point camera at a checkpoint QR.');
    } catch (error) {
      console.error(error);
      toast('Camera permission blocked or unavailable. Use Paste code instead.');
    }
  }

  function stopScanner() {
    if (state.scannerStream) {
      state.scannerStream.getTracks().forEach((track) => track.stop());
      state.scannerStream = null;
    }
    ui.scannerVideo.classList.add('hidden');
  }

  function applyScannedCheckpoint(cp) {
    const existing = state.data.checkpoints.find((item) => item.id === cp.id);
    if (!existing) {
      state.data.checkpoints.unshift({ id: cp.id, name: cp.name, floor: cp.floor, x: cp.x, y: cp.y, ts: cp.ts || Date.now() });
      saveData();
      renderCheckpoints();
    }
    applyCheckpoint(existing || cp);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pathback-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.sessions || !parsed.settings) throw new Error('Invalid PathBack export');
        state.data = { ...defaultData(), ...parsed, settings: { ...defaultData().settings, ...(parsed.settings || {}) } };
        state.floorImages.clear();
        saveData();
        bootRender();
        toast('Import completed.');
      } catch (error) {
        toast('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  function loadDemoPath() {
    const floor = getActiveFloor();
    const points = [makePoint(0, 0, floor)];
    const steps = [
      [0, -4], [2, -8], [5, -12], [9, -12], [13, -9], [16, -6], [16, -2], [12, 0], [8, 2], [4, 5], [3, 10]
    ];
    steps.forEach(([x, y]) => points.push(makePoint(x, y, floor)));
    const distance = points.slice(1).reduce((sum, p, idx) => sum + meters(points[idx], p), 0);
    state.currentSession = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title: 'Demo mall route',
      startedAt: Date.now() - 8 * 60 * 1000,
      endedAt: null,
      startGps: null,
      steps: points.length - 1,
      distance,
      floors: [floor],
      points
    };
    state.current = { ...points[points.length - 1] };
    state.mode = 'paused';
    activateTab('track');
    renderStats();
    drawAll();
    toast('Demo path loaded. You can test Return mode now.');
  }

  function activateTab(name) {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === name));
    requestAnimationFrame(drawAll);
  }

  function bindEvents() {
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
    ui.requestPermissionBtn.addEventListener('click', requestSensorPermission);
    ui.startBtn.addEventListener('click', startJourney);
    ui.pauseBtn.addEventListener('click', pauseJourney);
    ui.stopBtn.addEventListener('click', stopJourney);
    ui.resetBtn.addEventListener('click', resetCurrent);
    ui.calibrateBtn.addEventListener('click', calibrateHeading);
    ui.zoomInBtn.addEventListener('click', () => { state.zoom = Math.min(3, state.zoom + 0.12); drawAll(); });
    ui.zoomOutBtn.addEventListener('click', () => { state.zoom = Math.max(0.35, state.zoom - 0.12); drawAll(); });
    ui.centerBtn.addEventListener('click', () => { state.panX = 0; state.panY = 0; state.data.settings.viewMode = state.data.settings.viewMode === 'follow' ? 'fit' : 'follow'; renderSettings(); drawAll(); toast(state.data.settings.viewMode === 'follow' ? 'Following your position.' : 'Showing the full route.'); });

    ui.floorInput.addEventListener('change', () => ensureFloor(ui.floorInput.value));
    ui.floorInput.addEventListener('blur', () => ensureFloor(ui.floorInput.value));
    ui.floorInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ensureFloor(ui.floorInput.value);
        ui.floorInput.blur();
      }
    });
    ui.floorPlusBtn.addEventListener('click', () => ensureFloor(`Level ${floorNumber(getActiveFloor()) + 1}`));
    ui.floorMinusBtn.addEventListener('click', () => {
      const next = Math.max(0, floorNumber(getActiveFloor()) - 1);
      ensureFloor(next === 0 ? 'Ground' : `Level ${next}`);
    });

    ui.setMapBtn.addEventListener('click', () => ui.mapUpload.click());
    ui.mapUpload.addEventListener('change', (e) => handleMapUpload(e.target.files[0]));

    ui.startReturnBtn.addEventListener('click', () => {
      const source = state.currentSession || state.data.sessions[0];
      startReturnWithSession(source);
    });
    ui.prevTargetBtn.addEventListener('click', () => { state.returnIndex = Math.max(1, state.returnIndex - 1); updateReturnTarget(); });
    ui.nextTargetBtn.addEventListener('click', () => { if (state.returnPath?.length) state.returnIndex = Math.min(state.returnPath.length - 1, state.returnIndex + 1); updateReturnTarget(); });
    ui.stopReturnBtn.addEventListener('click', () => { state.mode = 'idle'; state.returnSession = null; state.returnPath = []; state.returnIndex = -1; renderStats(); updateReturnTarget(); drawAll(); toast('Return mode stopped.'); });

    ui.sessionsList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const session = state.data.sessions.find((s) => s.id === btn.dataset.id);
      if (!session) return;
      if (btn.dataset.action === 'view') {
        state.currentSession = JSON.parse(JSON.stringify(session));
        state.current = { ...state.currentSession.points[state.currentSession.points.length - 1] };
        state.mode = 'paused';
        setCurrentFloor(state.current.floor, false);
        renderFloors();
        activateTab('track');
        renderStats();
        drawAll();
      }
      if (btn.dataset.action === 'return') startReturnWithSession(session);
      if (btn.dataset.action === 'delete' && confirm('Delete this saved session?')) {
        state.data.sessions = state.data.sessions.filter((s) => s.id !== session.id);
        saveData();
        renderSessions();
        toast('Session deleted.');
      }
    });

    ui.exportBtn.addEventListener('click', exportData);
    ui.importBtn.addEventListener('click', () => ui.importFile.click());
    ui.importFile.addEventListener('change', (e) => importData(e.target.files[0]));

    ui.addCheckpointBtn.addEventListener('click', addCheckpoint);
    ui.applyCheckpointBtn.addEventListener('click', () => {
      const cp = state.data.checkpoints[0];
      if (!cp) return toast('No checkpoint saved yet.');
      applyCheckpoint(cp);
    });
    ui.scanCheckpointBtn.addEventListener('click', scanCheckpoint);
    ui.manualCheckpointBtn.addEventListener('click', () => {
      const code = prompt('Paste PathBack checkpoint code:');
      if (!code) return;
      try { applyScannedCheckpoint(decodeCheckpoint(code)); }
      catch (error) { toast('Invalid checkpoint code.'); }
    });

    ui.checkpointList.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const cp = state.data.checkpoints.find((c) => c.id === btn.dataset.id);
      if (!cp) return;
      if (btn.dataset.action === 'apply-cp') applyCheckpoint(cp);
      if (btn.dataset.action === 'copy-cp') {
        const code = encodeCheckpoint(cp);
        await navigator.clipboard?.writeText(code).catch(() => null);
        showCheckpointCode(cp);
        toast('Checkpoint code copied.');
      }
      if (btn.dataset.action === 'delete-cp' && confirm('Delete checkpoint?')) {
        state.data.checkpoints = state.data.checkpoints.filter((c) => c.id !== cp.id);
        saveData();
        renderCheckpoints();
        drawAll();
      }
    });

    [ui.trackingProfileInput, ui.viewModeInput, ui.headingModeInput, ui.mapDetailInput].forEach((input) => input.addEventListener('change', readSettingsFromInputs));
    ui.saveSettingsBtn.addEventListener('click', () => { saveData(); toast('Settings saved.'); });
    ui.resetCalibrationBtn.addEventListener('click', calibrateHeading);
    ui.demoBtn.addEventListener('click', loadDemoPath);
    ui.clearMapsBtn.addEventListener('click', () => {
      if (!confirm('Clear all saved floor map images?')) return;
      state.data.floorMaps = {};
      state.floorImages.clear();
      saveData();
      drawAll();
      toast('Floor maps cleared.');
    });
    ui.clearAllBtn.addEventListener('click', () => {
      if (!confirm('Clear all PathBack data from this browser?')) return;
      localStorage.removeItem(STORAGE_KEY);
      state.data = defaultData();
      state.currentSession = null;
      state.returnSession = null;
      state.mode = 'idle';
      bootRender();
      toast('All local data cleared.');
    });

    if (ui.returnCanvas) ui.returnCanvas.dataset.mobileReturn = 'true';
    window.addEventListener('resize', drawAll);
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredPrompt = event;
      ui.installBtn.classList.remove('hidden');
    });
    ui.installBtn.addEventListener('click', async () => {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      await state.deferredPrompt.userChoice;
      state.deferredPrompt = null;
      ui.installBtn.classList.add('hidden');
    });
  }

  function bootRender() {
    renderFloors();
    renderSettings();
    renderSessions();
    renderCheckpoints();
    renderStats();
    renderCompatibility();
    drawAll();
  }

  function renderCompatibility() {
    const lines = [];
    lines.push(`Location ${'geolocation' in navigator ? 'ready' : 'unavailable'}`);
    lines.push(`Orientation ${'DeviceOrientationEvent' in window ? 'ready' : 'unavailable'}`);
    lines.push(`Motion ${'DeviceMotionEvent' in window ? 'ready' : 'unavailable'}`);
    lines.push(`QR ${'BarcodeDetector' in window ? 'ready' : 'fallback mode'}`);
    ui.compatText.textContent = lines.join(' • ');
  }


  function startMapAnimation() {
    if (state.animationId) return;
    let last = 0;
    const frame = (now) => {
      state.animationId = requestAnimationFrame(frame);
      if (now - last < 70) return; // animated, but still light on mobile
      last = now;
      const activePanel = document.querySelector('.panel.active');
      if (!activePanel) return;
      if (activePanel.id === 'track' || activePanel.id === 'return') drawAll();
    };
    state.animationId = requestAnimationFrame(frame);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch((error) => console.warn('Service worker failed', error));
      });
    }
  }

  bindEvents();
  bindSensors();
  bootRender();
  startMapAnimation();
  registerServiceWorker();
})();

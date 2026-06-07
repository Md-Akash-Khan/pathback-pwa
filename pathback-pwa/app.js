(() => {
  'use strict';

  const STORAGE_KEY = 'pathback.v1.data';
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
    manualStepBtn: $('manualStepBtn'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomInBtn: $('zoomInBtn'),
    centerBtn: $('centerBtn'),
    floorSelect: $('floorSelect'),
    addFloorBtn: $('addFloorBtn'),
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
    stepLengthInput: $('stepLengthInput'),
    sensitivityInput: $('sensitivityInput'),
    stepGapInput: $('stepGapInput'),
    scaleInput: $('scaleInput'),
    stepLengthLabel: $('stepLengthLabel'),
    sensitivityLabel: $('sensitivityLabel'),
    stepGapLabel: $('stepGapLabel'),
    scaleLabel: $('scaleLabel'),
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
    returnIndex: -1,
    heading: 0,
    gps: null,
    lastStepAt: 0,
    motionAverage: 9.81,
    zoom: 1,
    panX: 0,
    panY: 0,
    centerOnCurrent: true,
    timerId: null,
    watchId: null,
    scannerStream: null,
    deferredPrompt: null,
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
        stepLength: 0.7,
        sensitivity: 1.4,
        minStepGap: 340,
        pixelsPerMeter: 18
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
    return ui.floorSelect.value || state.data.floors[0] || 'Ground';
  }

  function renderFloors() {
    ui.floorSelect.innerHTML = '';
    state.data.floors.forEach((floor) => {
      const opt = document.createElement('option');
      opt.value = floor;
      opt.textContent = floor;
      ui.floorSelect.appendChild(opt);
    });
    if (!state.data.floors.includes(state.current.floor)) state.current.floor = state.data.floors[0];
    ui.floorSelect.value = state.current.floor;
    ui.floorLabel.textContent = `Floor: ${state.current.floor}`;
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

  function renderSettings() {
    const s = state.data.settings;
    ui.stepLengthInput.value = s.stepLength;
    ui.sensitivityInput.value = s.sensitivity;
    ui.stepGapInput.value = s.minStepGap;
    ui.scaleInput.value = s.pixelsPerMeter;
    ui.stepLengthLabel.textContent = `${Number(s.stepLength).toFixed(2)} m`;
    ui.sensitivityLabel.textContent = Number(s.sensitivity).toFixed(2);
    ui.stepGapLabel.textContent = `${Math.round(s.minStepGap)} ms`;
    ui.scaleLabel.textContent = `${Math.round(s.pixelsPerMeter)} px/m`;
  }

  function readSettingsFromInputs() {
    state.data.settings.stepLength = Number(ui.stepLengthInput.value);
    state.data.settings.sensitivity = Number(ui.sensitivityInput.value);
    state.data.settings.minStepGap = Number(ui.stepGapInput.value);
    state.data.settings.pixelsPerMeter = Number(ui.scaleInput.value);
    renderSettings();
    drawAll();
  }

  function startJourney() {
    if (state.mode === 'recording') return;
    const floor = getActiveFloor();
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
    state.returnIndex = -1;
    state.current = makePoint(0, 0, getActiveFloor());
    renderStats();
    drawAll();
    toast('Current journey reset.');
  }

  function onStep(source = 'sensor') {
    const now = Date.now();
    if (source === 'sensor' && now - state.lastStepAt < state.data.settings.minStepGap) return;
    state.lastStepAt = now;

    const rad = (state.heading * Math.PI) / 180;
    const step = state.data.settings.stepLength;
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

    if (state.mode === 'returning') {
      updateReturnTarget();
    }

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
      toast('Sensor permission was blocked. Manual step still works.');
    }
  }

  let sensorsBound = false;
  function bindSensors() {
    if (sensorsBound) return;
    sensorsBound = true;

    window.addEventListener('deviceorientation', (event) => {
      const webkitHeading = event.webkitCompassHeading;
      let heading = typeof webkitHeading === 'number' ? webkitHeading : event.alpha;
      if (typeof heading === 'number' && Number.isFinite(heading)) {
        state.heading = (heading + 360) % 360;
        ui.headingStat.textContent = `${Math.round(state.heading)}°`;
        updateReturnTarget();
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
      state.motionAverage = state.motionAverage * 0.92 + magnitude * 0.08;
      const delta = Math.abs(magnitude - state.motionAverage);
      if (delta > state.data.settings.sensitivity) onStep('sensor');
    }, true);
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
    drawMap(ui.pathCanvas, state.currentSession || state.returnSession, false);
    drawMap(ui.returnCanvas, state.returnSession || state.currentSession, true);
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
    const height = Math.floor(Math.max(rect.height, 520) * dpr);
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
    const points = (session?.points || []).filter((p) => p.floor === floor);
    const scale = state.data.settings.pixelsPerMeter * state.zoom;
    const origin = computeOrigin(w, h, points);

    drawBackground(ctx, w, h, floor, origin, scale);
    drawGrid(ctx, w, h);
    drawCheckpoints(ctx, floor, origin, scale);

    if (points.length > 1) {
      ctx.lineWidth = isReturn ? 5 : 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = isReturn ? 'rgba(249, 115, 22, 0.9)' : 'rgba(96, 165, 250, 0.95)';
      ctx.beginPath();
      points.forEach((p, idx) => {
        const pt = worldToScreen(p, origin, scale);
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      points.forEach((p, idx) => {
        if (idx % 5 !== 0 && idx !== points.length - 1) return;
        const pt = worldToScreen(p, origin, scale);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (session?.points?.length) {
      const start = session.points[0];
      if (start.floor === floor) drawPin(ctx, worldToScreen(start, origin, scale), '#22c55e', 'START');
    }

    if (state.current.floor === floor) {
      drawHeading(ctx, state.current, origin, scale);
      drawPin(ctx, worldToScreen(state.current, origin, scale), '#60a5fa', 'YOU');
    }

    if (isReturn && state.returnSession && state.returnIndex >= 0) {
      const target = state.returnSession.points[state.returnIndex];
      if (target?.floor === floor) {
        drawPin(ctx, worldToScreen(target, origin, scale), '#f97316', 'NEXT');
        const from = worldToScreen(state.current, origin, scale);
        const to = worldToScreen(target, origin, scale);
        ctx.strokeStyle = 'rgba(249,115,22,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function computeOrigin(w, h, points) {
    if (state.centerOnCurrent) {
      return {
        x: w / 2 - state.current.x * state.data.settings.pixelsPerMeter * state.zoom + state.panX,
        y: h / 2 - state.current.y * state.data.settings.pixelsPerMeter * state.zoom + state.panY
      };
    }
    if (!points.length) return { x: w / 2 + state.panX, y: h / 2 + state.panY };
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const scale = state.data.settings.pixelsPerMeter * state.zoom;
    return { x: w / 2 - cx * scale + state.panX, y: h / 2 - cy * scale + state.panY };
  }

  function drawBackground(ctx, w, h, floor, origin, scale) {
    const img = getFloorImage(floor);
    if (!img || !img.complete) return;
    const mapWidthM = 80;
    const imgW = mapWidthM * scale;
    const imgH = img.height ? imgW * (img.height / img.width) : imgW * 0.65;
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.drawImage(img, origin.x - imgW / 2, origin.y - imgH / 2, imgW, imgH);
    ctx.restore();
  }

  function drawGrid(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCheckpoints(ctx, floor, origin, scale) {
    state.data.checkpoints.filter((c) => c.floor === floor).forEach((c) => {
      const pt = worldToScreen(c, origin, scale);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef3c7';
      ctx.font = '700 12px Inter, sans-serif';
      ctx.fillText(c.name, pt.x + 10, pt.y - 8);
    });
  }

  function drawPin(ctx, pt, color, label) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.font = '900 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, pt.x, pt.y - 16);
    ctx.restore();
  }

  function drawHeading(ctx, point, origin, scale) {
    const pt = worldToScreen(point, origin, scale);
    const rad = (state.heading * Math.PI) / 180;
    const end = {
      x: pt.x + Math.sin(rad) * 34,
      y: pt.y - Math.cos(rad) * 34
    };
    ctx.save();
    ctx.strokeStyle = 'rgba(191, 219, 254, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
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
    ui.floorSelect.value = cp.floor;
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
    state.current = { ...state.returnSession.points[state.returnSession.points.length - 1] };
    state.returnIndex = Math.max(0, state.returnSession.points.length - 2);
    state.mode = 'returning';
    state.currentSession = null;
    ui.floorSelect.value = state.current.floor;
    renderFloors();
    startTimer();
    activateTab('return');
    updateReturnTarget();
    drawAll();
    toast('Return mode started. Follow the highlighted point.');
  }

  function updateReturnTarget() {
    if (state.mode !== 'returning' || !state.returnSession) return;
    const target = state.returnSession.points[state.returnIndex];
    if (!target) {
      ui.guidanceTitle.textContent = 'You are back near the start';
      ui.guidanceText.textContent = 'Return path completed.';
      ui.returnSummary.textContent = 'Completed';
      ui.compassNeedle.style.transform = 'rotate(0deg)';
      return;
    }

    const d = meters(state.current, target);
    if (d < 1.3 && state.returnIndex > 0) {
      state.returnIndex -= 1;
      updateReturnTarget();
      return;
    }
    if (d < 1.3 && state.returnIndex === 0) {
      ui.guidanceTitle.textContent = 'You are near the start';
      ui.guidanceText.textContent = 'Look around for your entrance or starting landmark.';
      ui.returnSummary.textContent = 'Near start point';
      drawAll();
      return;
    }

    if (target.floor !== state.current.floor) {
      ui.guidanceTitle.textContent = `Switch to ${target.floor}`;
      ui.guidanceText.textContent = `Your next breadcrumb is on ${target.floor}. Change floor first, then continue.`;
      ui.returnSummary.textContent = `${Math.round(d)} m to next point • floor change needed`;
      return;
    }

    const bearing = bearingBetween(state.current, target);
    const relative = normalizeAngle(bearing - state.heading);
    ui.compassNeedle.style.transform = `rotate(${relative}deg)`;
    const turn = relativeInstruction(relative);
    ui.guidanceTitle.textContent = `${turn} • ${d.toFixed(1)} m`;
    ui.guidanceText.textContent = `Target breadcrumb ${state.returnIndex + 1} of ${state.returnSession.points.length}. Keep moving toward the arrow.`;
    ui.returnSummary.textContent = `${d.toFixed(1)} m to next breadcrumb • ${state.returnIndex + 1} points remaining`;
    drawAll();
  }

  function bearingBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rad = Math.atan2(dx, -dy);
    return (rad * 180 / Math.PI + 360) % 360;
  }

  function normalizeAngle(angle) {
    let a = ((angle + 540) % 360) - 180;
    return a;
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
    ui.manualStepBtn.addEventListener('click', () => onStep('manual'));
    ui.zoomInBtn.addEventListener('click', () => { state.zoom = Math.min(3, state.zoom + 0.12); drawAll(); });
    ui.zoomOutBtn.addEventListener('click', () => { state.zoom = Math.max(0.35, state.zoom - 0.12); drawAll(); });
    ui.centerBtn.addEventListener('click', () => { state.panX = 0; state.panY = 0; state.centerOnCurrent = !state.centerOnCurrent; drawAll(); toast(state.centerOnCurrent ? 'Centering on you.' : 'Centering on route.'); });

    ui.floorSelect.addEventListener('change', () => {
      state.current.floor = getActiveFloor();
      renderFloors();
      drawAll();
    });

    ui.addFloorBtn.addEventListener('click', () => {
      const name = prompt('Floor name:', `Level ${state.data.floors.length}`);
      if (!name) return;
      const clean = name.trim();
      if (!clean || state.data.floors.includes(clean)) return toast('Floor already exists or invalid.');
      state.data.floors.push(clean);
      state.current.floor = clean;
      saveData();
      renderFloors();
      drawAll();
    });

    ui.setMapBtn.addEventListener('click', () => ui.mapUpload.click());
    ui.mapUpload.addEventListener('change', (e) => handleMapUpload(e.target.files[0]));

    ui.startReturnBtn.addEventListener('click', () => {
      const source = state.currentSession || state.data.sessions[0];
      startReturnWithSession(source);
    });
    ui.prevTargetBtn.addEventListener('click', () => { state.returnIndex = Math.max(0, state.returnIndex - 1); updateReturnTarget(); });
    ui.nextTargetBtn.addEventListener('click', () => { if (state.returnSession) state.returnIndex = Math.min(state.returnSession.points.length - 1, state.returnIndex + 1); updateReturnTarget(); });
    ui.stopReturnBtn.addEventListener('click', () => { state.mode = 'idle'; state.returnSession = null; state.returnIndex = -1; renderStats(); updateReturnTarget(); drawAll(); toast('Return mode stopped.'); });

    ui.sessionsList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const session = state.data.sessions.find((s) => s.id === btn.dataset.id);
      if (!session) return;
      if (btn.dataset.action === 'view') {
        state.currentSession = JSON.parse(JSON.stringify(session));
        state.current = { ...state.currentSession.points[state.currentSession.points.length - 1] };
        state.mode = 'paused';
        ui.floorSelect.value = state.current.floor;
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

    [ui.stepLengthInput, ui.sensitivityInput, ui.stepGapInput, ui.scaleInput].forEach((input) => input.addEventListener('input', readSettingsFromInputs));
    ui.saveSettingsBtn.addEventListener('click', () => { saveData(); toast('Settings saved.'); });
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
    lines.push(`Geolocation: ${'geolocation' in navigator ? 'supported' : 'not supported'}`);
    lines.push(`Device orientation: ${'DeviceOrientationEvent' in window ? 'supported' : 'not supported'}`);
    lines.push(`Device motion: ${'DeviceMotionEvent' in window ? 'supported' : 'not supported'}`);
    lines.push(`Barcode scanner: ${'BarcodeDetector' in window ? 'supported' : 'limited/not supported'}`);
    lines.push(`Camera: ${navigator.mediaDevices?.getUserMedia ? 'supported' : 'not supported'}`);
    ui.compatText.textContent = lines.join(' • ');
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
  registerServiceWorker();
})();

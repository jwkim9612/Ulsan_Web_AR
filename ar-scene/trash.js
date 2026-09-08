// AR Scene: 얼음 깨고 장생이 구하기 모드. 8th Wall World Tracking(SLAM)으로 실측 위치를
// 추적해서 사용자 주변에 얼음 오브젝트(3D 모델, `assets/models/Ice.glb`)를 배치한다. 그 안에
// 들어있는 장생이 마스코트는 아직 모델이 없어 박스 placeholder로 대체돼 있다. 사용자가 실제로
// 일정 거리 안까지 다가오면 그 얼음을 화면 앞에 고정(lock)시키고, lock된 동안에만
// XR8.CameraPixelArray로 카메라 프레임을 받아 MediaPipe Hands에 넘긴다. 손을 화면 중앙(잡기
// 존)에 잠깐 유지하면 "잡기"로 인정되고, 잡은 채로 손을 흔들면 얼음이 깨지면서(이펙트 재생)
// 장생이가 구조된다.
//
// 얼음 모델의 스케일/피벗은 만든 툴마다 제각각일 수 있어서, `fitLoadedModel`이 로드된 실제
// 바운딩 박스를 기준으로 목표 크기에 맞게 자동 스케일하고 중심을 맞춰준다 — 모델을 다시
// 내보내도 코드 수정 없이 항상 일관된 크기로 보인다. 장생이 모델이 준비되면 mascotEl도 같은
// 방식으로 교체하면 된다.
//
// 퍼즐 모드(index.html)도 동일하게 월드 트래킹을 쓰지만, 페이지는 여전히 분리돼 있다.

const backBtn = document.getElementById('back-btn');
const modePuzzleBtn = document.getElementById('mode-puzzle');
const trashRoot = document.getElementById('trash-root');
const cameraEl = document.querySelector('a-camera');
const trashCountText = document.getElementById('trash-count-text');
const trashHintEl = document.getElementById('trash-hint');
const trashFinishedEl = document.getElementById('trash-finished');
const handCanvas = document.getElementById('hand-canvas');
const handCtx = handCanvas.getContext('2d');

// --- 안드로이드 크롬 손 인식 미동작 진단용 디버그 오버레이 (?debug=1) ---
// USB 디버깅 없이도 화면에서 바로 원인을 좁힐 수 있도록, 파이프라인 등록/프레임 전달/검출
// 각 단계의 성공·실패를 눈에 보이는 로그로 남긴다. 평소(?debug=1 없음)에는 완전히 비활성.
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const debugState = {
  pipelineStatus: 'idle', // idle | attempting | ok | failed
  cvActive: false,
  locked: false,
  framesSent: 0,
  resultsReceived: 0,
  lastLandmarkCount: 0,
  lastShake: null,
  log: [], // 최근 이벤트/에러 스크롤 로그
};
let debugOverlayEl = null;
function debugLog(msg) {
  if (!DEBUG) return;
  const t = new Date().toISOString().slice(11, 23);
  debugState.log.push(`${t} ${msg}`);
  if (debugState.log.length > 10) debugState.log.shift();
}
function renderDebugOverlay() {
  debugOverlayEl.textContent =
    `pipeline:${debugState.pipelineStatus} cvActive:${debugState.cvActive} locked:${debugState.locked} grabbed:${lockedItem ? lockedItem.grabbed : '-'}\n` +
    `framesSent:${debugState.framesSent} sendResolved:${debugState.sendResolved || 0} resultsRecv:${debugState.resultsReceived} landmarks:${debugState.lastLandmarkCount}\n` +
    `shake:${debugState.lastShake ? JSON.stringify(debugState.lastShake) : '-'}\n` +
    `--- log ---\n${debugState.log.join('\n')}`;
}
if (DEBUG) {
  debugOverlayEl = document.createElement('pre');
  Object.assign(debugOverlayEl.style, {
    position: 'fixed', top: '0', right: '0', zIndex: '9999',
    margin: '0', padding: '8px', fontSize: '11px', lineHeight: '1.4',
    color: '#0f0', background: 'rgba(0,0,0,0.6)', maxWidth: '60vw',
    maxHeight: '100vh', overflow: 'hidden', whiteSpace: 'pre-wrap', pointerEvents: 'none',
  });
  document.body.appendChild(debugOverlayEl);
  debugLog('debug overlay started');
  setInterval(renderDebugOverlay, 300);
  // hands.send()는 Promise를 반환하는데 기존 동기 try/catch로는 비동기 reject를 못 잡는다 —
  // MediaPipe 내부에서 조용히 실패(reject)하거나 uncaught 에러를 던지는 경우를 잡기 위한 전역 net.
  window.addEventListener('unhandledrejection', (ev) => {
    debugLog(`unhandled rejection: ${(ev.reason && ev.reason.message) || ev.reason}`);
  });
  window.addEventListener('error', (ev) => {
    debugLog(`window error: ${ev.message} @ ${(ev.filename || '').split('/').pop()}:${ev.lineno}`);
  });
}

backBtn.addEventListener('click', () => {
  location.href = '../index.html';
});
modePuzzleBtn.addEventListener('click', () => {
  location.href = 'index.html';
});

function resizeHandCanvas() {
  handCanvas.width = window.innerWidth;
  handCanvas.height = window.innerHeight;
}
resizeHandCanvas();
window.addEventListener('resize', resizeHandCanvas);

// --- 오브젝트 배치 및 거리/응시 판정 ---
const RESCUE_COUNT = 3;
const SPAWN_MIN_M = 1.2;
const SPAWN_MAX_M = 3.0; // 카메라 시작 위치(원점) 기준 구면좌표, 실측 미터. 스케일 추정 오차가
                          // 거리에 비례해서 커지므로 너무 멀리 두면 "가까워져도 거리가 안 줄어드는"
                          // 오브젝트가 생길 수 있어 범위를 좁게 잡음.
const LOCK_DISTANCE_M = 2.0; // 이 거리 안이면서 아래 각도 조건도 만족해야 lock (순수 실측 거리만
                              // 보면 스케일 오차 때문에 절대 안 가까워지는 오브젝트가 생길 수 있어서,
                              // "바라보고 있는지"를 같이 봐서 느슨하게 함)
const LOCK_GAZE_DOT_THRESHOLD = 0.85; // 화면 중앙 쪽으로 바라보고 있어야 함(약 32도 이내)
const LOCK_FORWARD_OFFSET_M = 1.0; // lock되면 카메라 앞 이 거리에 고정(너무 가까워 커 보이지 않게)
const SPAWN_HEIGHT_OFFSET_M = 0.9; // 눈높이(카메라) 기준 이만큼 위로 띄워서 배치

let iceItems = []; // { el, iceEl, mascotEl, worldPos, grabbed, removed }
let lockedItem = null;
let rescuedCount = 0;

const ICE_MODEL_URL = '../assets/models/Ice.glb';
const ICE_MODEL_TARGET_SIZE_M = 0.35; // 모델의 가장 긴 변이 대략 이 크기가 되도록 자동 스케일

// glb 원본의 스케일/피벗은 만든 툴마다 제각각이라, 로드된 실제 바운딩 박스를 기준으로
// 크기를 목표 치수에 맞게 자동 스케일하고 중심을 엔티티 원점에 맞춰준다. 이렇게 해두면
// 모델을 나중에 다시 내보내도(스케일이 바뀌어도) 코드 수정 없이 항상 일관된 크기로 보인다.
function fitLoadedModel(el, targetSizeM) {
  el.addEventListener('model-loaded', (e) => {
    const mesh = (e.detail && e.detail.model) || el.getObject3D('mesh');
    if (!mesh) return;
    const box = new AFRAME.THREE.Box3().setFromObject(mesh);
    const size = new AFRAME.THREE.Vector3();
    const center = new AFRAME.THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 0) return;
    const scale = targetSizeM / maxDim;
    mesh.scale.multiplyScalar(scale);
    mesh.position.sub(center.multiplyScalar(scale));
  });
}

// placeholder: 장생이 마스코트는 아직 모델이 없어서 박스로 넣어둔 형태.
// 그림/모델이 준비되면 mascotEl도 iceEl과 같은 방식(gltf-model + fitLoadedModel)으로 교체.
function spawnIceItems() {
  for (let i = 0; i < RESCUE_COUNT; i++) {
    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    const worldPos = {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: SPAWN_HEIGHT_OFFSET_M + radius * Math.sin(phi) * Math.sin(theta) * 0.4, // 세로 범위는 좀 좁게
      z: radius * Math.cos(phi),
    };

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('position', `${worldPos.x} ${worldPos.y} ${worldPos.z}`);

    const iceEl = document.createElement('a-entity');
    iceEl.setAttribute('gltf-model', `url(${ICE_MODEL_URL})`);
    fitLoadedModel(iceEl, ICE_MODEL_TARGET_SIZE_M);
    wrapper.appendChild(iceEl);

    const mascotEl = document.createElement('a-entity');
    mascotEl.setAttribute('geometry', 'primitive: box; width: 0.14; height: 0.14; depth: 0.14');
    mascotEl.setAttribute('material', 'color: #2d3a66; transparent: true');
    mascotEl.setAttribute('visible', false); // 깨지기 전까지는 숨김
    wrapper.appendChild(mascotEl);

    trashRoot.appendChild(wrapper);

    iceItems.push({
      el: wrapper, iceEl, mascotEl, worldPos, grabbed: false, removed: false,
    });
  }
  updateTrashCountText();
  trashHintEl.textContent = '얼음 쪽으로 다가가 보세요';
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// 카메라 포즈는 XR8 파이프라인 콜백이 주는 processCpuResult.reality가 아니라 실제 렌더링에
// 쓰이는 a-camera의 object3D에서 직접 읽는다. 파이프라인 콜백 값은 렌더링에 실제로 쓰인
// 그 프레임의 포즈와 타이밍/보정이 미묘하게 어긋날 수 있는데, 그 어긋남만큼 lock된
// 오브젝트가 화면 중앙이 아니라 한쪽으로 쏠려 보이거나(왼쪽/오른쪽 고정) 사용자가 계속
// 움직이는 동안 그 오차가 누적돼 점점 화면 밖으로 밀려나는 것처럼 보이는 원인이었다.
// a-camera 자체에서 읽으면 렌더링에 쓰인 포즈와 항상 정확히 일치한다.
function updateLock() {
  const camPos = new AFRAME.THREE.Vector3();
  const camQuat = new AFRAME.THREE.Quaternion();
  let forward;
  try {
    cameraEl.object3D.getWorldPosition(camPos);
    cameraEl.object3D.getWorldQuaternion(camQuat);
    forward = new AFRAME.THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
  } catch (e) {
    console.error('[ice] 카메라 위치/방향 계산 실패', e);
    if (DEBUG) debugLog(`camera pose failed: ${(e && e.message) || e}`);
    return;
  }

  if (!lockedItem) {
    // 순수 실측 거리만 보지 않고, "바라보고 있으면서 + 어느 정도 가까워졌는지"를 같이 본다.
    const candidate = iceItems.find((t) => {
      if (t.removed || dist(camPos, t.worldPos) >= LOCK_DISTANCE_M) return false;
      const toItem = new AFRAME.THREE.Vector3(
        t.worldPos.x - camPos.x, t.worldPos.y - camPos.y, t.worldPos.z - camPos.z,
      ).normalize();
      return toItem.dot(forward) >= LOCK_GAZE_DOT_THRESHOLD;
    });
    if (candidate) {
      lockedItem = candidate;
      lockedItem.grabbed = false;
      grabDwellStartedAt = null;
      shakeHistory = [];
      trashHintEl.textContent = '손을 뻗어 얼음을 잡아보세요';
      if (DEBUG) debugState.locked = true;
      onLockStart();
    }
    return;
  }

  // 멀어져도 락은 안 풀린다 — 깨기 전까지는 계속 눈앞에 고정.
  lockedItem.el.object3D.position.set(
    camPos.x + forward.x * LOCK_FORWARD_OFFSET_M,
    camPos.y + forward.y * LOCK_FORWARD_OFFSET_M,
    camPos.z + forward.z * LOCK_FORWARD_OFFSET_M,
  );
}

function updateTrashCountText() {
  trashCountText.textContent = `${rescuedCount}/${RESCUE_COUNT}`;
}

const distanceTrackerModule = {
  name: 'trash-distance-tracker',
  onUpdate: ({ processCpuResult }) => {
    if (!processCpuResult.reality) return; // 트래킹이 아직 준비 안 된 경우를 걸러내는 용도로만 사용
    updateLock();
  },
};

// --- 잡기(grab) 판정 ---
// lock된 오브젝트는 항상 카메라 정면 고정 거리에 위치하므로, 화면 어디에 있는지 매번 계산할
// 필요 없이 손 랜드마크의 정규화 좌표(0~1)가 화면 중앙 근처(잡기 존)에 있는지만 보면 된다.
const GRAB_ZONE_MIN = 0.35;
const GRAB_ZONE_MAX = 0.65;
const GRAB_DWELL_MS = 400; // 이 시간만큼 잡기 존 안에 머물러야 "잡기"로 인정(실수 방지)

let grabDwellStartedAt = null;

// gltf-model은 A-Frame의 material 컴포넌트로 색을 바꿀 수 없어서(모델 자체 재질을 쓰므로),
// 잡았을 때 피드백은 스케일 변화로만 표현한다.
function onGrab(item) {
  item.grabbed = true;
  item.iceEl.setAttribute('scale', '1.15 1.15 1.15');
  trashHintEl.textContent = '손을 흔들어서 얼음을 깨보세요!';
  if (DEBUG) debugLog('grab: item grabbed');
}

function onRelease(item) {
  item.grabbed = false;
  item.iceEl.setAttribute('scale', '1 1 1');
  shakeHistory = [];
  trashHintEl.textContent = '손을 뻗어 얼음을 잡아보세요';
  if (DEBUG) debugLog('grab: released (moved out of zone)');
}

// --- 흔들기(shake) 판정 (기존 ar-scene 손 인식 모드의 쓰다듬기 판정과 같은 원리) ---
// 손바닥 중앙(랜드마크 9번, 중지 뿌리)의 좌표를 최근 SHAKE_HISTORY_MS만큼 기록해두고,
// 그 안에서 방향이 여러 번 바뀌면 "흔들기"로 판정. 쓰다듬기보다 더 크고 빠른 움직임을
// 기대하는 동작이라 허용 진폭(SHAKE_MAX_SPREAD)과 최소 이동량(SHAKE_MIN_MOVE)을 더 크게 잡음.
const SHAKE_HISTORY_MS = 900;
const SHAKE_MIN_REVERSALS = 3;
const SHAKE_MIN_MOVE = 0.02;
const SHAKE_MAX_SPREAD = 0.5;
const BREAK_COOLDOWN_MS = 1000;

let shakeHistory = [];
let lastBreakTime = 0;

function checkShake(x, y, now) {
  shakeHistory.push({ x, y, t: now });
  shakeHistory = shakeHistory.filter((p) => now - p.t <= SHAKE_HISTORY_MS);
  if (shakeHistory.length < 4) return false;

  let reversals = 0;
  let prevDir = 0;
  for (let i = 1; i < shakeHistory.length; i++) {
    const dx = shakeHistory[i].x - shakeHistory[i - 1].x;
    const dy = shakeHistory[i].y - shakeHistory[i - 1].y;
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(delta) < SHAKE_MIN_MOVE) continue;
    const dir = delta > 0 ? 1 : -1;
    if (prevDir !== 0 && dir !== prevDir) reversals++;
    prevDir = dir;
  }

  const xs = shakeHistory.map((p) => p.x);
  const ys = shakeHistory.map((p) => p.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

  if (DEBUG) debugState.lastShake = { reversals, spread: Number(spread.toFixed(4)) };
  return reversals >= SHAKE_MIN_REVERSALS && spread <= SHAKE_MAX_SPREAD;
}

// --- 깨짐 이펙트 (placeholder: 그림 없이 도형 애니메이션으로 구현) ---
const BREAK_EFFECT_MS = 800;
const SHARD_COUNT = 7;

function spawnShards(wrapper) {
  for (let i = 0; i < SHARD_COUNT; i++) {
    const shard = document.createElement('a-entity');
    shard.setAttribute('geometry', 'primitive: plane; width: 0.06; height: 0.06');
    shard.setAttribute('material', 'color: #bfe8ff; opacity: 0.9; transparent: true; side: double');
    shard.setAttribute('position', '0 0 0');

    const angle = Math.random() * Math.PI * 2;
    const flyDist = 0.25 + Math.random() * 0.25;
    const toX = Math.cos(angle) * flyDist;
    const toY = (Math.random() * 2 - 1) * flyDist;
    const toZ = Math.sin(angle) * flyDist;

    shard.setAttribute('animation__fly', `property: position; to: ${toX} ${toY} ${toZ}; dur: ${BREAK_EFFECT_MS}; easing: easeOutQuad`);
    shard.setAttribute('animation__fade', `property: material.opacity; to: 0; dur: ${BREAK_EFFECT_MS}; easing: easeInQuad`);
    shard.setAttribute(
      'animation__spin',
      `property: rotation; to: ${Math.random() * 360} ${Math.random() * 360} ${Math.random() * 360}; dur: ${BREAK_EFFECT_MS}; easing: linear`,
    );

    wrapper.appendChild(shard);
  }
}

function breakLockedItem() {
  const item = lockedItem;
  if (!item) return;

  item.removed = true;
  lockedItem = null;
  onLockEnd();

  item.iceEl.setAttribute('visible', false);
  spawnShards(item.el);

  item.mascotEl.setAttribute('visible', true);
  item.mascotEl.setAttribute(
    'animation__escape',
    `property: position; to: 0 0.6 0; dur: ${BREAK_EFFECT_MS}; easing: easeOutQuad`,
  );
  item.mascotEl.setAttribute(
    'animation__escape-fade',
    `property: material.opacity; from: 1; to: 0; delay: ${Math.round(BREAK_EFFECT_MS * 0.4)}; dur: ${Math.round(BREAK_EFFECT_MS * 0.6)}; easing: easeInQuad`,
  );

  setTimeout(() => {
    item.el.remove();
  }, BREAK_EFFECT_MS + 50);

  rescuedCount++;
  updateTrashCountText();

  if (rescuedCount === RESCUE_COUNT) {
    setTimeout(() => {
      trashHintEl.textContent = '';
      trashFinishedEl.style.display = 'block';
    }, BREAK_EFFECT_MS);
  } else {
    trashHintEl.textContent = '다음 얼음을 찾아 다가가 보세요';
  }
}

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});

hands.onResults((results) => {
  if (DEBUG) debugState.resultsReceived++;
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  if (DEBUG) debugState.lastLandmarkCount = hasHand ? results.multiHandLandmarks[0].length : 0;
  if (!hasHand) {
    grabDwellStartedAt = null;
    shakeHistory = [];
    return;
  }

  for (const landmarks of results.multiHandLandmarks) {
    drawConnectors(handCtx, landmarks, HAND_CONNECTIONS, { color: '#2ea5ff', lineWidth: 3 });
    drawLandmarks(handCtx, landmarks, { color: '#ffffff', fillColor: '#2ea5ff', radius: 4 });
  }

  if (!lockedItem) return;

  const palm = results.multiHandLandmarks[0][9];
  const now = performance.now();
  const inZone = palm.x >= GRAB_ZONE_MIN && palm.x <= GRAB_ZONE_MAX
    && palm.y >= GRAB_ZONE_MIN && palm.y <= GRAB_ZONE_MAX;

  if (!lockedItem.grabbed) {
    if (!inZone) { grabDwellStartedAt = null; return; }
    if (grabDwellStartedAt === null) { grabDwellStartedAt = now; return; }
    if (now - grabDwellStartedAt < GRAB_DWELL_MS) return;
    grabDwellStartedAt = null;
    onGrab(lockedItem);
    return;
  }

  if (!inZone) {
    onRelease(lockedItem);
    return;
  }

  if (checkShake(palm.x, palm.y, now) && now - lastBreakTime > BREAK_COOLDOWN_MS) {
    lastBreakTime = now;
    shakeHistory = [];
    breakLockedItem();
  }
});

// --- XR8.CameraPixelArray -> MediaPipe Hands 프레임 전달 ---
// lock된 동안에만 가동해서 World Tracking(SLAM)과 동시 구동할 때의 부하를 줄인다.
const MEDIAPIPE_MIN_INTERVAL_MS = 120; // 시간 기반 스로틀
let lastHandsSendAt = 0;
const handsSourceCanvas = document.createElement('canvas');
const handsSourceCtx = handsSourceCanvas.getContext('2d');

function pixelArrayToCanvas({ rows, cols, rowBytes, pixels }) {
  if (handsSourceCanvas.width !== cols || handsSourceCanvas.height !== rows) {
    handsSourceCanvas.width = cols;
    handsSourceCanvas.height = rows;
  }
  const imageData = handsSourceCtx.createImageData(cols, rows);
  const expectedRowBytes = cols * 4; // luminance:false로 요청 -> RGBA
  if (rowBytes === expectedRowBytes) {
    imageData.data.set(pixels);
  } else {
    for (let row = 0; row < rows; row++) {
      imageData.data.set(pixels.subarray(row * rowBytes, row * rowBytes + expectedRowBytes), row * expectedRowBytes);
    }
  }
  handsSourceCtx.putImageData(imageData, 0, 0);
  if (DEBUG) handCtx.drawImage(handsSourceCanvas, 0, 0, 160, 120); // 색이 잘못되면 RGBA 가정 오류 육안 확인용
  return handsSourceCanvas;
}

let loggedPixelArrayShape = false; // 락마다 한 번만 실제 객체 모양을 로그(스팸 방지)

// MediaPipe Hands(레거시 Solutions API)는 이전 send()의 Promise가 끝나기 전에 다음 프레임을
// 보내면 내부 WASM 상태가 겹쳐서 깨질 수 있다("memory access out of bounds"로 계속 reject됨 —
// 처리 속도가 느린 기기일수록 시간 스로틀만으로는 안 걸러지고 겹칠 확률이 높아짐). 그래서 시간
// 스로틀과 별개로, 이전 프레임이 아직 처리 중이면 무조건 이번 프레임은 건너뛴다.
let sendInFlight = false;

const cvModule = {
  name: 'trash-cv',
  onProcessCpu: ({ processGpuResult }) => {
    try {
      const cameraPixelArray = processGpuResult.camerapixelarray;
      if (!cameraPixelArray || sendInFlight) return;
      if (DEBUG && !loggedPixelArrayShape) {
        loggedPixelArrayShape = true;
        const { rows, cols, rowBytes, pixels } = cameraPixelArray;
        debugLog(`shape rows=${rows}(${typeof rows}) cols=${cols}(${typeof cols}) rowBytes=${rowBytes}(${typeof rowBytes})`);
        debugLog(`pixels=${pixels && pixels.constructor && pixels.constructor.name} len=${pixels && pixels.length}`);
        debugLog(`keys=${Object.keys(cameraPixelArray).join(',')}`);
      }
      const now = performance.now();
      if (now - lastHandsSendAt < MEDIAPIPE_MIN_INTERVAL_MS) return;
      lastHandsSendAt = now;
      sendInFlight = true;
      const sendPromise = hands.send({ image: pixelArrayToCanvas(cameraPixelArray) });
      if (DEBUG) debugState.framesSent++;
      if (sendPromise && typeof sendPromise.then === 'function') {
        sendPromise.then(
          () => { if (DEBUG) debugState.sendResolved = (debugState.sendResolved || 0) + 1; },
          (e) => { if (DEBUG) debugLog(`hands.send rejected: ${(e && e.message) || e}`); },
        ).finally(() => { sendInFlight = false; });
      } else {
        sendInFlight = false; // send()가 Promise가 아닌 값을 준 이례적인 경우 대비
      }
    } catch (e) {
      sendInFlight = false;
      console.error('[ice] CameraPixelArray -> MediaPipe 프레임 전달 실패', e);
      debugLog(`send failed: ${(e && e.message) || e}`);
    }
  },
};

// XR8.CameraPixelArray는 락되기 전까지 한 번도 안 건드리는 API라, 실제 기기에서 처음
// 호출되는 시점(락 되는 순간)에야 문제가 드러날 수 있다 — 여기서 실패해도 손 인식만
// 못 하게 될 뿐, 거리 판정/락 자체(World Tracking)는 계속 정상 동작하도록 격리한다.
let cvActive = false;

function onLockStart() {
  if (DEBUG) {
    debugState.pipelineStatus = 'attempting';
    debugLog('onLockStart: registering pipeline modules');
    loggedPixelArrayShape = false;
  }
  try {
    XR8.addCameraPipelineModule(XR8.CameraPixelArray.pipelineModule({ luminance: false, maxDimension: 320 }));
    XR8.addCameraPipelineModule(cvModule);
    cvActive = true;
    if (DEBUG) { debugState.pipelineStatus = 'ok'; debugState.cvActive = true; debugLog('pipeline registered ok'); }
  } catch (e) {
    console.error('[ice] CameraPixelArray 파이프라인 모듈 등록 실패 — 잡기/흔들기 인식 없이 진행', e);
    cvActive = false;
    if (DEBUG) { debugState.pipelineStatus = 'failed'; debugLog(`pipeline register failed: ${(e && e.message) || e}`); }
  }
}

// MediaPipe Hands는 wasm/모델 파일을 첫 send() 시점에야 지연 로딩한다. 이걸 락 거는 순간까지
// 미뤄두면 사용자가 처음 손을 뻗으려는 바로 그 순간 로딩 렉을 그대로 겪게 되므로, 스캔 대기
// 시간(SCALE_SETTLE_MS) 동안 더미 프레임을 한 번 보내 미리 로딩해둔다.
function warmupHands() {
  if (sendInFlight) return;
  const warmupCanvas = document.createElement('canvas');
  warmupCanvas.width = 64;
  warmupCanvas.height = 64;
  sendInFlight = true;
  if (DEBUG) debugLog('warmup: send() started');
  const p = hands.send({ image: warmupCanvas });
  const done = (label) => { if (DEBUG) debugLog(`warmup: ${label}`); sendInFlight = false; };
  if (p && typeof p.then === 'function') {
    p.then(() => done('resolved'), (e) => done(`rejected: ${(e && e.message) || e}`));
  } else {
    sendInFlight = false;
  }
}

function onLockEnd() {
  if (cvActive) {
    try {
      XR8.removeCameraPipelineModule('trash-cv');
      XR8.removeCameraPipelineModule('camerapixelarray');
    } catch (e) {
      console.error('[ice] CameraPixelArray 파이프라인 모듈 해제 실패', e);
      if (DEBUG) debugLog(`pipeline unregister failed: ${(e && e.message) || e}`);
    }
    cvActive = false;
  }
  if (DEBUG) { debugState.cvActive = false; debugState.locked = false; debugState.pipelineStatus = 'idle'; }
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  grabDwellStartedAt = null;
  shakeHistory = [];
}

// --- 초기화 ---
// 단안 카메라 기반 SLAM은 트래킹 시작 직후 몇 초간 실측 스케일(m 단위) 추정이 아직 안정되지
// 않은 상태라, 이 시점에 바로 오브젝트를 배치하면 스케일이 재추정될 때마다 위치가 흔들려서
// "다가가면 오히려 멀어지는" 것처럼 보인다. 잠깐 스캔할 시간을 준 다음 배치한다.
const SCALE_SETTLE_MS = 3000;

const onxrloaded = () => {
  XR8.XrController.configure({ scale: 'absolute' }); // 실측(미터) 스케일 요청
  XR8.addCameraPipelineModule(XR8.XrController.pipelineModule());
  XR8.addCameraPipelineModule(distanceTrackerModule);

  trashHintEl.textContent = '천천히 주변을 비춰서 스캔해주세요...';
  warmupHands(); // 스캔 대기 시간에 묻혀서 사용자는 로딩 렉을 못 느끼게
  setTimeout(spawnIceItems, SCALE_SETTLE_MS);
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

// AR Scene: 쓰레기줍기 모드. 8th Wall World Tracking(SLAM)으로 실측 위치를 추적해서 사용자 주변에
// 3D 오브젝트(현재는 placeholder 큐브)를 배치하고, 사용자가 실제로 일정 거리 안까지 다가오면 그
// 오브젝트를 화면 앞에 고정(lock)시킨다. lock된 동안에만 XR8.CameraPixelArray로 카메라 프레임을
// 받아 MediaPipe Hands에 넘기고, 손바닥을 쓰다듬는 동작을 감지하면 그 오브젝트를 없앤다.
//
// 퍼즐 모드(이미지 트래킹 전용)와는 xrweb의 disableWorldTracking 설정이 정반대라 8th Wall 엔진
// 실행 중에는 못 바꾸므로 index.html과 별도 페이지로 분리돼 있다.

const backBtn = document.getElementById('back-btn');
const modePuzzleBtn = document.getElementById('mode-puzzle');
const trashRoot = document.getElementById('trash-root');
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
  lastPet: null,
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
    `pipeline:${debugState.pipelineStatus} cvActive:${debugState.cvActive} locked:${debugState.locked}\n` +
    `framesSent:${debugState.framesSent} resultsRecv:${debugState.resultsReceived} landmarks:${debugState.lastLandmarkCount}\n` +
    `pet:${debugState.lastPet ? JSON.stringify(debugState.lastPet) : '-'}\n` +
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
const TRASH_COUNT = 5;
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

let trashItems = []; // { el, worldPos: {x,y,z}, removed }
let lockedItem = null;
let removedCount = 0;

// TODO: BoxGeometry placeholder를 실제 쓰레기 3D 모델(glb 등)로 교체.
function spawnTrashItems() {
  for (let i = 0; i < TRASH_COUNT; i++) {
    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    const worldPos = {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: SPAWN_HEIGHT_OFFSET_M + radius * Math.sin(phi) * Math.sin(theta) * 0.4, // 세로 범위는 좀 좁게
      z: radius * Math.cos(phi),
    };

    const el = document.createElement('a-entity');
    el.setAttribute('geometry', 'primitive: box; width: 0.3; height: 0.3; depth: 0.3');
    el.setAttribute('material', 'color: #99cc66');
    el.setAttribute('position', `${worldPos.x} ${worldPos.y} ${worldPos.z}`);
    trashRoot.appendChild(el);

    trashItems.push({ el, worldPos, removed: false });
  }
  updateTrashCountText();
  trashHintEl.textContent = '쓰레기 쪽으로 다가가 보세요';
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function updateLock(camPos, camRot) {
  let forward;
  try {
    forward = new AFRAME.THREE.Vector3(0, 0, -1)
      .applyQuaternion(new AFRAME.THREE.Quaternion(camRot.x, camRot.y, camRot.z, camRot.w));
  } catch (e) {
    console.error('[trash] 카메라 방향 계산 실패', e);
    if (DEBUG) debugLog(`camera orientation failed: ${(e && e.message) || e}`);
    return;
  }

  if (!lockedItem) {
    // 순수 실측 거리만 보지 않고, "바라보고 있으면서 + 어느 정도 가까워졌는지"를 같이 본다.
    const candidate = trashItems.find((t) => {
      if (t.removed || dist(camPos, t.worldPos) >= LOCK_DISTANCE_M) return false;
      const toItem = new AFRAME.THREE.Vector3(
        t.worldPos.x - camPos.x, t.worldPos.y - camPos.y, t.worldPos.z - camPos.z,
      ).normalize();
      return toItem.dot(forward) >= LOCK_GAZE_DOT_THRESHOLD;
    });
    if (candidate) {
      lockedItem = candidate;
      trashHintEl.textContent = '쓰다듬어서 치워보세요';
      if (DEBUG) debugState.locked = true;
      onLockStart();
    }
    return;
  }

  // 멀어져도 락은 안 풀린다 — 쓰다듬어서 없애기 전까지는 계속 눈앞에 고정.
  lockedItem.el.object3D.position.set(
    camPos.x + forward.x * LOCK_FORWARD_OFFSET_M,
    camPos.y + forward.y * LOCK_FORWARD_OFFSET_M,
    camPos.z + forward.z * LOCK_FORWARD_OFFSET_M,
  );
}

function removeLockedItem() {
  if (!lockedItem) return;
  lockedItem.el.remove();
  lockedItem.removed = true;
  onLockEnd();
  lockedItem = null;
  removedCount++;
  updateTrashCountText();

  if (removedCount === TRASH_COUNT) {
    trashHintEl.textContent = '';
    trashFinishedEl.style.display = 'block';
  } else {
    trashHintEl.textContent = '쓰레기 쪽으로 다가가 보세요';
  }
}

function updateTrashCountText() {
  trashCountText.textContent = `${removedCount}/${TRASH_COUNT}`;
}

const distanceTrackerModule = {
  name: 'trash-distance-tracker',
  onUpdate: ({ processCpuResult }) => {
    if (!processCpuResult.reality) return;
    updateLock(processCpuResult.reality.position, processCpuResult.reality.rotation);
  },
};

// --- 쓰다듬기 감지 (기존 ar-scene 손 인식 모드와 동일한 순수 판정 로직) ---
// 손바닥 중앙(랜드마크 9번, 중지 뿌리)의 좌표를 최근 PET_HISTORY_MS만큼 기록해두고,
// 그 안에서 방향이 여러 번 바뀌면서도 좁은 범위 안에 머물러 있으면 "쓰다듬기"로 판정.
const PET_HISTORY_MS = 1500;
const PET_MIN_REVERSALS = 2;
const PET_MIN_MOVE = 0.005;
const PET_MAX_SPREAD = 0.3;
const PET_COOLDOWN_MS = 1000;

let petHistory = [];
let lastPetTime = 0;

function checkPetting(x, y, now) {
  petHistory.push({ x, y, t: now });
  petHistory = petHistory.filter((p) => now - p.t <= PET_HISTORY_MS);
  if (petHistory.length < 4) return false;

  let reversals = 0;
  let prevDir = 0;
  for (let i = 1; i < petHistory.length; i++) {
    const dx = petHistory[i].x - petHistory[i - 1].x;
    const dy = petHistory[i].y - petHistory[i - 1].y;
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(delta) < PET_MIN_MOVE) continue;
    const dir = delta > 0 ? 1 : -1;
    if (prevDir !== 0 && dir !== prevDir) reversals++;
    prevDir = dir;
  }

  const xs = petHistory.map((p) => p.x);
  const ys = petHistory.map((p) => p.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

  if (DEBUG) debugState.lastPet = { reversals, spread: Number(spread.toFixed(4)) };
  return reversals >= PET_MIN_REVERSALS && spread <= PET_MAX_SPREAD;
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
    petHistory = [];
    return;
  }

  for (const landmarks of results.multiHandLandmarks) {
    drawConnectors(handCtx, landmarks, HAND_CONNECTIONS, { color: '#2ea5ff', lineWidth: 3 });
    drawLandmarks(handCtx, landmarks, { color: '#ffffff', fillColor: '#2ea5ff', radius: 4 });
  }

  const palm = results.multiHandLandmarks[0][9];
  const now = performance.now();
  if (checkPetting(palm.x, palm.y, now) && now - lastPetTime > PET_COOLDOWN_MS) {
    lastPetTime = now;
    petHistory = [];
    removeLockedItem();
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

const cvModule = {
  name: 'trash-cv',
  onProcessCpu: ({ processGpuResult }) => {
    try {
      const cameraPixelArray = processGpuResult.camerapixelarray;
      if (!cameraPixelArray) return;
      const now = performance.now();
      if (now - lastHandsSendAt < MEDIAPIPE_MIN_INTERVAL_MS) return;
      lastHandsSendAt = now;
      hands.send({ image: pixelArrayToCanvas(cameraPixelArray) });
      if (DEBUG) debugState.framesSent++;
    } catch (e) {
      console.error('[trash] CameraPixelArray -> MediaPipe 프레임 전달 실패', e);
      debugLog(`send failed: ${(e && e.message) || e}`);
    }
  },
};

// XR8.CameraPixelArray는 락되기 전까지 한 번도 안 건드리는 API라, 실제 기기에서 처음
// 호출되는 시점(락 되는 순간)에야 문제가 드러날 수 있다 — 여기서 실패해도 손 인식만
// 못 하게 될 뿐, 거리 판정/락 자체(World Tracking)는 계속 정상 동작하도록 격리한다.
let cvActive = false;

function onLockStart() {
  if (DEBUG) { debugState.pipelineStatus = 'attempting'; debugLog('onLockStart: registering pipeline modules'); }
  try {
    XR8.addCameraPipelineModule(XR8.CameraPixelArray.pipelineModule({ luminance: false, maxDimension: 320 }));
    XR8.addCameraPipelineModule(cvModule);
    cvActive = true;
    if (DEBUG) { debugState.pipelineStatus = 'ok'; debugState.cvActive = true; debugLog('pipeline registered ok'); }
  } catch (e) {
    console.error('[trash] CameraPixelArray 파이프라인 모듈 등록 실패 — 쓰다듬기 인식 없이 진행', e);
    cvActive = false;
    if (DEBUG) { debugState.pipelineStatus = 'failed'; debugLog(`pipeline register failed: ${(e && e.message) || e}`); }
  }
}

function onLockEnd() {
  if (cvActive) {
    try {
      XR8.removeCameraPipelineModule('trash-cv');
      XR8.removeCameraPipelineModule('camerapixelarray');
    } catch (e) {
      console.error('[trash] CameraPixelArray 파이프라인 모듈 해제 실패', e);
      if (DEBUG) debugLog(`pipeline unregister failed: ${(e && e.message) || e}`);
    }
    cvActive = false;
  }
  if (DEBUG) { debugState.cvActive = false; debugState.locked = false; debugState.pipelineStatus = 'idle'; }
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  petHistory = [];
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
  setTimeout(spawnTrashItems, SCALE_SETTLE_MS);
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

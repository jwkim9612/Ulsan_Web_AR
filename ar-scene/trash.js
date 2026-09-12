// AR Scene: 얼음 깨고 장생이 구하기 모드. 8th Wall World Tracking(SLAM)으로 실측 위치를
// 추적해서 사용자 주변에 얼음 오브젝트(3D 모델, `assets/models/Ice.glb`)를 배치한다. 그 안에
// 들어있는 장생이 마스코트도 3D 모델(`assets/models/Jangsaengi.glb`)로 구현돼 있다. 사용자가
// 실제로 일정 거리 안까지 다가와 그 얼음을 잠깐 바라보면 "타겟팅"되는데(화면 정면으로 옮겨지지
// 않고 제자리에서 파티클 이펙트+살짝 커지는 것으로만 표시됨), 타겟팅된 동안에만
// XR8.CameraPixelArray로 카메라 프레임을 받아 MediaPipe Hands에 넘긴다. 손을 화면 중앙(잡기
// 존)에 잠깐 유지하면 "잡기"로 인정되고, 잡은 채로 손을 흔들면 얼음이 깨지면서(이펙트 재생)
// 장생이가 구조된다.
//
// 두 모델의 스케일/피벗은 만든 툴마다 제각각일 수 있어서, `fitLoadedModel`이 로드된 실제
// 바운딩 박스를 기준으로 목표 크기에 맞게 자동 스케일하고 중심을 맞춰준다 — 모델을 다시
// 내보내도 코드 수정 없이 항상 일관된 크기로 보인다.
//
// 퍼즐 모드(index.html)도 동일하게 월드 트래킹을 쓰지만, 페이지는 여전히 분리돼 있다.

const backBtn = document.getElementById('back-btn');
const trashRoot = document.getElementById('trash-root');
const cameraEl = document.querySelector('a-camera');
const trashCountText = document.getElementById('trash-count-text');
const trashHintEl = document.getElementById('trash-hint');
const statusPillEl = document.getElementById('status-pill');
const completeOverlayEl = document.getElementById('complete-overlay');
const handCanvas = document.getElementById('hand-canvas');

// 미리보기용: trash.html?preview=complete 로 접속하면 게임 진행 없이 완료 화면부터 바로 보임.
if (new URLSearchParams(location.search).get('preview') === 'complete') {
  completeOverlayEl.style.display = 'block';
}
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
  SFX.navigate('scan.html');
});

function resizeHandCanvas() {
  handCanvas.width = window.innerWidth;
  handCanvas.height = window.innerHeight;
}
resizeHandCanvas();
window.addEventListener('resize', resizeHandCanvas);

// --- 오브젝트 배치 및 거리/응시 판정 ---
const RESCUE_COUNT = 3; // 이만큼 깨면 완료(스폰 개수와는 별개)
const SPAWN_COUNT = 5; // 실제로 주변에 흩뿌리는 얼음 개수 — 완료 조건보다 여유 있게 둬서 못 찾은 몇 개는 못 깨도 끝날 수 있게
const SPAWN_MIN_M = 1.2;
const SPAWN_MAX_M = 3.0; // 카메라 시작 위치(원점) 기준 구면좌표, 실측 미터. 스케일 추정 오차가
                          // 거리에 비례해서 커지므로 너무 멀리 두면 "가까워져도 거리가 안 줄어드는"
                          // 오브젝트가 생길 수 있어 범위를 좁게 잡음.
const LOCK_DISTANCE_M = 2.0; // 이 거리 안이면서 아래 각도 조건도 만족해야 타겟팅됨 (순수 실측
                              // 거리만 보면 스케일 오차 때문에 절대 안 가까워지는 오브젝트가 생길
                              // 수 있어서, "바라보고 있는지"를 같이 봐서 느슨하게 함)
const LOCK_GAZE_DOT_THRESHOLD = 0.85; // 화면 중앙 쪽으로 바라보고 있어야 함(약 32도 이내)
const LOCK_DWELL_MS = 1000; // 거리+응시 조건을 이만큼 계속 유지해야 실제로 타겟팅됨(스치듯 지나가는 것 방지)
const SPAWN_HEIGHT_OFFSET_M = 0.9; // 눈높이(카메라) 기준 이만큼 위로 띄워서 배치

// 단안 카메라 SLAM은 실측 스케일 추정이 트래킹 도중에도 계속 재조정될 수 있어서, 스폰 때는
// SPAWN_MAX_M 안에 있던 얼음이 나중에 스케일이 커지는 쪽으로 재추정되면 실제로 훨씬 멀게
// 느껴질 수 있다("아무리 걸어가도 안 가까워짐"). 이 거리보다 멀어지면 지금 서 있는 위치
// 기준으로 가까이 다시 배치해서 너무 멀리 나가는 걸 막는다.
const MAX_DRIFT_DISTANCE_M = SPAWN_MAX_M * 2;

const TARGETED_ICE_SCALE = 1.12; // 타겟팅되면 얼음이 이만큼 커짐(위치는 그대로, 제자리에서 강조만)
const GRABBED_ICE_SCALE = 1.3; // 잡으면 타겟팅 상태보다 한 단계 더 커져서 "쥐었다"는 게 구분됨

let iceItems = []; // { el, iceEl, mascotEl, worldPos, grabbed, removed }
let lockedItem = null;
let rescuedCount = 0;
let lockCandidate = null; // 거리+응시 조건을 만족하기 시작한 얼음(아직 확정 lock 전)
let lockCandidateStartedAt = null;

const ICE_MODEL_URL = '../assets/models/Ice.glb';
const ICE_MODEL_TARGET_SIZE_M = 0.45; // 모델의 가장 긴 변이 대략 이 크기가 되도록 자동 스케일

const MASCOT_MODEL_URL = '../assets/models/Jangsaengi.glb';
const MASCOT_MODEL_TARGET_SIZE_M = 0.2; // 얼음(0.35m)보다 한 단계 작게 — 얼음 속에 들어있는 느낌

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
    // Box3.setFromObject()는 월드 좌표 기준 중심을 주지만 mesh.position은 부모(el) 기준
    // 로컬 좌표라, wrapper가 이미 스폰 위치로 이동해 있으면 그 월드 이동값이 그대로 섞여
    // 들어와 모델이 스폰 지점(=targetFx 위치)에서 밀려난다. 부모 로컬 좌표로 변환해서 상쇄한다.
    const localCenter = mesh.parent.worldToLocal(center);
    mesh.position.sub(localCenter.multiplyScalar(scale));
  });
}

// 타겟팅 표시: gltf-model(iceEl)은 material 컴포넌트를 안 써서 색을 바꿀 수 없으므로, 그림/텍스처
// 없이 기본 도형만으로 얼음 주위를 도는 파티클 + 은은한 발광 구체를 만들어 "지금 이 얼음이
// 타겟됨"을 표시한다. 평소엔 숨겨뒀다가 타겟팅되는 순간 visible: true로 켠다.
const TARGET_FX_PARTICLE_COUNT = 4;
const TARGET_FX_ORBIT_RADIUS_M = 0.32;
const TARGET_FX_COLOR = '#7ee8ff';

function createTargetFx() {
  const fx = document.createElement('a-entity');
  fx.setAttribute('visible', false);
  fx.setAttribute('animation__spin', 'property: rotation; to: 0 360 0; loop: true; dur: 2200; easing: linear');

  const halo = document.createElement('a-entity');
  halo.setAttribute('geometry', 'primitive: sphere; radius: 0.28; segmentsWidth: 12; segmentsHeight: 8');
  halo.setAttribute('material', `color: ${TARGET_FX_COLOR}; shader: flat; opacity: 0.16; transparent: true; side: double`);
  halo.setAttribute('animation__pulse', 'property: scale; from: 0.9 0.9 0.9; to: 1.15 1.15 1.15; dir: alternate; loop: true; dur: 900; easing: easeInOutSine');
  fx.appendChild(halo);

  for (let p = 0; p < TARGET_FX_PARTICLE_COUNT; p++) {
    const angle = (p / TARGET_FX_PARTICLE_COUNT) * Math.PI * 2;
    const dot = document.createElement('a-entity');
    dot.setAttribute('geometry', 'primitive: sphere; radius: 0.025; segmentsWidth: 8; segmentsHeight: 6');
    dot.setAttribute('material', `color: ${TARGET_FX_COLOR}; shader: flat; opacity: 0.9; transparent: true`);
    dot.setAttribute('position', `${Math.cos(angle) * TARGET_FX_ORBIT_RADIUS_M} 0 ${Math.sin(angle) * TARGET_FX_ORBIT_RADIUS_M}`);
    fx.appendChild(dot);
  }

  return fx;
}

function spawnIceItems() {
  // 스폰 시점의 실제 카메라 위치를 원점으로 삼는다(스캔 대기 없이 바로 부르므로 "지금 서 있는
  // 자리" 기준 360도 배치가 됨). 아직 트래킹 포즈를 못 읽은 극초반이면 (0,0,0)으로 대체.
  const pose = getCameraPose();
  const origin = pose ? pose.camPos : { x: 0, y: 0, z: 0 };

  const sector = (Math.PI * 2) / SPAWN_COUNT;
  for (let i = 0; i < SPAWN_COUNT; i++) {
    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    // 완전 랜덤 각도 대신 방위각을 SPAWN_COUNT개 구간으로 나눠 그 안에서만 무작위로 잡는다 —
    // 순수 랜덤이면 우연히 여러 개가 한쪽에 몰릴 수 있는데, 이렇게 하면 사용자 주변에 고르게 흩어짐.
    const theta = sector * i + Math.random() * sector;
    const phi = Math.acos((Math.random() * 2) - 1);
    const worldPos = {
      x: origin.x + radius * Math.sin(phi) * Math.cos(theta),
      y: origin.y + SPAWN_HEIGHT_OFFSET_M + radius * Math.sin(phi) * Math.sin(theta) * 0.4, // 세로 범위는 좀 좁게
      z: origin.z + radius * Math.cos(phi),
    };

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('position', `${worldPos.x} ${worldPos.y} ${worldPos.z}`);

    const iceEl = document.createElement('a-entity');
    iceEl.setAttribute('gltf-model', `url(${ICE_MODEL_URL})`);
    fitLoadedModel(iceEl, ICE_MODEL_TARGET_SIZE_M);
    wrapper.appendChild(iceEl);

    const mascotEl = document.createElement('a-entity');
    mascotEl.setAttribute('gltf-model', `url(${MASCOT_MODEL_URL})`);
    fitLoadedModel(mascotEl, MASCOT_MODEL_TARGET_SIZE_M);
    mascotEl.setAttribute('visible', false); // 깨지기 전까지는 숨김
    wrapper.appendChild(mascotEl);

    const targetFx = createTargetFx();
    wrapper.appendChild(targetFx);

    trashRoot.appendChild(wrapper);

    iceItems.push({
      el: wrapper, iceEl, mascotEl, targetFx, worldPos, grabbed: false, removed: false,
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
function getCameraPose() {
  try {
    const camPos = new AFRAME.THREE.Vector3();
    const camQuat = new AFRAME.THREE.Quaternion();
    cameraEl.object3D.getWorldPosition(camPos);
    cameraEl.object3D.getWorldQuaternion(camQuat);
    const forward = new AFRAME.THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    return { camPos, forward };
  } catch (e) {
    console.error('[ice] 카메라 위치/방향 계산 실패', e);
    if (DEBUG) debugLog(`camera pose failed: ${(e && e.message) || e}`);
    return null;
  }
}

// 스폰 후 스케일 재추정 등으로 너무 멀어진 얼음을 지금 서 있는 위치 기준으로 다시 배치한다.
// 이미 타겟팅(lock)된 얼음은 상호작용 도중일 수 있으니 건드리지 않는다.
function reclampFarIceItems(camPos) {
  iceItems.forEach((t) => {
    if (t.removed || t === lockedItem) return;
    if (dist(camPos, t.worldPos) <= MAX_DRIFT_DISTANCE_M) return;

    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    t.worldPos = {
      x: camPos.x + radius * Math.sin(phi) * Math.cos(theta),
      y: camPos.y + SPAWN_HEIGHT_OFFSET_M + radius * Math.sin(phi) * Math.sin(theta) * 0.4,
      z: camPos.z + radius * Math.cos(phi),
    };
    t.el.setAttribute('position', `${t.worldPos.x} ${t.worldPos.y} ${t.worldPos.z}`);
  });
}

// 예전에는 타겟팅(lock)되면 얼음을 카메라 정면 고정 거리로 "순간이동"시켰는데, 사용자 요청으로
// 그 방식은 없앴다. 이제 얼음은 스폰된 실제 위치에 계속 그대로 있고, 타겟팅되면(onLockStart)
// 그 자리에서 파티클 이펙트(targetFx)가 뜨고 살짝 커지는(TARGETED_ICE_SCALE) 것으로만 표시한다.
// 그래서 이미 타겟팅된 뒤에는 매 프레임 할 일이 없어 바로 리턴한다.
function updateLock() {
  if (lockedItem) return;

  const pose = getCameraPose();
  if (!pose) return;
  const { camPos, forward } = pose;

  reclampFarIceItems(camPos);

  // 순수 실측 거리만 보지 않고, "바라보고 있으면서 + 어느 정도 가까워졌는지"를 같이 본다.
  const candidate = iceItems.find((t) => {
    if (t.removed || dist(camPos, t.worldPos) >= LOCK_DISTANCE_M) return false;
    const toItem = new AFRAME.THREE.Vector3(
      t.worldPos.x - camPos.x, t.worldPos.y - camPos.y, t.worldPos.z - camPos.z,
    ).normalize();
    return toItem.dot(forward) >= LOCK_GAZE_DOT_THRESHOLD;
  });

  // 조건을 만족하는 순간 바로 타겟팅하지 않고, LOCK_DWELL_MS만큼 그 얼음을 계속 바라보고
  // 있어야 확정한다 — 스쳐 지나가듯 잠깐 조건을 만족한 것만으로 타겟팅되는 걸 막기 위함.
  if (candidate !== lockCandidate) {
    lockCandidate = candidate || null;
    lockCandidateStartedAt = candidate ? performance.now() : null;
    return;
  }
  if (!candidate) return;
  if (performance.now() - lockCandidateStartedAt < LOCK_DWELL_MS) return;

  lockedItem = candidate;
  lockedItem.grabbed = false;
  lockCandidate = null;
  lockCandidateStartedAt = null;
  grabDwellStartedAt = null;
  shakeHistory = [];
  lockedItem.targetFx.setAttribute('visible', true);
  lockedItem.iceEl.setAttribute('scale', `${TARGETED_ICE_SCALE} ${TARGETED_ICE_SCALE} ${TARGETED_ICE_SCALE}`);
  trashHintEl.textContent = '손을 뻗어 얼음을 잡아보세요';
  if (DEBUG) debugState.locked = true;
  onLockStart();
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
// 얼음은 이제 실제 스폰 위치에 그대로 있고 화면 정면으로 순간이동하지 않으므로, 잡으려면 타겟팅된
// 얼음이 보이는 방향으로 카메라를 든 채 손을 화면 중앙(잡기 존)으로 뻗어야 한다 — 실제로 눈앞의
// 얼음을 향해 손을 뻗는 느낌에 더 가까워짐. 판정 자체는 손 랜드마크의 정규화 좌표(0~1)가 화면
// 중앙 근처에 있는지만 본다(얼음과의 화면상 정확한 겹침까지는 계산하지 않는 단순화).
const GRAB_ZONE_MIN = 0.35;
const GRAB_ZONE_MAX = 0.65;
const GRAB_DWELL_MS = 400; // 이 시간만큼 잡기 존 안에 머물러야 "잡기"로 인정(실수 방지)

let grabDwellStartedAt = null;

// gltf-model은 A-Frame의 material 컴포넌트로 색을 바꿀 수 없어서(모델 자체 재질을 쓰므로),
// 잡았을 때 피드백은 스케일 변화로만 표현한다. 타겟팅 상태(TARGETED_ICE_SCALE)보다 한 단계 더
// 커져서(GRABBED_ICE_SCALE) "쥐었다"는 게 구분된다. 한 번 잡으면(grabbed=true) 손이 잡기 존을
// 벗어나도 "놓은 것"으로 되돌리지 않고 계속 흔들기 판정으로 넘어간다 — 깨는 도중 손이 살짝
// 존을 벗어났다고 다시 잡기부터 시작해야 하면 답답하기 때문.
function onGrab(item) {
  item.grabbed = true;
  item.iceEl.setAttribute('scale', `${GRABBED_ICE_SCALE} ${GRABBED_ICE_SCALE} ${GRABBED_ICE_SCALE}`);
  trashHintEl.textContent = '손을 흔들어서 얼음을 깨보세요!';
  if (DEBUG) debugLog('grab: item grabbed');
}

// --- 흔들기(shake) 판정 (기존 ar-scene 손 인식 모드의 쓰다듬기 판정과 같은 원리) ---
// 손바닥 중앙(랜드마크 9번, 중지 뿌리)의 좌표를 최근 SHAKE_HISTORY_MS만큼 기록해두고,
// 그 안에서 방향이 여러 번 바뀌면 "흔들기"로 판정. 쓰다듬기보다 더 크고 빠른 움직임을
// 기대하는 동작이라 허용 진폭(SHAKE_MAX_SPREAD)과 최소 이동량(SHAKE_MIN_MOVE)을 더 크게 잡음.
const SHAKE_HISTORY_MS = 900;
const SHAKE_MIN_REVERSALS = 2;
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
const FINISH_DELAY_MS = 2000; // 마지막 얼음이 깨진 뒤 이만큼 더 지나서 완료 화면을 띄움
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

// 목표(RESCUE_COUNT)를 다 채우면, 스폰됐지만 아직 못 깬 나머지 얼음은 그냥 없앤다.
function despawnRemainingIce() {
  for (const other of iceItems) {
    if (other.removed) continue;
    other.removed = true;
    other.el.setAttribute(
      'animation__despawn',
      `property: scale; to: 0.001 0.001 0.001; dur: ${BREAK_EFFECT_MS}; easing: easeInQuad`,
    );
    setTimeout(() => other.el.remove(), BREAK_EFFECT_MS + 50);
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
  // gltf-model 엔티티는 A-Frame의 material 컴포넌트를 쓰지 않아 material.opacity 애니메이션이
  // 안 먹는다(244/251줄 grab 피드백이 scale을 쓰는 것과 같은 이유) — 대신 scale을 0으로 줄여서 사라지게 한다.
  item.mascotEl.setAttribute(
    'animation__escape-fade',
    `property: scale; to: 0.001 0.001 0.001; delay: ${Math.round(BREAK_EFFECT_MS * 0.4)}; dur: ${Math.round(BREAK_EFFECT_MS * 0.6)}; easing: easeInQuad`,
  );

  setTimeout(() => {
    item.el.remove();
  }, BREAK_EFFECT_MS + 50);

  rescuedCount++;
  updateTrashCountText();

  if (rescuedCount === RESCUE_COUNT) {
    despawnRemainingIce();
    trashHintEl.textContent = '';
    statusPillEl.textContent = '미션 완료';
    SFX.playThenLoop('ice_success', 'complete_bgm_loop');
    setTimeout(() => {
      completeOverlayEl.style.display = 'block';
    }, BREAK_EFFECT_MS + FINISH_DELAY_MS);
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

  // 손 뼈대(랜드마크) 시각화 — 사용자 요청으로 잠시 꺼둠(필요하면 주석 해제해서 다시 켤 것).
  // for (const landmarks of results.multiHandLandmarks) {
  //   drawConnectors(handCtx, landmarks, HAND_CONNECTIONS, { color: '#2ea5ff', lineWidth: 3 });
  //   drawLandmarks(handCtx, landmarks, { color: '#ffffff', fillColor: '#2ea5ff', radius: 4 });
  // }

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

  // 이미 잡은 상태면 잡기 존을 벗어나도 놓은 것으로 취급하지 않고 그대로 흔들기 판정으로 넘어간다.
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
// 미뤄두면 사용자가 처음 손을 뻗으려는 바로 그 순간 로딩 렉을 그대로 겪게 되므로, 씬 시작
// 시점에 더미 프레임을 한 번 보내 미리 로딩해둔다.
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
// 참고: 단안 카메라 기반 SLAM은 트래킹 시작 직후 몇 초간 실측 스케일(m 단위) 추정이 아직
// 안정되지 않은 상태라, 스캔 대기 없이 바로 배치하면 스케일이 재추정될 때마다 위치가 흔들려서
// "다가가면 오히려 멀어지는" 것처럼 보일 수 있다(사용자 요청으로 스캔 대기 단계를 제거함).
const onxrloaded = () => {
  XR8.XrController.configure({ scale: 'absolute' }); // 실측(미터) 스케일 요청
  XR8.addCameraPipelineModule(XR8.XrController.pipelineModule());
  XR8.addCameraPipelineModule(distanceTrackerModule);

  warmupHands();
  spawnIceItems();
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

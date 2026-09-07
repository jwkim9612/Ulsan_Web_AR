// AR Scene: 퍼즐 모드. 8th Wall World Tracking(SLAM)으로 실측 위치를 추적해서 사용자 주변에
// 퍼즐 조각 오브젝트 4개(조각 이미지를 입힌 평면)를 배치하고, 사용자가 실제로 일정 거리 안까지
// 다가가서 그 오브젝트 쪽을 바라본 채로 DWELL_MS(2초)를 유지하면 조각을 채운다. 화면 중앙 2x2
// 그리드가 하나씩 채워지고, 4개를 다 모으면 완성 이미지가 화면에 표시된다.
// 쓰레기줍기 모드도 동일하게 월드 트래킹을 쓰지만, 페이지는 여전히 분리되어 있다(trash.html).

const PIECE_NAMES = ['p_1', 'p_2', 'p_3', 'p_4'];
const PIECE_IMAGES = PIECE_NAMES.map((name) => `../assets/images/${name}.png`);
const FINISHED_IMAGE = '../assets/images/1.png';

const backBtn = document.getElementById('back-btn');
const modeTrashBtn = document.getElementById('mode-trash');
const puzzleHud = document.getElementById('puzzle-hud');
const puzzleFinishedEl = document.getElementById('puzzle-finished');

// 다 맞춘 순간에 src를 지정하면 디코딩 지연으로 살짝 깜빡여 보임 —
// 미리 받아서 decode()까지 끝내둔 다음, 필요할 때는 display만 바꾼다.
puzzleFinishedEl.src = FINISHED_IMAGE;
puzzleFinishedEl.decode().catch(() => {});

backBtn.addEventListener('click', () => {
  location.href = '../index.html';
});
modeTrashBtn.addEventListener('click', () => {
  location.href = 'trash.html';
});

const collectedPieces = new Set();

function collectPiece(targetIndex) {
  if (collectedPieces.has(targetIndex)) return;
  collectedPieces.add(targetIndex);

  const slot = document.getElementById(`puzzle-slot-${targetIndex}`);
  slot.classList.add('collected');

  if (collectedPieces.size === PIECE_NAMES.length) {
    showPuzzleFinished();
  }
}

function showPuzzleFinished() {
  puzzleHud.style.display = 'none';
  puzzleFinishedEl.style.display = 'block';
}

PIECE_NAMES.forEach((name, targetIndex) => {
  const slot = document.getElementById(`puzzle-slot-${targetIndex}`);
  slot.style.backgroundImage = `url(${PIECE_IMAGES[targetIndex]})`;
});

// --- 오브젝트 배치 및 거리/응시 판정 (ar-scene/trash.js의 스폰/판정 로직 참고) ---
const puzzleTargetsRoot = document.getElementById('puzzle-targets-root');

const SPAWN_MIN_M = 1.5;
const SPAWN_MAX_M = 4.5; // 카메라 시작 위치(원점) 기준 구면좌표, 실측 미터.
const SPAWN_HEIGHT_OFFSET_M = 0.9; // 눈높이(카메라) 기준 이만큼 위로 띄워서 배치
const COLLECT_DISTANCE_M = 3.0; // 이 거리 안이면서 아래 각도 조건도 만족해야 조각을 채움
const COLLECT_GAZE_DOT_THRESHOLD = 0.85; // 화면 중앙 쪽으로 바라보고 있어야 함(약 32도 이내)
const DWELL_MS = 2000; // 거리+응시 조건을 이만큼 끊기지 않고 유지해야 조각을 채움

const RING_RADIUS_INNER = 0.24;
const RING_RADIUS_OUTER = 0.3;

let puzzleTargets = []; // { el, worldPos, index, collected, gazeStartedAt }

// TODO: plane placeholder를 실제 조각 3D 모델(glb 등)로 교체 가능.
function spawnPuzzleTargets() {
  PIECE_NAMES.forEach((name, index) => {
    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    const worldPos = {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: SPAWN_HEIGHT_OFFSET_M + radius * Math.sin(phi) * Math.sin(theta) * 0.4, // 세로 범위는 좀 좁게
      z: radius * Math.cos(phi),
    };

    const el = document.createElement('a-entity');
    el.setAttribute('geometry', 'primitive: plane; width: 0.4; height: 0.4');
    el.setAttribute('material', `src: ${PIECE_IMAGES[index]}; side: double`);
    el.setAttribute('position', `${worldPos.x} ${worldPos.y} ${worldPos.z}`);
    // 대기 중 눈에 잘 띄도록 위아래로 천천히 부유.
    el.setAttribute(
      'animation__float',
      `property: position.y; from: ${worldPos.y}; to: ${worldPos.y + 0.08}; dir: alternate; dur: 1500; loop: true; easing: easeInOutSine`,
    );

    // 은은하게 빛나는 후광(글로우) — 조각보다 살짝 크게, 뒤쪽에 배치하고 밝기를 펄스.
    const glow = document.createElement('a-entity');
    glow.setAttribute('geometry', 'primitive: plane; width: 0.55; height: 0.55');
    glow.setAttribute('material', 'color: #7CFFF0; shader: flat; transparent: true; opacity: 0.25; side: double; blending: additive');
    glow.setAttribute('position', '0 0 -0.01');
    glow.setAttribute(
      'animation__pulse',
      'property: material.opacity; from: 0.15; to: 0.45; dir: alternate; dur: 1200; loop: true; easing: easeInOutSine',
    );
    el.appendChild(glow);

    // 응시 진행률 링 — 거리+응시 조건을 만족하는 동안만 보이고, DWELL_MS 대비 진행률만큼 채워짐.
    const ring = document.createElement('a-entity');
    ring.setAttribute('geometry', `primitive: ring; radiusInner: ${RING_RADIUS_INNER}; radiusOuter: ${RING_RADIUS_OUTER}; thetaStart: 0; thetaLength: 0`);
    ring.setAttribute('material', 'color: #FFD400; shader: flat; transparent: true; opacity: 0.9; side: double');
    ring.setAttribute('position', '0 0 0.01');
    ring.setAttribute('visible', false);
    el.appendChild(ring);

    puzzleTargets.push({
      el, worldPos, index, collected: false, gazeStartedAt: null, ringEl: ring,
    });
  });
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// 조각 이미지가 항상 잘 보이도록, 수직 기울임 없이(Y축 기준) 카메라 쪽을 바라보게 매 프레임 회전.
// plane 정면(+Z)이 카메라를 향하도록 lookAt(-Z가 타겟을 보게 함) 후 180도 뒤집는다.
function faceCamera(t, camPos) {
  const lookTarget = new AFRAME.THREE.Vector3(camPos.x, t.worldPos.y, camPos.z);
  t.el.object3D.lookAt(lookTarget);
  t.el.object3D.rotateY(Math.PI);
}

function checkProximity(camPos, camRot) {
  let forward;
  try {
    forward = new AFRAME.THREE.Vector3(0, 0, -1)
      .applyQuaternion(new AFRAME.THREE.Quaternion(camRot.x, camRot.y, camRot.z, camRot.w));
  } catch (e) {
    console.error('[puzzle] 카메라 방향 계산 실패', e);
    return;
  }

  const now = performance.now();

  puzzleTargets.forEach((t) => {
    if (t.collected) return;
    faceCamera(t, camPos);

    let gazing = false;
    if (dist(camPos, t.worldPos) < COLLECT_DISTANCE_M) {
      const toTarget = new AFRAME.THREE.Vector3(
        t.worldPos.x - camPos.x, t.worldPos.y - camPos.y, t.worldPos.z - camPos.z,
      ).normalize();
      gazing = toTarget.dot(forward) >= COLLECT_GAZE_DOT_THRESHOLD;
    }

    if (!gazing) {
      t.gazeStartedAt = null;
      t.ringEl.setAttribute('visible', false);
      return;
    }
    if (t.gazeStartedAt === null) {
      t.gazeStartedAt = now;
    }

    const progress = Math.min(1, (now - t.gazeStartedAt) / DWELL_MS);
    t.ringEl.setAttribute('visible', true);
    t.ringEl.setAttribute('geometry', 'thetaLength', progress * 360);

    if (progress < 1) return;

    t.collected = true;
    t.el.remove();
    collectPiece(t.index);
  });
}

const distanceTrackerModule = {
  name: 'puzzle-distance-tracker',
  onUpdate: ({ processCpuResult }) => {
    if (!processCpuResult.reality) return;
    checkProximity(processCpuResult.reality.position, processCpuResult.reality.rotation);
  },
};

// --- 초기화 ---
// 단안 카메라 기반 SLAM은 트래킹 시작 직후 몇 초간 실측 스케일(m 단위) 추정이 아직 안정되지
// 않은 상태라, 이 시점에 바로 오브젝트를 배치하면 스케일이 재추정될 때마다 위치가 흔들려서
// "다가가면 오히려 멀어지는" 것처럼 보인다. 잠깐 스캔할 시간을 준 다음 배치한다.
const SCALE_SETTLE_MS = 3000;

const onxrloaded = () => {
  XR8.XrController.configure({ scale: 'absolute' }); // 실측(미터) 스케일 요청
  XR8.addCameraPipelineModule(XR8.XrController.pipelineModule());
  XR8.addCameraPipelineModule(distanceTrackerModule);

  setTimeout(spawnPuzzleTargets, SCALE_SETTLE_MS);
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

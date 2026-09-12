// AR Scene: 퍼즐 모드. 8th Wall World Tracking(SLAM)으로 실측 위치를 추적해서 사용자 주변에
// 퍼즐 조각 오브젝트 4개(조각 이미지를 입힌 평면)를 배치하고, 사용자가 실제로 일정 거리 안까지
// 다가가서 그 오브젝트 쪽을 바라본 채로 DWELL_MS(1초)를 유지하면 조각을 채운다. 화면 중앙 2x2
// 그리드가 하나씩 채워지고, 4개를 다 모으면 완성 이미지가 화면에 표시된다.
// 고래구조 모드도 동일하게 월드 트래킹을 쓰지만, 페이지는 여전히 분리되어 있다(trash.html).

const PIECE_NAMES = ['p_1', 'p_2', 'p_3', 'p_4'];
const PIECE_IMAGES = PIECE_NAMES.map((name) => `../assets/images/${name}.png`);
const FINISH_DELAY_MS = 2000; // 마지막 조각을 모으고 이만큼 뒤에 완료 화면을 띄움

const backBtn = document.getElementById('back-btn');
const puzzleHud = document.getElementById('puzzle-hud');
const puzzleHintEl = document.getElementById('puzzle-hint');
const statusPillEl = document.getElementById('status-pill');
const completeOverlayEl = document.getElementById('complete-overlay');

backBtn.addEventListener('click', () => {
  location.href = 'scan.html';
});

const collectedPieces = new Set();

function collectPiece(targetIndex) {
  if (collectedPieces.has(targetIndex)) return;
  collectedPieces.add(targetIndex);

  const slot = document.getElementById(`puzzle-slot-${targetIndex}`);
  slot.classList.add('collected');

  if (collectedPieces.size === PIECE_NAMES.length) {
    showPuzzleFinished();
  } else {
    puzzleHintEl.textContent = '다음 조각을 찾아 다가가 보세요';
  }
}

function showPuzzleFinished() {
  puzzleHud.style.display = 'none';
  puzzleHintEl.textContent = '';
  statusPillEl.textContent = '미션 완료';

  setTimeout(() => {
    completeOverlayEl.style.display = 'block';
  }, FINISH_DELAY_MS);
}

PIECE_NAMES.forEach((name, targetIndex) => {
  const slot = document.getElementById(`puzzle-slot-${targetIndex}`);
  slot.style.backgroundImage = `url(${PIECE_IMAGES[targetIndex]})`;
});

// --- 오브젝트 배치 및 거리/응시 판정 (ar-scene/trash.js의 스폰/판정 로직 참고) ---
const puzzleTargetsRoot = document.getElementById('puzzle-targets-root');

const SPAWN_MIN_M = 1.5;
const SPAWN_MAX_M = 4.5; // 카메라 시작 위치(원점) 기준 원형 배치, 실측 미터.
const SPAWN_HEIGHT_OFFSET_M = 0.9; // 눈높이(카메라) 기준 이만큼 위로 띄워서 배치
const SPAWN_HEIGHT_VARIATION_M = 0.3; // 위 오프셋 기준 위아래로 이만큼까지 무작위 높낮이
const COLLECT_DISTANCE_M = 3.0; // 이 거리 안이면서 아래 각도 조건도 만족해야 조각을 채움
const COLLECT_GAZE_DOT_THRESHOLD = 0.85; // 화면 중앙 쪽으로 바라보고 있어야 함(약 32도 이내)
const DWELL_MS = 1000; // 거리+응시 조건을 이만큼 끊기지 않고 유지해야 조각을 채움

// 단안 카메라 SLAM은 실측 스케일 추정이 트래킹 도중에도 계속 재조정될 수 있어서, 스폰 때는
// SPAWN_MAX_M 안에 있던 조각이 나중에 스케일이 커지는 쪽으로 재추정되면 실제로 훨씬 멀게
// 느껴질 수 있다("아무리 걸어가도 안 가까워짐"). 이 거리보다 멀어지면 지금 서 있는 위치
// 기준으로 가까이 다시 배치해서 너무 멀리 나가는 걸 막는다.
const MAX_DRIFT_DISTANCE_M = SPAWN_MAX_M * 2;

let puzzleTargets = []; // { el, worldPos, index, collected, gazeStartedAt }

// TODO: plane placeholder를 실제 조각 3D 모델(glb 등)로 교체 가능.
//
// 조각별로 각도를 완전히 독립적으로 무작위 추출하면(예전 방식) n=4처럼 표본이 적을 때
// 우연히 비슷한 방향에 몰릴 수 있다. 360도를 조각 수만큼 구역(섹터)으로 나눠 조각마다
// 자기 구역 안에서만 각도를 무작위로 정해서 서로 겹치지 않게 최소 각도 차이를 보장한다.
function spawnPuzzleTargets() {
  const sectorAngle = (Math.PI * 2) / PIECE_NAMES.length;
  // 매 판마다 배치 방향 자체를 통째로 돌려서, 항상 같은 방향(예: 정북)에 조각이 나오지 않게 함.
  const layoutRotation = Math.random() * Math.PI * 2;

  PIECE_NAMES.forEach((name, index) => {
    const angle = layoutRotation + sectorAngle * (index + 0.5)
      + (Math.random() * 2 - 1) * sectorAngle * 0.3;
    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    const worldPos = {
      x: radius * Math.cos(angle),
      y: SPAWN_HEIGHT_OFFSET_M + (Math.random() * 2 - 1) * SPAWN_HEIGHT_VARIATION_M,
      z: radius * Math.sin(angle),
    };

    const el = document.createElement('a-entity');
    el.setAttribute('geometry', 'primitive: plane; width: 0.4; height: 0.4');
    el.setAttribute('material', `src: ${PIECE_IMAGES[index]}; side: double`);
    el.setAttribute('position', `${worldPos.x} ${worldPos.y} ${worldPos.z}`);
    puzzleTargetsRoot.appendChild(el);

    puzzleTargets.push({
      el, worldPos, index, collected: false, gazeStartedAt: null,
    });
  });

  puzzleHintEl.textContent = '조각이 있는 곳으로 다가가 바라보세요!';
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// 조각 이미지가 항상 잘 보이도록, 수직 기울임 없이(Y축 기준) 카메라 쪽을 바라보게 매 프레임 회전.
// 카메라와 달리 일반 오브젝트(mesh)의 lookAt()은 로컬 +Z축이 타겟을 향하게 만든다 — plane의
// 정면도 원래 +Z라서 lookAt()만으로 이미 정면이 카메라를 향한다. (여기에 180도를 더 돌리면
// 정면이 반대로 돌아가 뒷면이 보이는데, side:double이라 뒷면도 렌더링은 되지만 같은 텍스처가
// 좌우반전으로 보이게 된다 — 실제로 겪었던 버그.)
function faceCamera(t, camPos) {
  const lookTarget = new AFRAME.THREE.Vector3(camPos.x, t.worldPos.y, camPos.z);
  t.el.object3D.lookAt(lookTarget);
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

    if (dist(camPos, t.worldPos) > MAX_DRIFT_DISTANCE_M) {
      const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
      const angle = Math.random() * Math.PI * 2;
      t.worldPos = {
        x: camPos.x + radius * Math.cos(angle),
        y: camPos.y + SPAWN_HEIGHT_OFFSET_M + (Math.random() * 2 - 1) * SPAWN_HEIGHT_VARIATION_M,
        z: camPos.z + radius * Math.sin(angle),
      };
      t.el.setAttribute('position', `${t.worldPos.x} ${t.worldPos.y} ${t.worldPos.z}`);
      t.gazeStartedAt = null;
      return;
    }

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
      return;
    }
    if (t.gazeStartedAt === null) {
      t.gazeStartedAt = now;
      return;
    }
    if (now - t.gazeStartedAt < DWELL_MS) return;

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

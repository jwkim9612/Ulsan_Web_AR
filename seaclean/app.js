// Seaclean 미니게임 — 원본: akp_gabiya/Assets/Scripts/AR/IceBreakGame.cs 를 재해석.
// 얼음벌 대신 쓰레기 오브젝트를 카메라 주변(3D 공간)에 배치해두고, 화면 시야 안에 든 가장 가까운
// 오브젝트를 하이라이트, 화면을 길게 눌러(터치 홀드) 없앤다. 여왕 처치 연출/파티클은 이번 범위 제외.
//
// 카메라 인식(원본의 손 인식)은 아직 8th Wall Hand Tracking을 붙이지 않은 상태 — 지금은 화면 터치
// 홀드로 대체돼 있고, 이것 자체를 정식 조작 방식으로 가도 되고 나중에 손 인식으로 바꿔도 됨(TRY_BREAK
// 지점만 교체하면 됨).

const TRASH_COUNT = 5;
const SPAWN_RADIUS = 3.0;
const VIEW_DOT_THRESHOLD = 0.9; // 화면 중앙 근처(약 25도 이내)에 있어야 "시야 안"으로 판정
const HOLD_MS = 1000; // 터치 홀드로 제거되기까지 걸리는 시간(원본 handHoldDurationToBreak=1초와 동일)

let scene, camera, renderer;
let trashItems = []; // { mesh, removed }
let highlighted = null;
let removedCount = 0;
let holdStartTime = null;

const countEl = document.getElementById('count');
const hintEl = document.getElementById('hint');
const videoEl = document.getElementById('video');

document.getElementById('start-btn').addEventListener('click', start);

async function start() {
  // iOS는 방향 센서 권한을 명시적으로 요청해야 함
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        hintEl.textContent = '방향 센서 권한이 필요합니다';
        return;
      }
    } catch (e) {
      console.warn('orientation permission error', e);
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    videoEl.srcObject = stream;
  } catch (e) {
    hintEl.textContent = '카메라 권한이 필요합니다';
    return;
  }

  document.getElementById('start').style.display = 'none';
  initScene();
  spawnTrash();
  window.addEventListener('deviceorientation', onDeviceOrientation);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  requestAnimationFrame(tick);
}

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const light = new THREE.HemisphereLight(0xffffff, 0x224466, 1.2);
  scene.add(light);
}

// TODO: BoxGeometry 자리표시자를 실제 쓰레기 3D 모델(플라스틱병/봉지/그물 등)로 교체.
function spawnTrash() {
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  for (let i = 0; i < TRASH_COUNT; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x99cc66 });
    const mesh = new THREE.Mesh(geo, mat);

    // 카메라(원점) 주변 구면에 무작위 배치 — 원본 SpawnAroundCamera와 동일한 개념(현실 공간 앵커링 없음)
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    mesh.position.set(
      SPAWN_RADIUS * Math.sin(phi) * Math.cos(theta),
      SPAWN_RADIUS * Math.sin(phi) * Math.sin(theta) * 0.5, // 세로 범위는 좀 좁게
      SPAWN_RADIUS * Math.cos(phi)
    );
    scene.add(mesh);
    trashItems.push({ mesh, removed: false });
  }
  updateCountText();
}

// 디바이스 방향 센서 값을 카메라 회전에 반영.
// TODO: 실제 폰으로 테스트하면서 좌우/상하가 뒤집히지 않는지 확인 필요(기기별 좌표계 차이 있음).
function onDeviceOrientation(e) {
  const alpha = THREE.MathUtils.degToRad(e.alpha || 0);
  const beta = THREE.MathUtils.degToRad(e.beta || 0);
  const gamma = THREE.MathUtils.degToRad(e.gamma || 0);

  const euler = new THREE.Euler();
  euler.set(beta, alpha, -gamma, 'YXZ');
  camera.quaternion.setFromEuler(euler);
  camera.quaternion.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
}

function onPointerDown() {
  holdStartTime = performance.now();
}

function onPointerUp() {
  holdStartTime = null;
}

function tick() {
  requestAnimationFrame(tick);
  updateHighlight();

  if (holdStartTime != null && highlighted) {
    if (performance.now() - holdStartTime >= HOLD_MS) {
      removeTrash(highlighted);
      holdStartTime = null;
    }
  }

  renderer.render(scene, camera);
}

// 원본 FindClosestInView와 동일한 개념: 카메라 정면 방향(dot)과 가까운 것들 중 가장 가까운 걸 하이라이트.
function updateHighlight() {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  let closest = null;
  let closestDist = Infinity;

  for (const item of trashItems) {
    if (item.removed) continue;
    const dir = item.mesh.position.clone().normalize();
    const dot = dir.dot(forward);
    if (dot < VIEW_DOT_THRESHOLD) continue;

    const dist = item.mesh.position.length();
    if (dist < closestDist) {
      closestDist = dist;
      closest = item;
    }
  }

  if (closest !== highlighted) {
    if (highlighted) highlighted.mesh.scale.set(1, 1, 1);
    highlighted = closest;
    if (highlighted) highlighted.mesh.scale.set(1.3, 1.3, 1.3);
    hintEl.textContent = highlighted ? '화면을 길게 눌러 치워보세요' : '';
  }
}

function removeTrash(item) {
  item.removed = true;
  scene.remove(item.mesh);
  removedCount++;
  updateCountText();
  highlighted = null;
  hintEl.textContent = '';

  if (removedCount === TRASH_COUNT) {
    document.getElementById('finished').style.display = 'flex';
  }
}

function updateCountText() {
  countEl.textContent = `${removedCount}/${TRASH_COUNT}`;
}

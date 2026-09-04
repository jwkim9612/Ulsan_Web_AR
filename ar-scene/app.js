// AR Scene: 뒤로가기/모드 전환(퍼즐·쓰레기줍기) UI + 실제 인식.
// 퍼즐 = MindAR 이미지 트래킹(2x2 조각 수집), 쓰레기줍기 = MediaPipe Hands(손 관절 표시).
// 카메라 파이프라인이 서로 달라서 모드 전환 시 한쪽을 확실히 stop()해서 카메라를 놔준 뒤
// 다른 쪽을 시작한다(페이지 이동 없음).

import { MindARThree } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';

const PIECE_NAMES = ['p_1', 'p_2', 'p_3', 'p_4'];
const PIECE_IMAGES = PIECE_NAMES.map((name) => `../assets/images/${name}.png`);
const FINISHED_IMAGE = '../assets/images/1.png';

const backBtn = document.getElementById('back-btn');
const modePuzzleBtn = document.getElementById('mode-puzzle');
const modeTrashBtn = document.getElementById('mode-trash');
const permissionMsg = document.getElementById('permission-msg');
const handVideoEl = document.getElementById('hand-video');
const handCanvas = document.getElementById('hand-canvas');
const handCtx = handCanvas.getContext('2d');
const mindarContainer = document.getElementById('mindar-container');
const puzzleHud = document.getElementById('puzzle-hud');
const puzzleFinishedEl = document.getElementById('puzzle-finished');
const petTextEl = document.getElementById('pet-text');

// 다 맞춘 순간에 src를 지정하면 디코딩 지연으로 살짝 깜빡여 보임 —
// 미리 받아서 decode()까지 끝내둔 다음, 필요할 때는 display만 바꾼다.
puzzleFinishedEl.src = FINISHED_IMAGE;
puzzleFinishedEl.decode().catch(() => {});

let currentMode = 'puzzle';

backBtn.addEventListener('click', () => {
  location.href = '../index.html';
});
modePuzzleBtn.addEventListener('click', () => switchMode('puzzle'));
modeTrashBtn.addEventListener('click', () => switchMode('trash'));

// --- 퍼즐 모드: MindAR 이미지 트래킹 ---
// targets.mind는 image-targets 컴파일러(hiukim.github.io/mind-ar-js-doc/tools/compile)로
// p_1~p_4.png를 이 순서 그대로 업로드해서 만든 것 — targetIndex(0~3)가 PIECE_NAMES 순서와 일치해야 함.
const mindarThree = new MindARThree({
  container: mindarContainer,
  imageTargetSrc: 'targets.mind',
  uiScanning: 'no',
});

const collectedPieces = new Set();

PIECE_NAMES.forEach((name, targetIndex) => {
  const slot = document.getElementById(`puzzle-slot-${targetIndex}`);
  slot.style.backgroundImage = `url(${PIECE_IMAGES[targetIndex]})`;

  const anchor = mindarThree.addAnchor(targetIndex);
  anchor.onTargetFound = () => {
    if (collectedPieces.has(targetIndex)) return;
    collectedPieces.add(targetIndex);
    slot.classList.add('collected');
    if (collectedPieces.size === PIECE_NAMES.length) {
      showPuzzleFinished();
    }
  };
});

function showPuzzleFinished() {
  puzzleHud.style.display = 'none';
  puzzleFinishedEl.style.display = 'block';
}

async function startPuzzle() {
  mindarContainer.style.display = 'block';
  if (collectedPieces.size === PIECE_NAMES.length) {
    puzzleFinishedEl.style.display = 'block';
  } else {
    puzzleHud.style.display = 'grid';
  }
  await mindarThree.start();
  const { renderer, scene, camera } = mindarThree;
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

function stopPuzzle() {
  mindarThree.renderer.setAnimationLoop(null);
  mindarThree.stop(); // 내부적으로 video track.stop()까지 호출해서 카메라를 실제로 놔줌
  mindarContainer.style.display = 'none';
  puzzleHud.style.display = 'none';
  puzzleFinishedEl.style.display = 'none';
}

// --- 쓰레기줍기 모드: MediaPipe Hands, 손 관절을 캔버스에 그려서 표시 ---
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0, // 모바일 성능 위해 가벼운 모델
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});
// --- 쓰다듬기 감지 ---
// 손바닥 중앙(랜드마크 9번, 중지 뿌리)의 좌표를 최근 PET_HISTORY_MS만큼 기록해두고,
// 그 안에서 방향이 여러 번 바뀌면서도 좁은 범위 안에 머물러 있으면 "쓰다듬기"로 판정.
// 상하좌우 어느 방향이든 되게, 매 프레임 더 크게 움직인 축(x 또는 y) 기준으로 방향을 본다.
const PET_HISTORY_MS = 1500;
const PET_MIN_REVERSALS = 2;
const PET_MIN_MOVE = 0.005; // 프레임 간 이 정도는 움직여야 "움직임"으로 침(잔떨림 노이즈 제거)
const PET_MAX_SPREAD = 0.3; // 정규화 좌표 기준 — 이 범위를 넘으면 쓰다듬기가 아니라 휘두른 것으로 봄
const PET_COOLDOWN_MS = 1000;

let petHistory = [];
let lastPetTime = 0;
let petTextTimer = null;

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

  return reversals >= PET_MIN_REVERSALS && spread <= PET_MAX_SPREAD;
}

function showPettedText() {
  petTextEl.style.display = 'block';
  clearTimeout(petTextTimer);
  petTextTimer = setTimeout(() => {
    petTextEl.style.display = 'none';
  }, 1000);
}

hands.onResults((results) => {
  if (currentMode !== 'trash') return;

  // 카메라 해상도가 잡히면 캔버스 내부 해상도를 맞춰서(같은 object-fit:cover라 좌표 변환 계산 불필요)
  if (
    handVideoEl.videoWidth &&
    (handCanvas.width !== handVideoEl.videoWidth || handCanvas.height !== handVideoEl.videoHeight)
  ) {
    handCanvas.width = handVideoEl.videoWidth;
    handCanvas.height = handVideoEl.videoHeight;
  }

  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  if (hasHand) {
    for (const landmarks of results.multiHandLandmarks) {
      drawConnectors(handCtx, landmarks, HAND_CONNECTIONS, { color: '#2ea5ff', lineWidth: 3 });
      drawLandmarks(handCtx, landmarks, { color: '#ffffff', fillColor: '#2ea5ff', radius: 4 });
    }

    const palm = results.multiHandLandmarks[0][9];
    const now = performance.now();
    if (checkPetting(palm.x, palm.y, now) && now - lastPetTime > PET_COOLDOWN_MS) {
      lastPetTime = now;
      petHistory = [];
      showPettedText();
    }
  } else {
    petHistory = [];
  }
});

let mpCamera = null;

function startTrash() {
  handVideoEl.style.display = 'block';
  handCanvas.style.display = 'block';
  mpCamera = new Camera(handVideoEl, {
    onFrame: async () => {
      await hands.send({ image: handVideoEl });
    },
    facingMode: 'environment',
    width: 640,
    height: 480,
  });
  mpCamera.start().catch(() => {
    permissionMsg.style.display = 'flex';
  });
}

function stopTrash() {
  if (mpCamera) {
    mpCamera.stop();
    mpCamera = null;
  }
  // Camera.stop()이 트랙까지 안 놓는 경우를 대비한 보험
  if (handVideoEl.srcObject) {
    handVideoEl.srcObject.getTracks().forEach((track) => track.stop());
    handVideoEl.srcObject = null;
  }
  handVideoEl.style.display = 'none';
  handCanvas.style.display = 'none';
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  petHistory = [];
  petTextEl.style.display = 'none';
}

async function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  modePuzzleBtn.classList.toggle('active', mode === 'puzzle');
  modeTrashBtn.classList.toggle('active', mode === 'trash');
  permissionMsg.style.display = 'none';

  if (mode === 'puzzle') {
    stopTrash();
    await startPuzzle();
  } else {
    stopPuzzle();
    startTrash();
  }
}

startPuzzle();

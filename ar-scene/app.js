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
  puzzleFinishedEl.src = FINISHED_IMAGE;
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
  if (results.multiHandLandmarks) {
    for (const landmarks of results.multiHandLandmarks) {
      drawConnectors(handCtx, landmarks, HAND_CONNECTIONS, { color: '#2ea5ff', lineWidth: 3 });
      drawLandmarks(handCtx, landmarks, { color: '#ffffff', fillColor: '#2ea5ff', radius: 4 });
    }
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

// AR Scene: 뒤로가기/모드 전환(퍼즐·쓰레기줍기) UI + 실제 인식.
// 퍼즐 = MindAR 이미지 트래킹, 쓰레기줍기 = MediaPipe Hands. 카메라 파이프라인이 서로 달라서
// 모드 전환 시 한쪽을 확실히 stop()해서 카메라를 놔준 뒤 다른 쪽을 시작한다(페이지 이동 없음).
// 지금은 테스트 단계라 인식되면 화면 중앙에 텍스트만 띄운다.

import { MindARThree } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';

const PIECE_NAMES = ['p_1', 'p_2', 'p_3', 'p_4'];

const backBtn = document.getElementById('back-btn');
const modePuzzleBtn = document.getElementById('mode-puzzle');
const modeTrashBtn = document.getElementById('mode-trash');
const recognizedTextEl = document.getElementById('recognized-text');
const permissionMsg = document.getElementById('permission-msg');
const handVideoEl = document.getElementById('hand-video');
const mindarContainer = document.getElementById('mindar-container');

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
});
PIECE_NAMES.forEach((name, targetIndex) => {
  const anchor = mindarThree.addAnchor(targetIndex);
  anchor.onTargetFound = () => {
    recognizedTextEl.textContent = `${name} 인식됨!`;
    recognizedTextEl.style.display = 'block';
  };
  anchor.onTargetLost = () => {
    recognizedTextEl.style.display = 'none';
  };
});

async function startPuzzle() {
  mindarContainer.style.display = 'block';
  await mindarThree.start();
  const { renderer, scene, camera } = mindarThree;
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

function stopPuzzle() {
  mindarThree.renderer.setAnimationLoop(null);
  mindarThree.stop(); // 내부적으로 video track.stop()까지 호출해서 카메라를 실제로 놔줌
  mindarContainer.style.display = 'none';
  recognizedTextEl.style.display = 'none';
}

// --- 쓰레기줍기 모드: MediaPipe Hands ---
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
  const found = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  recognizedTextEl.textContent = '손 인식됨!';
  recognizedTextEl.style.display = found ? 'block' : 'none';
});

let mpCamera = null;

function startTrash() {
  handVideoEl.style.display = 'block';
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
  recognizedTextEl.style.display = 'none';
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

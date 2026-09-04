// 쓰레기줍기 모드 — MediaPipe Hands(구글, 무료 오픈소스)로 진짜 손 인식.
// 8th Wall과는 별개의 카메라 파이프라인이라 puzzle 모드(index.html/8th Wall)와 한 페이지에서
// 같이 못 돌리므로 별도 페이지로 분리함. 지금은 테스트 단계라 손이 인식되면 중앙에 텍스트만 띄운다.
// TODO: 실제 쓰레기 오브젝트 배치/제거 로직(seaclean/app.js 참고)을 여기 붙일 것.

const videoEl = document.getElementById('video');
const backBtn = document.getElementById('back-btn');
const modePuzzleBtn = document.getElementById('mode-puzzle');
const modeTrashBtn = document.getElementById('mode-trash');
const recognizedTextEl = document.getElementById('recognized-text');
const permissionMsg = document.getElementById('permission-msg');

backBtn.addEventListener('click', () => {
  location.href = '../index.html';
});

modePuzzleBtn.addEventListener('click', () => {
  location.href = 'index.html';
});
// modeTrashBtn: 이미 이 페이지가 쓰레기줍기 모드라 별도 동작 없음

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0, // 모바일 성능 위해 가벼운 모델 사용
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});
hands.onResults((results) => {
  const found = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  recognizedTextEl.style.display = found ? 'block' : 'none';
});

const camera = new Camera(videoEl, {
  onFrame: async () => {
    await hands.send({ image: videoEl });
  },
  facingMode: 'environment',
  width: 640,
  height: 480,
});

camera.start().catch(() => {
  permissionMsg.style.display = 'flex';
});

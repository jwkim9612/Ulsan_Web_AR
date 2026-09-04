// Puzzle 미니게임 — 원본: akp_gabiya/Assets/Scripts/AR/PuzzleGame.cs
// 이미지 마커 4개(PIECE_NAMES)를 인식하면 조각을 채우고, 4개 다 모으면 완성 이미지를 보여준다.
// 3세트 랜덤 선택 로직은 스코프에서 제외(1세트 고정), 파티클/사운드는 이후 추가 예정.

const PIECE_NAMES = ['p_1', 'p_2', 'p_3', 'p_4'];

// TODO: 실제 조각 이미지 4장 + 완성 이미지 경로로 교체
const PIECE_IMAGES = {
  p_1: '../assets/images/puzzle_piece_1.png',
  p_2: '../assets/images/puzzle_piece_2.png',
  p_3: '../assets/images/puzzle_piece_3.png',
  p_4: '../assets/images/puzzle_piece_4.png',
};
const FINISHED_IMAGE = '../assets/images/puzzle_finished.png';

const collected = new Set();

function collectPiece(name) {
  if (!PIECE_NAMES.includes(name)) return;
  if (collected.has(name)) return;

  collected.add(name);

  const index = PIECE_NAMES.indexOf(name);
  const slot = document.getElementById(`slot-${index}`);
  slot.style.backgroundImage = `url(${PIECE_IMAGES[name]})`;
  slot.classList.add('collected');

  if (collected.size === PIECE_NAMES.length) {
    showFinished();
  }
}

function showFinished() {
  const finished = document.getElementById('finished');
  const img = document.getElementById('finished-img');
  img.src = FINISHED_IMAGE;
  finished.style.display = 'flex';
}

// --- 8th Wall Image Target 연동 지점 ---
// TODO: 8thwall.org 최신 문서 기준으로 XR8 이미지 타겟 이벤트를 구독해서
// 마커 이름(reference image name = PIECE_NAMES 중 하나)이 감지되면 collectPiece(name) 호출.
// 예시 형태(정확한 API는 문서 확인 후 확정):
//
// XR8.XrController.registerCameraPipelineModule({
//   name: 'puzzle-image-detection',
//   onImageFound: (event) => collectPiece(event.name),
// });

// --- 임시 테스트용: 실물 마커 없이 슬롯을 탭하면 수집된 것처럼 동작 ---
// (8th Wall 연동 전까지 게임 로직만 먼저 확인하기 위한 용도, 연동 후 제거)
PIECE_NAMES.forEach((name, i) => {
  document.getElementById(`slot-${i}`).addEventListener('click', () => collectPiece(name));
});

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

// --- 8th Wall Image Target 연동 ---
// 8thwall/aframe-image-targets-example 공식 예제 기준: <xrextras-named-image-target name="...">
// 엘리먼트가 자기 name과 일치하는 마커를 인식하면 자기 자신에 "xrextrasfound"/"xrextraslost" 이벤트를 쏜다.
PIECE_NAMES.forEach((name) => {
  const targetEl = document.querySelector(`xrextras-named-image-target[name="${name}"]`);
  targetEl.addEventListener('xrextrasfound', () => collectPiece(name));
});

// XR8.XrController에 실제 마커 이미지 데이터(image-target-cli로 생성한 JSON)를 등록해야 인식이 시작됨.
// TODO: 실물 카드 이미지 4장을 `npx @8thwall/image-target-cli@latest`로 처리해서
// image-targets/p_1.json ~ p_4.json 으로 저장하면 아래 fetch가 자동으로 로드함.
const onxrloaded = async () => {
  const results = await Promise.allSettled(
    PIECE_NAMES.map((name) => fetch(`image-targets/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`${name}.json not found`);
      return r.json();
    }))
  );

  const imageTargetData = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      imageTargetData.push(result.value);
    } else {
      console.warn(`[puzzle] ${PIECE_NAMES[i]} 마커 데이터 없음 — image-targets/${PIECE_NAMES[i]}.json 준비 필요`);
    }
  });

  XR8.XrController.configure({ imageTargetData });
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

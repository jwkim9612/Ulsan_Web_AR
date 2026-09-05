// AR Scene: 퍼즐 모드. 8th Wall Image Targets(월드 트래킹 없이 마커 인식만)로 카드 4장을 인식하면
// 화면 중앙 2x2 그리드가 하나씩 채워지고, 4개를 다 모으면 완성 이미지가 화면에 표시된다.
// 쓰레기줍기 모드는 8th Wall이 disableWorldTracking을 실행 중에 못 바꾸게 막아놔서 같은 페이지
// 안에서 전환할 수 없다 — trash.html로 완전히 페이지 이동한다.

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

  // 8thwall/aframe-image-targets-example 공식 예제 기준: <xrextras-named-image-target name="...">
  // 엘리먼트가 자기 name과 일치하는 마커를 인식하면 자기 자신에 "xrextrasfound" 이벤트를 쏜다.
  const targetEl = document.querySelector(`xrextras-named-image-target[name="${name}"]`);
  targetEl.addEventListener('xrextrasfound', () => collectPiece(targetIndex));
});

// XR8.XrController에 실제 마커 이미지 데이터(image-target-cli로 생성한 JSON)를 등록해야 인식이 시작됨.
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

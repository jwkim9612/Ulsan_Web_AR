// AR Scene: 뒤로가기/모드 전환(퍼즐·쓰레기줍기) UI + 8th Wall 이미지 마커 인식.
// 지금은 테스트 단계라, 퍼즐 모드에서 마커(p_1~p_4)가 인식되면 화면 중앙에 텍스트만 띄운다.
// 실제 퍼즐 슬롯 UI(puzzle/app.js의 collectPiece 로직)는 다음 단계에서 여기로 옮겨 붙일 예정.
// 쓰레기줍기 모드는 아직 미구현(TODO) — seaclean/app.js의 로직을 별도로 붙여야 함.

const PIECE_NAMES = ['p_1', 'p_2', 'p_3', 'p_4'];

const backBtn = document.getElementById('back-btn');
const modePuzzleBtn = document.getElementById('mode-puzzle');
const modeTrashBtn = document.getElementById('mode-trash');
const recognizedTextEl = document.getElementById('recognized-text');

let currentMode = 'puzzle';

backBtn.addEventListener('click', () => {
  location.href = '../index.html';
});

modePuzzleBtn.addEventListener('click', () => setMode('puzzle'));
modeTrashBtn.addEventListener('click', () => setMode('trash'));

function setMode(mode) {
  currentMode = mode;
  modePuzzleBtn.classList.toggle('active', mode === 'puzzle');
  modeTrashBtn.classList.toggle('active', mode === 'trash');
  recognizedTextEl.style.display = 'none';
  // TODO: 쓰레기줍기 모드 실제 로직 연결
}

// --- 8th Wall Image Target 연동 (테스트용: 인식되면 중앙에 이름 텍스트) ---
PIECE_NAMES.forEach((name) => {
  const targetEl = document.querySelector(`xrextras-named-image-target[name="${name}"]`);
  targetEl.addEventListener('xrextrasfound', () => {
    if (currentMode !== 'puzzle') return;
    recognizedTextEl.textContent = `${name} 인식됨!`;
    recognizedTextEl.style.display = 'block';
  });
  targetEl.addEventListener('xrextraslost', () => {
    if (currentMode !== 'puzzle') return;
    recognizedTextEl.style.display = 'none';
  });
});

// puzzle 폴더에 이미 생성해둔 마커 데이터를 그대로 재사용(중복 보관 안 함)
const onxrloaded = async () => {
  const results = await Promise.allSettled(
    PIECE_NAMES.map((name) => fetch(`../puzzle/image-targets/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`${name}.json not found`);
      return r.json();
    }))
  );

  const imageTargetData = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      const data = result.value;
      // JSON 안 imagePath는 puzzle/index.html 기준 상대경로("image-targets/...")로 생성돼 있어서,
      // 한 단계 위(ar-scene/)에서 그대로 쓰면 실제 파일 위치와 어긋난다 — puzzle/ 기준으로 보정.
      if (data.imagePath) {
        data.imagePath = `../puzzle/${data.imagePath}`;
      }
      imageTargetData.push(data);
    } else {
      console.warn(`[ar-scene] ${PIECE_NAMES[i]} 마커 데이터 없음`);
    }
  });

  XR8.XrController.configure({ imageTargetData });
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

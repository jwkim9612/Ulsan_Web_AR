// AR Scene 진입 셸: 카메라를 바로 켜고, 뒤로가기/모드 전환(퍼즐·쓰레기줍기) UI만 담당.
// TODO: mode-puzzle / mode-trash 버튼에 실제 게임 로직(puzzle/app.js, seaclean/app.js 내용) 연결.
// 지금은 버튼이 활성 표시만 바뀌고 실제 게임은 아직 안 붙어있음.

const videoEl = document.getElementById('video');
const backBtn = document.getElementById('back-btn');
const modePuzzleBtn = document.getElementById('mode-puzzle');
const modeTrashBtn = document.getElementById('mode-trash');
const permissionMsg = document.getElementById('permission-msg');

backBtn.addEventListener('click', () => {
  location.href = '../index.html';
});

modePuzzleBtn.addEventListener('click', () => setMode('puzzle'));
modeTrashBtn.addEventListener('click', () => setMode('trash'));

function setMode(mode) {
  modePuzzleBtn.classList.toggle('active', mode === 'puzzle');
  modeTrashBtn.classList.toggle('active', mode === 'trash');
  // TODO: 여기서 실제 퍼즐/쓰레기줍기 게임 로직 시작·정지 전환
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    videoEl.srcObject = stream;
  } catch (e) {
    permissionMsg.style.display = 'flex';
  }
}

startCamera();

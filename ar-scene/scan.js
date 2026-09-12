// QR 인식 대기 씬: MindAR 이미지 트래킹으로 puzzle.png(0)/ice.png(1) 마커를 구분해서 각각
// 퍼즐(index.html)/고래구조(trash.html) 페이지로 이동한다. 마커 원본은 assets/imageTracking/에
// 있음. targets.mind는 MindAR 공식 컴파일러(hiukim.github.io/mind-ar-js-doc/tools/compile)로
// puzzle.png -> ice.png 순서 그대로 업로드해서 만든 것 — targetIndex(0/1)가 TARGETS 배열
// 순서와 반드시 일치해야 한다.
import { MindARThree } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';

const TARGETS = [
  { name: '퍼즐', href: 'index.html' },
  { name: '고래구조', href: 'trash.html' },
];

const mindarContainer = document.getElementById('mindar-container');
const modePill = document.getElementById('mode-pill');
const statusPill = document.getElementById('status-pill');
const permissionMsg = document.getElementById('permission-msg');

let navigated = false;

const mindarThree = new MindARThree({
  container: mindarContainer,
  imageTargetSrc: 'targets.mind',
});

TARGETS.forEach((target, targetIndex) => {
  const anchor = mindarThree.addAnchor(targetIndex);
  anchor.onTargetFound = () => onFound(target);
});

function onFound(target) {
  if (navigated) return;
  navigated = true;

  modePill.textContent = target.name;
  modePill.style.display = 'block';
  statusPill.textContent = '인식 완료! 이동 중';
  statusPill.classList.add('found');

  setTimeout(() => {
    location.href = target.href;
  }, 600);
}

async function start() {
  try {
    await mindarThree.start();
  } catch (err) {
    console.error('[scan] camera start failed', err);
    permissionMsg.style.display = 'flex';
    return;
  }
  const { renderer, scene, camera } = mindarThree;
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

start();

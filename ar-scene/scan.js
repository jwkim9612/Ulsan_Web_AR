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
    SFX.navigate(target.href, 0);
  }, 600);
}

// 마커 인식을 기다리는 동안(보통 몇 초는 걸림) 카메라만 돌고 있어 여유가 있다. 이 시간에
// 두 게임(퍼즐/고래구조)이 쓰는 무거운 자산을 미리 fetch해서 브라우저 HTTP 캐시를 채워두면,
// 실제로 다음 페이지(index.html/trash.html)로 넘어갔을 때 <a-assets>가 네트워크 왕복 없이
// 캐시에서 바로 읽어와 훨씬 빨리 준비된다. 어느 마커가 인식될지 여기선 모르므로 양쪽 게임
// 자산을 다 대상으로 한다 — 실패해도 캐시 예열 목적일 뿐이라 그냥 무시한다.
const PREFETCH_URLS = [
  '../assets/models/Ice.glb',
  '../assets/models/Jangsaengi.glb',
  '../assets/models/Whale_Low.glb',
  '../assets/models/Branching_Coral.glb',
  '../assets/models/Mound_Coral.glb',
  '../assets/models/Seagrass.glb',
  '../assets/models/Wakame.glb',
  '../assets/models/Crushed_Can.glb',
  '../assets/models/Crushed_PET_Bottle.glb',
  '../assets/models/Discarded_Plastic_Cup.glb',
  '../assets/images/p_1.png',
  '../assets/images/p_2.png',
  '../assets/images/p_3.png',
  '../assets/images/p_4.png',
  '../assets/images/p_5.png',
  '../assets/images/p_6.png',
  '../assets/images/p_7.png',
  '../assets/images/p_8.png',
  '../assets/images/1.png',
  '../assets/images/complete_whale.png',
  '../assets/images/complete_trash_bg.png',
  '../assets/images/complete_puzzle_bg.png',
  // 1회성 효과음도 프리로드해둔다 — 재생 시점에 그때 fetch하면 이동통신망에서 느려지거나
  // 실패해서 소리가 안 나는 경우가 생길 수 있다.
  '../assets/sounds/puzzle_collect.wav',
  '../assets/sounds/puzzle_success.wav',
  '../assets/sounds/ice_collect.wav',
  '../assets/sounds/ice_success.wav',
  '../assets/sounds/whale_rescue_success.mp3',
  '../assets/sounds/complete_bgm_loop.wav',
  '../assets/sounds/button_click.wav',
  '../assets/videos/GameClearVideo.mp4',
];
const PREFETCH_DELAY_MS = 800; // 카메라/마커 인식 시작 직후 순간의 부하와 안 겹치게 살짝 늦춤

function prefetchGameAssets() {
  for (const url of PREFETCH_URLS) {
    fetch(url, { priority: 'low' }).catch(() => {});
  }
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
  setTimeout(prefetchGameAssets, PREFETCH_DELAY_MS);
}

// 두 게임을 모두 클리어한 채로 이 화면에 돌아왔으면, 평소의 카메라/마커 스캔 대신 올클리어
// 영상을 먼저 보여준다. 영상이 끝나면 클리어 기록을 지우고(다음에 또 둘 다 깨면 다시 재생되게)
// 평소처럼 카메라를 켠다.
if (window.GameClear && GameClear.isBothCleared()) {
  const allClearVideoEl = document.getElementById('allclear-video');
  GameClear.playVideo(allClearVideoEl, () => {
    GameClear.resetCleared();
    start();
  });
} else {
  start();
}

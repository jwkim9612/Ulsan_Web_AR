// AR Scene: 얼음 깨고 장생이 구하기 모드. 8th Wall World Tracking(SLAM)으로 실측 위치를
// 추적해서 사용자 주변에 얼음 오브젝트(3D 모델, `assets/models/Ice_Break.glb`)를 배치한다.
// 얼음 재질이 반투명이라 그 안에 들어있는 아기 장생이 마스코트
// (`assets/models/Baby_Jangsaeng_Bounce.glb`)가 얼어붙은 채 멈춰 있는 게 비쳐 보인다. 사용자가 실제로 일정 거리
// 안까지 다가와 그 얼음을 잠깐 바라보면 "타겟팅"되는데(화면 정면으로 옮겨지지 않고 제자리에서
// 파티클 이펙트+살짝 커지는 것으로만 표시됨), 타겟팅된 채로 GAZE_COLLECT_MS 동안 계속 바라보면
// 얼음이 자체 애니메이션(Ice_Break_1_5s)으로 균열·파편화되며 깨지고, 장생이는 위로 살짝
// 떠오르며 Baby_Bounce_Loop로 통통 튀다가 구조된다(breakLockedItem 참고). 예전엔 MediaPipe Hands로
// 손 잡기+흔들기를 판정했는데, 태블릿 등에서 인식이 불안정해서 응시만으로 수집하도록 바꿨다.
// 타겟팅되면 얼음이 사용자 쪽으로 살짝 당겨지고(pullIceTowardCamera), 타겟팅 도중 그 얼음에서
// 시선을 돌린 채 잠깐 지나면 타겟팅이 풀리며 원래 자리로 돌아간다(releaseLock 참고).
//
// 두 모델의 스케일/피벗은 만든 툴마다 제각각일 수 있어서, `fitLoadedModel`이 로드된 실제
// 바운딩 박스를 기준으로 목표 크기에 맞게 자동 스케일하고 중심을 맞춰준다 — 모델을 다시
// 내보내도 코드 수정 없이 항상 일관된 크기로 보인다.
//
// 퍼즐 모드(index.html)도 동일하게 월드 트래킹을 쓰지만, 페이지는 여전히 분리돼 있다.
//
// 이 외에 장식용으로 고래 3마리(`assets/models/Whale_Low.glb`)를 얼음보다 멀찍이 흩뿌려두는데,
// 이쪽은 상호작용이 전혀 없고 그냥 Swimming 애니메이션(gltf-animation 컴포넌트)을 재생하며
// 완만하게 위아래로 흔들리기만 한다. 산호(정지)와 해초(내장 Sway_Loop_4s 애니메이션) 4종도
// 장식으로 바닥 근처에 흩뿌려두는데, 이것도 고래와 마찬가지로 상호작용이 전혀 없다.
// 쓰레기(캔/PET병/컵) 3종은 6개(종류당 2개) 떠다니는 장식으로 두되, 얼음을 하나 깰 때마다
// 2개씩 사라지게 해서 얼음 3개를 다 깨면 쓰레기도 정확히 다 없어진다(despawnTrashDecorBatch).
// 화면 전체에는 CSS만으로 수중 톤 오버레이(#underwater-filter, trash.html)를 씌워뒀는데,
// 실제 카메라 프레임(World Tracking이 쓰는 원본 픽셀)에는 영향이 없다.

const backBtn = document.getElementById('back-btn');
const trashRoot = document.getElementById('trash-root');
const cameraEl = document.querySelector('a-camera');
const trashCountText = document.getElementById('trash-count-text');
const trashHintEl = document.getElementById('trash-hint');
const trashFinishedEl = document.getElementById('trash-finished');
const statusPillEl = document.getElementById('status-pill');
const completeOverlayEl = document.getElementById('complete-overlay');
const completeWhaleImgEl = document.getElementById('complete-whale');
const clearVideoEl = document.getElementById('clear-video');
const completeBtn = document.getElementById('complete-btn');
const allClearVideoEl = document.getElementById('allclear-video');
// 두 게임을 다 깬 순간(올클리어)이면 true — 완료 팝업 전에 올클리어 영상을 틀고, 팝업 버튼은
// 클리어 영상 없이 바로 메인으로 보낸다.
let allCleared = false;

// 올클리어 영상은 버튼 탭 없이(게임 진행 중 자동으로) 재생되므로, 첫 터치 때 무음으로
// 한 번 재생→정지해 둬서 모바일에서도 나중에 소리 켠 재생이 허용되게 한다.
document.addEventListener('pointerdown', () => {
  allClearVideoEl.muted = true;
  allClearVideoEl.play().then(() => {
    allClearVideoEl.pause();
    allClearVideoEl.currentTime = 0;
  }).catch(() => {});
}, { once: true });

// 완료 화면 전용 큰 이미지(1.4MB)는 display:none이어도 <img src>면 페이지 로드 시점에 바로
// fetch되어 초기 로딩(=글b 프리로드)과 대역폭을 다툰다. data-src로 미뤄뒀다가 실제로 완료
// 화면을 띄우기 직전에만 fetch되도록 한다.
function revealCompleteOverlay() {
  if (completeWhaleImgEl.dataset.src) {
    completeWhaleImgEl.src = completeWhaleImgEl.dataset.src;
    delete completeWhaleImgEl.dataset.src;
  }
  completeOverlayEl.style.display = 'block';
  SFX.play('whale_rescue_success.mp3');
}

// 미리보기용: trash.html?preview=complete 로 접속하면 게임 진행 없이 완료 화면부터 바로 보임.
if (new URLSearchParams(location.search).get('preview') === 'complete') {
  revealCompleteOverlay();
}

// 완료 화면이 먼저 뜨고, 돌아가기 버튼을 누르면 클리어 영상을 보여준 뒤 메인으로 이동한다.
// 버튼 탭(사용자 제스처) 안에서 영상을 시작해야 모바일에서도 소리 켠 재생이 허용된다.
// 올클리어였다면 올클리어 영상을 이미 본 뒤라 클리어 영상 없이 바로 메인으로 간다.
completeBtn.addEventListener('click', () => {
  if (completeBtn.disabled) return;
  completeBtn.disabled = true;
  if (allCleared) {
    SFX.navigate('scan.html');
    return;
  }
  GameClear.playVideo(clearVideoEl, () => SFX.navigate('scan.html'));
});

// --- 실기기 진단용 디버그 오버레이 (?debug=1) ---
// USB 디버깅 없이도 화면에서 바로 타겟팅/수집 진행 상태와 에러를 볼 수 있도록 로그로 남긴다.
// 평소(?debug=1 없음)에는 완전히 비활성.
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const debugState = {
  locked: false,
  log: [], // 최근 이벤트/에러 스크롤 로그
};
let debugOverlayEl = null;
function debugLog(msg) {
  if (!DEBUG) return;
  const t = new Date().toISOString().slice(11, 23);
  debugState.log.push(`${t} ${msg}`);
  if (debugState.log.length > 10) debugState.log.shift();
}
function renderDebugOverlay() {
  debugOverlayEl.textContent =
    `locked:${debugState.locked} gaze:${lockedItem && lockStartedAt !== null ? Math.round(performance.now() - lockStartedAt) : '-'}ms rescued:${rescuedCount}/${RESCUE_COUNT}\n` +
    `--- log ---\n${debugState.log.join('\n')}`;
}
if (DEBUG) {
  debugOverlayEl = document.createElement('pre');
  Object.assign(debugOverlayEl.style, {
    position: 'fixed', top: '0', right: '0', zIndex: '9999',
    margin: '0', padding: '8px', fontSize: '11px', lineHeight: '1.4',
    color: '#0f0', background: 'rgba(0,0,0,0.6)', maxWidth: '60vw',
    maxHeight: '100vh', overflow: 'hidden', whiteSpace: 'pre-wrap', pointerEvents: 'none',
  });
  document.body.appendChild(debugOverlayEl);
  debugLog('debug overlay started');
  setInterval(renderDebugOverlay, 300);
  // 비동기 reject나 uncaught 에러를 화면 로그로 잡기 위한 전역 net.
  window.addEventListener('unhandledrejection', (ev) => {
    debugLog(`unhandled rejection: ${(ev.reason && ev.reason.message) || ev.reason}`);
  });
  window.addEventListener('error', (ev) => {
    debugLog(`window error: ${ev.message} @ ${(ev.filename || '').split('/').pop()}:${ev.lineno}`);
  });
}

backBtn.addEventListener('click', () => {
  SFX.navigate('scan.html');
});

// --- 오브젝트 배치 및 거리/응시 판정 ---
const RESCUE_COUNT = 3; // 이만큼 깨면 완료(스폰 개수와는 별개)
const SPAWN_COUNT = 5; // 실제로 주변에 흩뿌리는 얼음 개수 — 완료 조건보다 여유 있게 둬서 못 찾은 몇 개는 못 깨도 끝날 수 있게
const SPAWN_MIN_M = 1.2;
const SPAWN_MAX_M = 3.0; // 카메라 시작 위치(원점) 기준 구면좌표, 실측 미터. 스케일 추정 오차가
                          // 거리에 비례해서 커지므로 너무 멀리 두면 "가까워져도 거리가 안 줄어드는"
                          // 오브젝트가 생길 수 있어 범위를 좁게 잡음.
const LOCK_DISTANCE_M = 2.0; // 이 거리 안이면서 아래 각도 조건도 만족해야 타겟팅됨 (순수 실측
                              // 거리만 보면 스케일 오차 때문에 절대 안 가까워지는 오브젝트가 생길
                              // 수 있어서, "바라보고 있는지"를 같이 봐서 느슨하게 함)
const LOCK_GAZE_DOT_THRESHOLD = 0.85; // 화면 중앙 쪽으로 바라보고 있어야 함(약 32도 이내)
const LOCK_DWELL_MS = 1000; // 거리+응시 조건을 이만큼 계속 유지해야 실제로 타겟팅됨(스치듯 지나가는 것 방지)
// 타겟팅된 뒤 이만큼 계속 바라보면 얼음이 깨지며 수집된다(잠깐 시선이 벗어난 동안엔 수집 안 함).
const GAZE_COLLECT_MS = 3000;
// 타겟팅 해제 조건 — 락 조건보다 넓게 잡아서(히스테리시스) 응시 도중 카메라가 살짝
// 돌아가거나 한 발 물러선 정도로는 안 풀리고, 확실히 다른 곳을 볼 때만 풀린다.
const UNLOCK_GAZE_DOT_THRESHOLD = 0.65; // 약 49도 밖으로 벗어나면 "안 보고 있음"
const UNLOCK_DISTANCE_M = LOCK_DISTANCE_M + 1.0;
const UNLOCK_GRACE_MS = 1500; // 벗어난 상태가 이만큼 계속돼야 실제로 해제
// 타겟팅되면 얼음을 사용자 쪽으로 살짝 당겨온다(월드 공간에서 카메라 방향 직선을 따라 이동할 뿐,
// 예전처럼 카메라 정면에 고정시키지는 않음). 타겟팅이 풀리면 원래 자리(homePos)로 돌아간다.
const PULL_RATIO = 0.5; // 현재 거리의 이 비율만큼 다가옴
const PULL_MIN_DISTANCE_M = 0.7; // 이보다 가까이는 당기지 않음(이미 가까우면 이동 안 함)
const PULL_MS = 500;
const SPAWN_HEIGHT_OFFSET_M = 0.9; // 눈높이(카메라) 기준 이만큼 위로 띄워서 배치

// 단안 카메라 SLAM은 실측 스케일 추정이 트래킹 도중에도 계속 재조정될 수 있어서, 스폰 때는
// SPAWN_MAX_M 안에 있던 얼음이 나중에 스케일이 커지는 쪽으로 재추정되면 실제로 훨씬 멀게
// 느껴질 수 있다("아무리 걸어가도 안 가까워짐"). 이 거리보다 멀어지면 지금 서 있는 위치
// 기준으로 가까이 다시 배치해서 너무 멀리 나가는 걸 막는다.
const MAX_DRIFT_DISTANCE_M = SPAWN_MAX_M * 2;

const TARGETED_ICE_SCALE = 1.12; // 타겟팅되면 얼음이 이만큼 커짐(위치는 그대로, 제자리에서 강조만)

let iceItems = []; // { el, iceEl, mascotEl, worldPos, removed }
let lockedItem = null;
let lockStartedAt = null; // 현재 얼음이 타겟팅된 시점(GAZE_COLLECT_MS 응시 판정용)
let rescuedCount = 0;
let lockCandidate = null; // 거리+응시 조건을 만족하기 시작한 얼음(아직 확정 lock 전)
let lockCandidateStartedAt = null;
let lockLostSince = null; // 타겟팅된 얼음이 시야/거리 밖으로 벗어나기 시작한 시점(해제 유예 판정용)

// trash.html의 <a-assets>에 등록된 #id를 참조 — 이렇게 하면 씬 로딩 단계(xrextras-loading이
// 떠 있는 동안)에 A-Frame이 한 번만 fetch/parse해두고, 아래에서 5/5/3개씩 만드는 인스턴스는
// 그 파싱 결과를 클론해서 쓴다. 원시 URL을 직접 주면 인스턴스마다 독립적으로 재요청되어
// AR 트래킹이 막 시작되는 순간과 겹쳐 렉의 주 원인이 됐었다.
const ICE_MODEL_URL = '#ice-model-asset';
const ICE_MODEL_TARGET_SIZE_M = 0.45; // 모델의 가장 긴 변이 대략 이 크기가 되도록 자동 스케일

const MASCOT_MODEL_URL = '#mascot-model-asset';
const MASCOT_MODEL_TARGET_SIZE_M = 0.3; // 얼음(0.45m)보다 작게 — 얼음 속에 들어있는 느낌(렌더 기준 약 0.3m 높이, 얼음 약 0.43m)

// --- 배경 장식용 고래(상호작용 없음, 그냥 주변에서 헤엄치는 것처럼 보이기만 함) ---
const WHALE_MODEL_URL = '#whale-model-asset';
// fitLoadedModel의 스킨드 메시 측정 버그를 고친 뒤 기준으로, 이전 화면상 크기(~1.65m)의 절반(~0.8m)이
// 되는 값에서 더 줄임. 회전된 AABB로 재기 때문에 실제 렌더 크기는 이 값보다 조금 작게 나온다(0.6 -> 약 0.47m).
const WHALE_TARGET_SIZE_M = 0.6;
const WHALE_COUNT = 3;
const WHALE_SPAWN_MIN_M = 2.0;
const WHALE_SPAWN_MAX_M = 4.0; // 얼음보다 멀찍이 둬서 상호작용 대상과 안 헷갈리게 함
const WHALE_HEIGHT_OFFSET_M = 0.9;

// --- 배경 장식용 산호/해초(상호작용 없음). 산호는 완전히 고정, 해초만 내장된
// Sway_Loop_4s 클립으로 살랑거린다. ---
const CORAL_BRANCHING_MODEL_URL = '#coral-branching-model-asset';
const CORAL_MOUND_MODEL_URL = '#coral-mound-model-asset';
const SEAGRASS_MODEL_URL = '#seagrass-model-asset';
const WAKAME_MODEL_URL = '#wakame-model-asset';

// Seagrass.glb는 클립이 2개(Sway_Loop_4s, Sway_Loop_4s.001 — 블렌더 익스포트 중복 추정)라
// mesh.animations[0]에 기대면 둘 중 뭐가 걸릴지 불확실해서 이름으로 명시 지정한다.
const REEF_SWAY_CLIP = 'Sway_Loop_4s';

// { url, targetSizeM, clip } — clip 있으면 gltf-animation 부착, 없으면(산호) 완전 정적.
// 목표 크기는 실측 기준 없는 눈대중 값이라 실기기 확인 후 조정 필요.
const REEF_MODELS = [
  { url: CORAL_BRANCHING_MODEL_URL, targetSizeM: 0.4, clip: null },
  { url: CORAL_MOUND_MODEL_URL, targetSizeM: 0.3, clip: null },
  { url: SEAGRASS_MODEL_URL, targetSizeM: 0.5, clip: REEF_SWAY_CLIP },
  { url: WAKAME_MODEL_URL, targetSizeM: 0.6, clip: REEF_SWAY_CLIP },
];

const REEF_COUNT = 8; // 슬롯마다 REEF_MODELS 중 무작위 1개 -> 평균 산호/해초 각 4개씩.
                       // 텍스처 없는 단일메시라 고래/얼음에 더해도 모바일 부담 적을 것으로 판단.
const REEF_SPAWN_MIN_M = 1.0;
const REEF_SPAWN_MAX_M = 3.8; // 얼음 링(1.2~3.0m)/고래 링(2.0~4.0m)과 반경은 겹치지만
                               // REEF_HEIGHT_OFFSET_M으로 눈높이보다 한참 아래 배치돼 수직 분리된다.
const REEF_HEIGHT_OFFSET_M = -1.1; // 바닥 감지가 없어서, 카메라 시작 위치(가슴~눈높이로 들고
                                    // 있다고 가정)보다 이만큼 아래를 "바다 바닥"으로 근사한다.
                                    // 오차가 클 수 있어 실기기 테스트 후 조정 필요.

// --- 장식용 쓰레기 3종(캔/PET병/컵), 종류당 2개씩 총 6개. 장식이지만 산호/해초와 달리
// 게임 진행(얼음 깨기)에 연동해서 사라진다 — 얼음 하나 깰 때마다 2개씩 없어져서, 얼음
// RESCUE_COUNT(3)개를 다 깨면 쓰레기 6개도 정확히 다 사라진다. ---
const TRASH_DECOR_MODELS = [
  { url: '#trash-can-model-asset', targetSizeM: 0.22 },
  { url: '#trash-bottle-model-asset', targetSizeM: 0.25 },
  { url: '#trash-cup-model-asset', targetSizeM: 0.18 },
];
const TRASH_DECOR_PER_RESCUE = 2; // 얼음 1개 깰 때마다 사라지는 개수
const TRASH_DECOR_COUNT = TRASH_DECOR_PER_RESCUE * RESCUE_COUNT; // 항상 정확히 다 없어지도록 RESCUE_COUNT에서 도출(하드코딩 6 대신)
const TRASH_DECOR_SPAWN_MIN_M = 1.3;
const TRASH_DECOR_SPAWN_MAX_M = 3.2;
const TRASH_DECOR_HEIGHT_OFFSET_M = 0.9; // 고래처럼 눈높이 근처 수중에 떠 있는 느낌

let trashDecorItems = []; // { el } — pop()한 순서대로 사라짐(스폰 시 미리 섞어둠)

// glTF 모델 안에 내보내진 애니메이션 클립을 THREE.AnimationMixer로 재생하는 범용 컴포넌트.
// 8th Wall 전용 A-Frame 빌드(vendor/8frame-1.5.0.min.js)에는 aframe-extras의 animation-mixer가
// 없어서 직접 만듦 — tick()에서 매 프레임 mixer를 갱신해야 실제로 재생된다.
// autoplay:false로 두면 로드만 해두고(글TF 기본 포즈로 정지) 재생은 안 하다가, 나중에
// playClip()으로 원하는 시점에 원하는 클립을 재생할 수 있다 — 얼음 깨기(정지해 있다가 수집될 때만
// 재생)나 장생이(얼음 속에선 정지해 있다가 구출되는 순간부터 Baby_Bounce_Loop 반복)처럼
// 원하는 시점에 클립을 재생해야 하는 경우에 쓴다.
AFRAME.registerComponent('gltf-animation', {
  schema: { clip: { type: 'string', default: '' }, autoplay: { type: 'boolean', default: true }, loop: { type: 'boolean', default: true } },
  init() {
    this.mixer = null;
    this.clips = null;
    this.action = null;
    this.el.addEventListener('model-loaded', (e) => {
      const mesh = (e.detail && e.detail.model) || this.el.getObject3D('mesh');
      if (!mesh || !mesh.animations || !mesh.animations.length) return;
      this.mixer = new AFRAME.THREE.AnimationMixer(mesh);
      this.clips = mesh.animations;
      if (this.data.autoplay) this.playClip(this.data.clip, { loop: this.data.loop });
    });
  },
  tick(time, timeDelta) {
    if (this.mixer) this.mixer.update(timeDelta / 1000);
  },
  // 이름으로 클립을 찾아 재생한다(없으면 첫 클립으로 대체). 이미 다른 클립이 재생 중이면
  // 크로스페이드 없이 멈추고 바로 전환한다.
  playClip(name, { loop = true } = {}) {
    if (!this.mixer || !this.clips || !this.clips.length) return;
    const clip = (name && this.clips.find((c) => c.name === name)) || this.clips[0];
    if (this.action) this.action.stop();
    this.action = this.mixer.clipAction(clip);
    this.action.reset();
    if (!loop) {
      this.action.setLoop(AFRAME.THREE.LoopOnce);
      this.action.clampWhenFinished = true;
    }
    this.action.play();
  },
});

// 상호작용 없이 그냥 사용자 주변에 흩어놓고 완만하게 위아래/앞뒤로 흔들리게만 한다(헤엄 애니메이션
// 자체는 gltf-animation이 담당, 이 위치 애니메이션은 "제자리 헤엄"이 아니라 "주변을 맴도는" 느낌만 더함).
function spawnDecorativeWhales() {
  const pose = getCameraPose();
  const origin = pose ? pose.camPos : { x: 0, y: 0, z: 0 };

  const sector = (Math.PI * 2) / WHALE_COUNT;
  for (let i = 0; i < WHALE_COUNT; i++) {
    const radius = WHALE_SPAWN_MIN_M + Math.random() * (WHALE_SPAWN_MAX_M - WHALE_SPAWN_MIN_M);
    const theta = sector * i + Math.random() * sector;
    const x = origin.x + radius * Math.cos(theta);
    const z = origin.z + radius * Math.sin(theta);
    const y = origin.y + WHALE_HEIGHT_OFFSET_M + (Math.random() * 0.6 - 0.3);

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('position', `${x} ${y} ${z}`);
    wrapper.setAttribute('rotation', `0 ${Math.random() * 360} 0`);

    const bobTo = `${x} ${y + 0.25} ${z}`;
    wrapper.setAttribute('animation__bob', `property: position; to: ${bobTo}; dir: alternate; loop: true; dur: ${2400 + Math.random() * 1200}; easing: easeInOutSine`);
    wrapper.setAttribute('animation__turn', `property: rotation; to: 0 ${Math.random() * 360} 0; dir: alternate; loop: true; dur: ${6000 + Math.random() * 3000}; easing: easeInOutSine`);

    const whaleEl = document.createElement('a-entity');
    whaleEl.setAttribute('gltf-model', WHALE_MODEL_URL);
    whaleEl.setAttribute('gltf-animation', 'clip: Swimming');
    fitLoadedModel(whaleEl, WHALE_TARGET_SIZE_M);
    wrapper.appendChild(whaleEl);

    trashRoot.appendChild(wrapper);
  }
}

// 산호/해초도 장식용 고래와 같은 섹터 배치 구조를 쓰되, 슬롯마다 REEF_MODELS 중 하나를
// 무작위로 골라서 흩뿌린다. 바닥에 뿌리내린 느낌이라 고래처럼 떠다니는 bob/turn 애니메이션은
// 주지 않고, 반복 사용되는 모델이 2+2종뿐이라 너무 균일해 보이지 않도록 개체마다 스케일을
// ±15% 지터한다(fitLoadedModel이 이미 적용한 고정 목표 크기 위에 wrapper 스케일로 곱해짐 —
// 서로 다른 계층이라 충돌 없음).
function spawnDecorativeReef() {
  const pose = getCameraPose();
  const origin = pose ? pose.camPos : { x: 0, y: 0, z: 0 };

  const sector = (Math.PI * 2) / REEF_COUNT;
  for (let i = 0; i < REEF_COUNT; i++) {
    const model = REEF_MODELS[Math.floor(Math.random() * REEF_MODELS.length)];

    const radius = REEF_SPAWN_MIN_M + Math.random() * (REEF_SPAWN_MAX_M - REEF_SPAWN_MIN_M);
    const theta = sector * i + Math.random() * sector;
    const x = origin.x + radius * Math.cos(theta);
    const z = origin.z + radius * Math.sin(theta);
    const y = origin.y + REEF_HEIGHT_OFFSET_M + (Math.random() * 0.4 - 0.2);

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('position', `${x} ${y} ${z}`);
    wrapper.setAttribute('rotation', `0 ${Math.random() * 360} 0`);
    const jitter = 0.85 + Math.random() * 0.3;
    wrapper.setAttribute('scale', `${jitter} ${jitter} ${jitter}`);

    const reefEl = document.createElement('a-entity');
    reefEl.setAttribute('gltf-model', model.url);
    if (model.clip) reefEl.setAttribute('gltf-animation', `clip: ${model.clip}`);
    fitLoadedModel(reefEl, model.targetSizeM);
    wrapper.appendChild(reefEl);

    trashRoot.appendChild(wrapper);
  }
}

// 3종을 2개씩 채운 풀을 셔플해서, 배치 위치와 "얼음 깰 때마다 사라지는 순서"를 둘 다
// 무작위로 만든다. 산호/해초와 달리 물속을 떠다니는 쓰레기라 고정하지 않고, 고래처럼
// 완만한 bob(상하) + 표류하는 느낌의 느린 tumble(회전) 애니메이션을 준다.
function spawnTrashDecor() {
  const pose = getCameraPose();
  const origin = pose ? pose.camPos : { x: 0, y: 0, z: 0 };

  const pool = [];
  TRASH_DECOR_MODELS.forEach((m) => { pool.push(m); pool.push(m); });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const sector = (Math.PI * 2) / TRASH_DECOR_COUNT;
  pool.forEach((model, i) => {
    const radius = TRASH_DECOR_SPAWN_MIN_M + Math.random() * (TRASH_DECOR_SPAWN_MAX_M - TRASH_DECOR_SPAWN_MIN_M);
    const theta = sector * i + Math.random() * sector;
    const x = origin.x + radius * Math.cos(theta);
    const z = origin.z + radius * Math.sin(theta);
    const y = origin.y + TRASH_DECOR_HEIGHT_OFFSET_M + (Math.random() * 0.6 - 0.3);

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('position', `${x} ${y} ${z}`);
    wrapper.setAttribute('rotation', `${Math.random() * 360} ${Math.random() * 360} ${Math.random() * 360}`);

    const bobTo = `${x} ${y + 0.2} ${z}`;
    wrapper.setAttribute('animation__bob', `property: position; to: ${bobTo}; dir: alternate; loop: true; dur: ${2000 + Math.random() * 1500}; easing: easeInOutSine`);
    wrapper.setAttribute('animation__tumble', `property: rotation; to: ${Math.random() * 360} ${Math.random() * 360 + 360} ${Math.random() * 360}; loop: true; dur: ${8000 + Math.random() * 4000}; easing: linear`);

    const trashEl = document.createElement('a-entity');
    trashEl.setAttribute('gltf-model', model.url);
    fitLoadedModel(trashEl, model.targetSizeM);
    wrapper.appendChild(trashEl);

    trashRoot.appendChild(wrapper);
    trashDecorItems.push({ el: wrapper });
  });
}

// 얼음을 하나 깰 때마다 breakLockedItem()에서 호출 — 기존 despawnRemainingIce와 같은
// "scale을 0으로 줄이는 애니메이션 후 remove()" 패턴으로 count개를 지운다.
function despawnTrashDecorBatch(count) {
  for (let i = 0; i < count && trashDecorItems.length > 0; i++) {
    const item = trashDecorItems.pop();
    item.el.setAttribute(
      'animation__despawn',
      `property: scale; to: 0.001 0.001 0.001; dur: ${BREAK_EFFECT_MS}; easing: easeInQuad`,
    );
    setTimeout(() => item.el.remove(), BREAK_EFFECT_MS + 50);
  }
}

// glb 원본의 스케일/피벗은 만든 툴마다 제각각이라, 로드된 실제 바운딩 박스를 기준으로
// 크기를 목표 치수에 맞게 자동 스케일하고 중심을 엔티티 원점에 맞춰준다. 이렇게 해두면
// 모델을 나중에 다시 내보내도(스케일이 바뀌어도) 코드 수정 없이 항상 일관된 크기로 보인다.
function fitLoadedModel(el, targetSizeM) {
  el.addEventListener('model-loaded', (e) => {
    const mesh = (e.detail && e.detail.model) || el.getObject3D('mesh');
    if (!mesh) return;
    // model-loaded는 첫 렌더 전에 올 수 있어서, 이 시점엔 wrapper/el과 모델 내부(본 포함)의 월드 행렬이
    // 아직 갱신 안 됐을 수 있다. 그 상태로 재면 박스는 낡은 행렬, 아래 worldToLocal은 새 행렬 기준이라
    // 모델이 엉뚱한 곳으로 밀려난다(장생이가 얼음 밖에 보이던 원인). 스킨드 메시(장생이/고래)는 박스를
    // 본 기준으로 계산해서 캐시하므로, 행렬을 갱신한 뒤 캐시도 비워서 다시 계산하게 한다.
    // updateWorldMatrix(자손)는 SkinnedMesh의 bindMatrixInverse를 안 갱신해서 자손 쪽은 updateMatrixWorld로.
    el.object3D.updateWorldMatrix(true, false);
    mesh.updateMatrixWorld(true);
    mesh.traverse((o) => { if (o.isSkinnedMesh) o.boundingBox = null; });
    const box = new AFRAME.THREE.Box3().setFromObject(mesh);
    const size = new AFRAME.THREE.Vector3();
    const center = new AFRAME.THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 0) return;
    const scale = targetSizeM / maxDim;
    mesh.scale.multiplyScalar(scale);
    // Box3.setFromObject()는 월드 좌표 기준 중심을 주지만 mesh.position은 부모(el) 기준
    // 로컬 좌표라, wrapper가 이미 스폰 위치로 이동해 있으면 그 월드 이동값이 그대로 섞여
    // 들어와 모델이 스폰 지점(=targetFx 위치)에서 밀려난다. 부모 로컬 좌표로 변환해서 상쇄한다.
    const localCenter = mesh.parent.worldToLocal(center);
    mesh.position.sub(localCenter.multiplyScalar(scale));
  });
}

// 타겟팅 표시: gltf-model(iceEl)은 material 컴포넌트를 안 써서 색을 바꿀 수 없으므로, 그림/텍스처
// 없이 기본 도형만으로 얼음 주변에 반짝이는 별 모양 파티클을 흩뿌려 "지금 이 얼음이 타겟됨"을
// 표시한다. 평소엔 숨겨뒀다가 타겟팅되는 순간 visible: true로 켠다.
const TARGET_FX_SPARKLE_COUNT = 6;
const TARGET_FX_SPARKLE_RADIUS_M = 0.3;
const TARGET_FX_COLOR = '#eafcff';

// 십자로 겹친 얇은 사각형 2장 = 별 모양 반짝임.
function createSparkle() {
  const sparkle = document.createElement('a-entity');
  const bar1 = document.createElement('a-entity');
  bar1.setAttribute('geometry', 'primitive: plane; width: 0.05; height: 0.006');
  bar1.setAttribute('material', `color: ${TARGET_FX_COLOR}; shader: flat; opacity: 0.95; transparent: true; side: double`);
  sparkle.appendChild(bar1);
  const bar2 = document.createElement('a-entity');
  bar2.setAttribute('geometry', 'primitive: plane; width: 0.006; height: 0.05');
  bar2.setAttribute('material', `color: ${TARGET_FX_COLOR}; shader: flat; opacity: 0.95; transparent: true; side: double`);
  sparkle.appendChild(bar2);
  return sparkle;
}

function createTargetFx() {
  const fx = document.createElement('a-entity');
  fx.setAttribute('visible', false);

  for (let i = 0; i < TARGET_FX_SPARKLE_COUNT; i++) {
    const sparkle = createSparkle();
    // 얼음 표면 주변 구 껍질 위에 무작위로 흩뿌린다(고리 모양으로 도는 대신 입체적으로 반짝임).
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    const r = TARGET_FX_SPARKLE_RADIUS_M * (0.75 + Math.random() * 0.25);
    sparkle.setAttribute('position', `${r * Math.sin(phi) * Math.cos(theta)} ${r * Math.cos(phi)} ${r * Math.sin(phi) * Math.sin(theta)}`);
    sparkle.setAttribute('rotation', `${Math.random() * 360} ${Math.random() * 360} ${Math.random() * 360}`);

    // 서로 다른 길이/지연으로 반짝여서 한꺼번에 켜졌다 꺼지는 대신 각자 따로 깜빡이게 한다.
    const dur = 700 + Math.random() * 600;
    const delay = Math.random() * 1200;
    sparkle.setAttribute(
      'animation__twinkle',
      `property: scale; from: 0.001 0.001 0.001; to: 1 1 1; dir: alternate; loop: true; dur: ${dur}; delay: ${delay}; easing: easeInOutSine`,
    );
    fx.appendChild(sparkle);
  }

  return fx;
}

// 얼음+장생이(wrapper)가 사용자(카메라) 쪽을 정면으로 보게 한다. 두 모델 다 정면이 로컬 +Z라서
// Y축 회전만으로 +Z를 사용자 쪽으로 돌린다 — lookAt처럼 높이 차이로 앞뒤로 기울지 않게 yaw만 쓴다.
// 스폰/재배치 때만 계산하고, 이후 사용자가 움직여도 계속 따라 돌지는 않는다.
function faceUserYaw(wrapper, pos, userPos) {
  const yawDeg = AFRAME.THREE.MathUtils.radToDeg(Math.atan2(userPos.x - pos.x, userPos.z - pos.z));
  wrapper.setAttribute('rotation', `0 ${yawDeg} 0`);
}

function spawnIceItems() {
  // 스폰 시점의 실제 카메라 위치를 원점으로 삼는다(스캔 대기 없이 바로 부르므로 "지금 서 있는
  // 자리" 기준 360도 배치가 됨). 아직 트래킹 포즈를 못 읽은 극초반이면 (0,0,0)으로 대체.
  const pose = getCameraPose();
  const origin = pose ? pose.camPos : { x: 0, y: 0, z: 0 };

  const sector = (Math.PI * 2) / SPAWN_COUNT;
  for (let i = 0; i < SPAWN_COUNT; i++) {
    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    // 완전 랜덤 각도 대신 방위각을 SPAWN_COUNT개 구간으로 나눠 그 안에서만 무작위로 잡는다 —
    // 순수 랜덤이면 우연히 여러 개가 한쪽에 몰릴 수 있는데, 이렇게 하면 사용자 주변에 고르게 흩어짐.
    const theta = sector * i + Math.random() * sector;
    const phi = Math.acos((Math.random() * 2) - 1);
    const worldPos = {
      x: origin.x + radius * Math.sin(phi) * Math.cos(theta),
      y: origin.y + SPAWN_HEIGHT_OFFSET_M + radius * Math.sin(phi) * Math.sin(theta) * 0.4, // 세로 범위는 좀 좁게
      z: origin.z + radius * Math.cos(phi),
    };

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('position', `${worldPos.x} ${worldPos.y} ${worldPos.z}`);
    faceUserYaw(wrapper, worldPos, origin);

    const iceEl = document.createElement('a-entity');
    iceEl.setAttribute('gltf-model', ICE_MODEL_URL);
    // 로드는 해두되 재생은 안 함 — 글TF 기본 포즈가 이미 "온전한 얼음"이라 가만히 있으면
    // 정지된 얼음처럼 보이고, breakLockedItem()에서 깨지는 순간 playClip으로 재생한다.
    iceEl.setAttribute('gltf-animation', 'clip: Ice_Break_1_5s; autoplay: false; loop: false');
    fitLoadedModel(iceEl, ICE_MODEL_TARGET_SIZE_M);
    wrapper.appendChild(iceEl);

    const mascotEl = document.createElement('a-entity');
    mascotEl.setAttribute('gltf-model', MASCOT_MODEL_URL);
    fitLoadedModel(mascotEl, MASCOT_MODEL_TARGET_SIZE_M);
    // 더 이상 숨기지 않는다 — 얼음 재질이 이미 반투명(alpha 0.26)이라 얼음 속 장생이가 비쳐 보인다.
    // 얼어붙은 느낌을 주려고 로드만 해두고(기본 포즈로 정지) 구출되는 순간에만 Bounce를 재생한다.
    mascotEl.setAttribute('gltf-animation', 'clip: Baby_Bounce_Loop; autoplay: false; loop: true');
    wrapper.appendChild(mascotEl);

    const targetFx = createTargetFx();
    wrapper.appendChild(targetFx);

    trashRoot.appendChild(wrapper);

    iceItems.push({
      el: wrapper, iceEl, mascotEl, targetFx, worldPos, homePos: { ...worldPos }, removed: false,
    });
  }
  updateTrashCountText();
  trashHintEl.textContent = '얼음 쪽으로 다가가 보세요';
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// 카메라 포즈는 XR8 파이프라인 콜백이 주는 processCpuResult.reality가 아니라 실제 렌더링에
// 쓰이는 a-camera의 object3D에서 직접 읽는다. 파이프라인 콜백 값은 렌더링에 실제로 쓰인
// 그 프레임의 포즈와 타이밍/보정이 미묘하게 어긋날 수 있는데, 그 어긋남만큼 lock된
// 오브젝트가 화면 중앙이 아니라 한쪽으로 쏠려 보이거나(왼쪽/오른쪽 고정) 사용자가 계속
// 움직이는 동안 그 오차가 누적돼 점점 화면 밖으로 밀려나는 것처럼 보이는 원인이었다.
// a-camera 자체에서 읽으면 렌더링에 쓰인 포즈와 항상 정확히 일치한다.
// 매 프레임 호출되므로(updateLock -> onUpdate) 매번 새 Vector3/Quaternion을 만들지 않고
// 재사용 — GC 압박을 줄여 인터랙션 중 프레임 드랍(체감 렉)을 완화한다. 반환값을 오래
// 들고 있지 않고 그 프레임 안에서만 쓰는 호출부라 재사용해도 안전하다.
const poseScratch = {
  camPos: new AFRAME.THREE.Vector3(),
  camQuat: new AFRAME.THREE.Quaternion(),
  forward: new AFRAME.THREE.Vector3(),
};
const toItemScratch = new AFRAME.THREE.Vector3();

function getCameraPose() {
  try {
    const { camPos, camQuat, forward } = poseScratch;
    cameraEl.object3D.getWorldPosition(camPos);
    cameraEl.object3D.getWorldQuaternion(camQuat);
    forward.set(0, 0, -1).applyQuaternion(camQuat);
    return { camPos, forward };
  } catch (e) {
    console.error('[ice] 카메라 위치/방향 계산 실패', e);
    if (DEBUG) debugLog(`camera pose failed: ${(e && e.message) || e}`);
    return null;
  }
}

// 스폰 후 스케일 재추정 등으로 너무 멀어진 얼음을 지금 서 있는 위치 기준으로 다시 배치한다.
// 이미 타겟팅(lock)된 얼음은 상호작용 도중일 수 있으니 건드리지 않는다.
function reclampFarIceItems(camPos) {
  iceItems.forEach((t) => {
    if (t.removed || t === lockedItem) return;
    if (dist(camPos, t.worldPos) <= MAX_DRIFT_DISTANCE_M) return;

    const radius = SPAWN_MIN_M + Math.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    t.worldPos = {
      x: camPos.x + radius * Math.sin(phi) * Math.cos(theta),
      y: camPos.y + SPAWN_HEIGHT_OFFSET_M + radius * Math.sin(phi) * Math.sin(theta) * 0.4,
      z: camPos.z + radius * Math.cos(phi),
    };
    t.homePos = { ...t.worldPos };
    t.el.removeAttribute('animation__pull'); // 원위치로 돌아가던 중이면 그 애니메이션이 새 위치를 덮어쓰지 않게
    t.el.setAttribute('position', `${t.worldPos.x} ${t.worldPos.y} ${t.worldPos.z}`);
    faceUserYaw(t.el, t.worldPos, camPos); // 새 위치에서도 사용자 쪽을 보게
  });
}

// 얼음(wrapper)을 pos로 부드럽게 이동시킨다. worldPos도 같이 바꿔서 해제 판정(updateLock)이 새 위치
// 기준으로 동작하게 한다. 같은 이름의 애니메이션을 다시 걸면 진행 중이던 이동을 덮어쓰고 새로 시작.
function moveIceTo(item, pos) {
  item.worldPos = pos;
  item.el.setAttribute(
    'animation__pull',
    `property: position; to: ${pos.x} ${pos.y} ${pos.z}; dur: ${PULL_MS}; easing: easeOutQuad`,
  );
}

function pullIceTowardCamera(item, camPos) {
  const d = dist(camPos, item.worldPos);
  const newD = Math.max(PULL_MIN_DISTANCE_M, d * (1 - PULL_RATIO));
  if (newD >= d) return;
  const k = newD / d;
  moveIceTo(item, {
    x: camPos.x + (item.worldPos.x - camPos.x) * k,
    y: camPos.y + (item.worldPos.y - camPos.y) * k,
    z: camPos.z + (item.worldPos.z - camPos.z) * k,
  });
}

// 예전에는 타겟팅(lock)되면 얼음을 카메라 정면 고정 거리로 "순간이동"시켰는데, 사용자 요청으로
// 그 방식은 없앴다. 이제 얼음은 스폰된 실제 위치에 계속 그대로 있고, 타겟팅되면
// 파티클 이펙트(targetFx)가 뜨고 살짝 커지며(TARGETED_ICE_SCALE), 월드 공간에서 사용자 쪽으로
// 조금 당겨진다(pullIceTowardCamera — 카메라에 붙이지 않으므로 고개를 돌리면 화면 밖으로 나감).
// 이미 타겟팅된 뒤에는 그 얼음을 계속 보고 있는지 확인해서, 타겟팅 후 GAZE_COLLECT_MS가 지나면
// 깨서 수집하고, 다른 곳을 UNLOCK_GRACE_MS 이상 보고 있으면 타겟팅을 풀어 다시 아무 얼음이나
// 고를 수 있게 한다.
function updateLock() {
  const pose = getCameraPose();
  if (!pose) return;
  const { camPos, forward } = pose;

  if (lockedItem) {
    const t = lockedItem;
    toItemScratch.set(t.worldPos.x - camPos.x, t.worldPos.y - camPos.y, t.worldPos.z - camPos.z).normalize();
    const stillWatching = dist(camPos, t.worldPos) < UNLOCK_DISTANCE_M
      && toItemScratch.dot(forward) >= UNLOCK_GAZE_DOT_THRESHOLD;
    if (stillWatching) {
      lockLostSince = null;
      const elapsed = performance.now() - lockStartedAt;
      if (elapsed >= GAZE_COLLECT_MS) {
        breakLockedItem();
      } else {
        const remainSec = Math.ceil((GAZE_COLLECT_MS - elapsed) / 1000);
        trashHintEl.textContent = `얼음을 계속 바라봐 주세요 (${remainSec})`;
      }
    } else if (lockLostSince === null) {
      lockLostSince = performance.now();
    } else if (performance.now() - lockLostSince >= UNLOCK_GRACE_MS) {
      releaseLock();
    }
    return;
  }

  reclampFarIceItems(camPos);

  // 순수 실측 거리만 보지 않고, "바라보고 있으면서 + 어느 정도 가까워졌는지"를 같이 본다.
  const candidate = iceItems.find((t) => {
    if (t.removed || dist(camPos, t.worldPos) >= LOCK_DISTANCE_M) return false;
    toItemScratch.set(t.worldPos.x - camPos.x, t.worldPos.y - camPos.y, t.worldPos.z - camPos.z).normalize();
    return toItemScratch.dot(forward) >= LOCK_GAZE_DOT_THRESHOLD;
  });

  // 조건을 만족하는 순간 바로 타겟팅하지 않고, LOCK_DWELL_MS만큼 그 얼음을 계속 바라보고
  // 있어야 확정한다 — 스쳐 지나가듯 잠깐 조건을 만족한 것만으로 타겟팅되는 걸 막기 위함.
  if (candidate !== lockCandidate) {
    lockCandidate = candidate || null;
    lockCandidateStartedAt = candidate ? performance.now() : null;
    return;
  }
  if (!candidate) return;
  if (performance.now() - lockCandidateStartedAt < LOCK_DWELL_MS) return;

  lockedItem = candidate;
  lockStartedAt = performance.now();
  lockCandidate = null;
  lockCandidateStartedAt = null;
  lockedItem.targetFx.setAttribute('visible', true);
  lockedItem.iceEl.setAttribute('scale', `${TARGETED_ICE_SCALE} ${TARGETED_ICE_SCALE} ${TARGETED_ICE_SCALE}`);
  trashHintEl.textContent = `얼음을 계속 바라봐 주세요 (${Math.ceil(GAZE_COLLECT_MS / 1000)})`;
  if (DEBUG) { debugState.locked = true; debugLog('locked'); }
  pullIceTowardCamera(lockedItem, camPos);
}

// 시선 이탈로 타겟팅을 푼다 — 얼음은 원래 크기/이펙트 없음 상태로 되돌리고, 다음에 다시
// 타겟팅되면 응시 시간(GAZE_COLLECT_MS)을 처음부터 다시 센다.
function releaseLock() {
  const item = lockedItem;
  if (!item) return;
  item.targetFx.setAttribute('visible', false);
  item.iceEl.setAttribute('scale', '1 1 1');
  moveIceTo(item, { ...item.homePos }); // 당겨왔던 얼음을 원래 자리로 되돌림
  lockedItem = null;
  lockStartedAt = null;
  lockLostSince = null;
  if (DEBUG) debugState.locked = false;
  trashHintEl.textContent = '얼음을 다시 바라봐 주세요';
  if (DEBUG) debugLog('lock released: looked away');
}

function updateTrashCountText() {
  trashCountText.textContent = `${rescuedCount}/${RESCUE_COUNT}`;
}

const distanceTrackerModule = {
  name: 'trash-distance-tracker',
  onUpdate: ({ processCpuResult }) => {
    if (!processCpuResult.reality) return; // 트래킹이 아직 준비 안 된 경우를 걸러내는 용도로만 사용
    updateLock();
  },
};

// --- 깨짐 이펙트 ---
// 얼음/장생이 둘 다 실제 애니메이션 클립을 갖고 있어서(Ice_Break_1_5s, Baby_Bounce_Loop),
// 아래 타이밍은 임의값이 아니라 그 클립들의 실제 길이 그대로다.
// BREAK_EFFECT_MS는 이 연출과 무관하게 다른 곳(못 깬 나머지 얼음 정리, 장식 쓰레기 소멸)에서
// 계속 쓰는 짧은 페이드용 상수라 그대로 둔다.
const BREAK_EFFECT_MS = 800;
const ICE_SHATTER_MOMENT_MS = 500; // Ice_Break_1_5s에서 Ice_Intact가 사라지고 파편이 튀는 순간(글TF 키프레임 확인)
const BOUNCE_CLIP_MS = 2033; // Baby_Bounce_Loop 한 번 길이(통통 2회)
const BOUNCE_REPEAT = 2; // 구출 후 사라지기 전까지 Bounce를 몇 번 반복할지
const MASCOT_RISE_M = 0.25; // 얼음이 깨질 때 장생이가 위로 떠오르는 높이(클립엔 이동이 없어서 위치 트윈으로 처리)
const MASCOT_RISE_MS = 600;
const MASCOT_FADE_MS = 500; // Bounce 이후 사라지는 연출(클립엔 없어서 scale 페이드로 처리)
// 얼음 하나당 연출 총 길이 — 완료 화면/클리어 영상은 이 시간이 다 지난 뒤에 떠야 마지막 장생이
// 연출이 중간에 끊기지 않는다.
const RESCUE_SEQUENCE_MS = ICE_SHATTER_MOMENT_MS + BOUNCE_CLIP_MS * BOUNCE_REPEAT + MASCOT_FADE_MS;
const FINISH_DELAY_MS = 2000; // 마지막 연출이 다 끝난 뒤 이만큼 더 지나서 완료 화면을 띄움

// 목표(RESCUE_COUNT)를 다 채우면, 스폰됐지만 아직 못 깬 나머지 얼음은 그냥 없앤다.
function despawnRemainingIce() {
  for (const other of iceItems) {
    if (other.removed) continue;
    other.removed = true;
    other.el.setAttribute(
      'animation__despawn',
      `property: scale; to: 0.001 0.001 0.001; dur: ${BREAK_EFFECT_MS}; easing: easeInQuad`,
    );
    setTimeout(() => other.el.remove(), BREAK_EFFECT_MS + 50);
  }
}

function breakLockedItem() {
  const item = lockedItem;
  if (!item) return;

  item.removed = true;
  lockedItem = null;
  lockStartedAt = null;
  lockLostSince = null;
  if (DEBUG) { debugState.locked = false; debugLog('collected'); }

  // 얼음 자체가 스스로 깨진다(균열 -> 파편 흩어짐, 1.5초) — 파편을 따로 만들 필요 없음.
  item.iceEl.components['gltf-animation'].playClip('Ice_Break_1_5s', { loop: false });

  // 장생이는 얼음 속에서 정지해 있다가, 얼음이 실제로 터지는 순간(ICE_SHATTER_MOMENT_MS)에 위로
  // 떠오르면서 Baby_Bounce_Loop를 반복 재생한다(fitLoadedModel은 내부 mesh 위치만 건드려서 이
  // 엔티티 위치 트윈과 충돌하지 않음).
  const mascotAnim = item.mascotEl.components['gltf-animation'];
  setTimeout(() => {
    mascotAnim.playClip('Baby_Bounce_Loop', { loop: true });
    const { x, y, z } = item.mascotEl.object3D.position;
    item.mascotEl.setAttribute(
      'animation__rise',
      `property: position; to: ${x} ${y + MASCOT_RISE_M} ${z}; dur: ${MASCOT_RISE_MS}; easing: easeOutQuad`,
    );
  }, ICE_SHATTER_MOMENT_MS);
  // Bounce를 BOUNCE_REPEAT번 보여준 뒤 클립에 없는 "사라지는" 연출만 scale 페이드로 처리한다.
  setTimeout(() => {
    item.mascotEl.setAttribute(
      'animation__collected-fade',
      `property: scale; to: 0.001 0.001 0.001; dur: ${MASCOT_FADE_MS}; easing: easeInQuad`,
    );
  }, ICE_SHATTER_MOMENT_MS + BOUNCE_CLIP_MS * BOUNCE_REPEAT);

  setTimeout(() => {
    item.el.remove();
  }, RESCUE_SEQUENCE_MS + 50);

  rescuedCount++;
  updateTrashCountText();
  despawnTrashDecorBatch(TRASH_DECOR_PER_RESCUE);

  if (rescuedCount === RESCUE_COUNT) {
    despawnRemainingIce();
    trashHintEl.textContent = '';
    statusPillEl.textContent = '미션 완료';
    SFX.playThenLoop('ice_success', 'complete_bgm_loop');
    GameClear.markCleared('trash');
    // 이번 클리어로 두 게임이 다 깨졌으면 올클리어 — 기록은 바로 지워서 다음에 또 둘 다 깨면
    // 다시 올클리어 영상이 나오게 하고, 영상 도중 이탈해도 반복 재생되지 않게 한다.
    allCleared = GameClear.isBothCleared();
    if (allCleared) GameClear.resetCleared();
    setTimeout(() => {
      trashFinishedEl.style.display = 'block';
    }, RESCUE_SEQUENCE_MS);
    setTimeout(() => {
      if (allCleared) GameClear.playVideo(allClearVideoEl, revealCompleteOverlay);
      else revealCompleteOverlay();
    }, RESCUE_SEQUENCE_MS + FINISH_DELAY_MS);
  } else {
    SFX.play('ice_collect');
    trashHintEl.textContent = '다음 얼음을 찾아 다가가 보세요';
  }
}

// --- 촬영 팁 팝업 ---
// 게임 화면에 들어오면 "카메라로 얼음을 응시하면 수집된다"는 조작법과, 벽만 비추거나 어두우면
// World Tracking이 위치를 놓쳐 얼음이 날아간다는 촬영 팁을 몇 초간 안내한다. 게임 진행(스폰/판정)은
// 팝업과 무관하게 그대로 돌아간다.
const TIPS_POPUP_MS = 6000;
const tipsPopupEl = document.getElementById('tips-popup');
const tipsProgressBarEl = document.getElementById('tips-progress-bar');

function showTipsPopup() {
  let closed = false;
  let autoCloseTimer = null;

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(autoCloseTimer);
    tipsPopupEl.classList.remove('visible');
    setTimeout(() => { tipsPopupEl.style.display = 'none'; }, 300); // CSS opacity transition과 맞춤
  };

  tipsPopupEl.style.display = 'flex';
  tipsProgressBarEl.style.transition = 'none';
  tipsProgressBarEl.style.width = '100%';
  // display 변경이 반영된 다음 프레임에 페이드인/진행 바 애니메이션을 시작해야 transition이 먹는다.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    tipsPopupEl.classList.add('visible');
    tipsProgressBarEl.style.transition = `width ${TIPS_POPUP_MS}ms linear`;
    tipsProgressBarEl.style.width = '0%';
  }));

  autoCloseTimer = setTimeout(close, TIPS_POPUP_MS);
  tipsPopupEl.addEventListener('click', close, { once: true });
}

// onxrloaded 시점엔 아직 xrextras 로딩 화면이 덮고 있으므로, 카메라 화면이 실제로 보이기
// 시작하는 realityready에 맞춰 띄운다.
document.querySelector('a-scene').addEventListener('realityready', showTipsPopup, { once: true });

// --- 초기화 ---
// 참고: 단안 카메라 기반 SLAM은 트래킹 시작 직후 몇 초간 실측 스케일(m 단위) 추정이 아직
// 안정되지 않은 상태라, 스캔 대기 없이 바로 배치하면 스케일이 재추정될 때마다 위치가 흔들려서
// "다가가면 오히려 멀어지는" 것처럼 보일 수 있다(사용자 요청으로 스캔 대기 단계를 제거함).
const onxrloaded = () => {
  XR8.XrController.configure({ scale: 'absolute' }); // 실측(미터) 스케일 요청
  XR8.addCameraPipelineModule(XR8.XrController.pipelineModule());
  XR8.addCameraPipelineModule(distanceTrackerModule);

  spawnIceItems();
  spawnDecorativeWhales();
  spawnDecorativeReef();
  spawnTrashDecor();
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

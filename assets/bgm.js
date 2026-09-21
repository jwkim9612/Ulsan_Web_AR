// 셸(app.html)에 상주하는 게임 전체 BGM 컨트롤러.
//   <script src="assets/bgm.js" data-base="assets/sounds/"></script>
// 라우트(iframe)가 몇 번을 바뀌어도 이 오디오는 절대 재생성되지 않는다 — 셸 문서 자체가
// 리로드되지 않기 때문. 그래서 최초 1회만 재생에 성공하면 그 뒤로는 끊김없이 계속 흐른다.
//
// 셸 문서 자신은 화면 전체를 덮은 iframe 때문에 사용자의 pointerdown을 직접 받을 일이 없다
// (그 이벤트는 iframe 쪽 문서에서 발생하고, 문서 경계를 넘어 부모로 버블링되지 않는다). 대신
// 브라우저의 "사용자 활성화(user activation)" 상태는 명세상 동일 출처 iframe에서의 클릭 시
// 조상 프레임(부모)에도 함께 전파된다 — 그래서 iframe 안에서 첫 클릭이 일어난 "직후" 부모가
// ensureStarted()를 다시 호출해주기만 하면(js/router.js가 'ulsanAR:firstInteraction' 메시지를
// 받아서 호출) 그 시점엔 이미 부모 창도 활성화된 상태라 재생이 허용된다.
(function () {
  const BASE = document.currentScript.dataset.base;

  // 전용 트랙(assets/sounds/bgm_main_loop.wav)이 아직 없어서, 준비될 때까지는 기존
  // complete_bgm_loop.wav를 임시로 재생해둔다. 실제 파일이 생기면 TRACK만 바꾸면 된다.
  const TRACK = 'complete_bgm_loop';

  const audio = new Audio(`${BASE}${TRACK}.wav`);
  audio.loop = true;
  audio.volume = 0.5;
  let started = false;

  // 활성화 전에 호출되면 조용히 실패하는 게 정상이라, started는 실제로 재생에 "성공"했을
  // 때만 true로 바꾼다 — 그래야 나중에(첫 상호작용 시점에) 다시 불러도 재시도가 된다.
  function ensureStarted() {
    if (started) return;
    audio.play().then(() => { started = true; }).catch(() => {});
  }

  function pause() {
    audio.pause();
  }

  function resume() {
    if (started) audio.play().catch(() => {});
  }

  function setVolume(v) {
    audio.volume = v;
  }

  window.BGM = { ensureStarted, pause, resume, setVolume };
})();

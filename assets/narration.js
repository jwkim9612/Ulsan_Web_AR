// 셸(app.html)에 상주하는 성우 내레이션 컨트롤러. 라우트별 내레이션은 js/router.js가
// 라우트 전환 시점에 직접 Narration.play(파일명)를 호출해서 튼다 — iframe 문서가 로드/신호를
// 보낼 때까지 기다리지 않으므로 지연이 없다.
//
// 사용자 상호작용이 아직 없는 시점(예: 앱 최초 로드)에 play()가 호출되면 브라우저가 조용히
// 막는다. 이때는 재생 실패로 두고, js/router.js가 iframe 쪽에서 첫 상호작용이 일어났다는
// 신호('ulsanAR:firstInteraction')를 받으면 retry()를 호출해서 그 자리에서 다시 시도한다.
//   <script src="assets/narration.js" data-base="assets/sounds/"></script>
(function () {
  const BASE = document.currentScript.dataset.base;
  let current = null;

  function play(name) {
    if (!name) return;
    stop();
    const audio = new Audio(`${BASE}${name}`);
    current = audio;
    audio.play().catch(logUnlessAborted('재생 실패', name));
  }

  function stop() {
    if (current) {
      current.pause();
      current = null;
    }
  }

  function retry() {
    if (current && current.paused && current.currentTime === 0) {
      current.play().catch(logUnlessAborted('재시도 실패'));
    }
  }

  // retry()가 진행 중일 때 거의 동시에 다음 라우트로 넘어가 stop()이 그 오디오를 pause()해버리면
  // play() 프로미스가 AbortError로 거절된다 — 실제 재생 실패가 아니라 우리가 의도적으로 끊은
  // 것이므로 콘솔에 에러로 남기지 않는다.
  function logUnlessAborted(label, name) {
    return (err) => {
      if (err && err.name === 'AbortError') return;
      console.warn(`[Narration] ${label}:`, name || '', err);
    };
  }

  window.Narration = { play, stop, retry };
})();

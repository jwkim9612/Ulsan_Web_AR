// 공용 효과음 재생 유틸. 각 페이지에서 아래처럼 불러와 쓴다:
//   <script src="assets/sfx.js" data-base="assets/sounds/"></script>       (루트 페이지)
//   <script src="../assets/sfx.js" data-base="../assets/sounds/"></script> (ar-scene 페이지)
// data-base는 그 페이지 기준 sounds 폴더 상대경로 — 페이지 위치에 따라 값만 다르게 준다.
// <button> 클릭은 이 파일이 자동으로 button_click을 재생해주므로 페이지 쪽에서 따로 호출할
// 필요 없고, 미션 완료처럼 특수한 효과음(성공음 -> 배경음 loop 전환)만 SFX.playThenLoop로 쓴다.
(function () {
  const BASE = document.currentScript.dataset.base;

  function src(name) {
    return `${BASE}${name}.wav`;
  }

  function play(name) {
    // 캐시된 Audio를 재사용하면 빠르게 연타할 때 이전 재생이 끊기므로,
    // 매번 새 Audio 인스턴스로 재생해서 겹쳐 들리게 한다.
    const audio = new Audio(src(name));
    audio.play().catch((err) => console.warn('[SFX] 재생 실패:', name, err));
    return audio;
  }

  // --- 모바일 오디오 자동재생 잠금 해제 ---
  // 퍼즐/고래구조 페이지의 효과음은 클릭이 아니라 AR 트래킹 tick 콜백(거리/응시 판정, 손 인식
  // 결과)에서 재생을 시도한다. 그런데 이 페이지들은 이전 화면(카메라 켜기 버튼 등)의 사용자
  // 제스처가 이어지지 않는 새 문서라, 브라우저 자동재생 정책에 따라 이 첫 프로그램적 재생
  // 시도가 조용히 막힐 수 있다(기기/세션마다 다르게 막혀서 "가끔 소리가 안 남"으로 보임).
  // 이 문서 안에서 사용자가 처음 화면을 터치/클릭하는 순간(뒤로가기 버튼이든 그냥 화면을
  // 만지는 것이든) 무음에 가까운 초단타 오디오를 재생해두면, 그 뒤로 같은 문서 안에서
  // 코드로 트리거하는 재생도 대부분의 모바일 브라우저에서 허용된다.
  // app.html 셸의 iframe 라우트 안에서 실행 중이면, 이 문서에서 첫 상호작용이 일어났다는
  // 신호를 부모(셸)에도 보낸다 — 동일 출처 iframe의 클릭은 명세상 부모 창의 "사용자 활성화"
  // 상태도 함께 켜주므로, 그 직후 부모가 BGM/내레이션 재생을 재시도하면 성공한다(부모 문서는
  // 화면 전체를 덮은 iframe 때문에 자기 자신의 pointerdown을 직접 받을 방법이 없어서, 이렇게
  // 자식이 알려줘야 한다). 셸 관련 코드는 js/router.js 참고.
  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  function unlockAudio() {
    const unlock = new Audio(SILENT_WAV);
    unlock.play().then(() => unlock.pause()).catch(() => {});
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'ulsanAR:firstInteraction' }, location.origin);
    }
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });

  function playThenLoop(name, loopName) {
    const audio = play(name);
    // loop용 오디오를 'ended' 시점에 새로 만들면 그때부터 다운로드가 시작돼서 재생이 늦거나
    // 조용히 실패할 수 있음 — 성공음이 재생되는 동안 미리 만들어서 로드해둔다.
    const loop = new Audio(src(loopName));
    loop.loop = true;
    loop.preload = 'auto';
    audio.addEventListener('ended', () => {
      loop.currentTime = 0;
      loop.play().catch((err) => console.error('[SFX] loop 재생 실패', err));
    });
    return audio;
  }

  // 버튼 클릭과 동시에 페이지를 바꾸면 오디오가 실제로 소리를 내기도 전에 언로드돼서 클릭음이
  // 안 들린다 — 버튼의 onclick에서 직접 이동시키는 대신 이 함수로 살짝(기본 180ms) 지연시켜서
  // 클릭음이 들릴 시간을 확보한다.
  // app.html 셸의 iframe 라우트 안에서 실행 중이면(window.parent !== window) 실제 페이지 이동
  // 대신 셸에 라우트 전환을 요청한다(postMessage) — 셸에 상주하는 BGM/내레이션이 끊기지 않게
  // 하기 위함. url은 지금까지와 동일하게 "이 문서 기준 상대경로"를 그대로 넘기면 되고, 셸이
  // 이해할 수 있는 절대 경로(pathname)로 변환해서 보낸다. 셸 없이 이 파일을 직접 열었을 때는
  // 예전처럼 location.href로 폴백한다.
  function navigate(url, delayMs = 180) {
    setTimeout(() => {
      if (window.parent !== window) {
        const pathname = new URL(url, location.href).pathname;
        window.parent.postMessage({ type: 'ulsanAR:navigate', pathname }, location.origin);
      } else {
        location.href = url;
      }
    }, delayMs);
  }

  window.SFX = { play, playThenLoop, navigate };

  document.addEventListener('click', (e) => {
    if (e.target.closest('button')) play('button_click');
  });
})();

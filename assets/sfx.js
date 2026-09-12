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
    audio.play().catch(() => {});
    return audio;
  }

  function playThenLoop(name, loopName) {
    const audio = play(name);
    audio.addEventListener('ended', () => {
      const loop = new Audio(src(loopName));
      loop.loop = true;
      loop.play().catch(() => {});
    });
    return audio;
  }

  window.SFX = { play, playThenLoop };

  document.addEventListener('click', (e) => {
    if (e.target.closest('button')) play('button_click');
  });
})();

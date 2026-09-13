// 두 게임(퍼즐/고래구조) 클리어 상태 저장 + 클리어/올클리어 영상 재생 공용 유틸.
// 각 페이지에서 sfx.js와 같은 방식으로 불러와 쓴다:
//   <script src="../assets/game-clear.js"></script>
// 클리어 여부는 페이지 이동(전체 새로고침)을 넘어 유지돼야 하므로 localStorage에 저장한다.
(function () {
  const KEYS = {
    puzzle: 'ulsanAR.puzzleCleared',
    trash: 'ulsanAR.trashCleared',
  };

  function markCleared(game) {
    try {
      localStorage.setItem(KEYS[game], '1');
    } catch (e) {
      console.warn('[GameClear] localStorage 쓰기 실패', e);
    }
  }

  function isBothCleared() {
    try {
      return localStorage.getItem(KEYS.puzzle) === '1' && localStorage.getItem(KEYS.trash) === '1';
    } catch (e) {
      return false;
    }
  }

  function resetCleared() {
    try {
      localStorage.removeItem(KEYS.puzzle);
      localStorage.removeItem(KEYS.trash);
    } catch (e) {
      console.warn('[GameClear] localStorage 초기화 실패', e);
    }
  }

  // 영상은 반드시 끝까지 봐야 하는 연출이라 'ended'가 안 뜨는 예외 상황(디코딩 실패, 자동재생이
  // 소리 켠 채로도 무음 상태로도 다 막히는 경우 등)에도 게임이 영원히 멈춰있으면 안 된다 —
  // 그래서 소리 재생 실패 시 무음으로 자동 전환하고, 그마저 실패하면 바로 다음 단계로 넘기며,
  // 영상 길이(15초)보다 넉넉한 타임아웃을 안전장치로 걸어둔다.
  const SAFETY_TIMEOUT_MS = 25000;

  function playVideo(videoEl, onEnded) {
    if (!videoEl) {
      onEnded();
      return;
    }

    let finished = false;
    let safetyTimer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimer);
      videoEl.removeEventListener('ended', finish);
      videoEl.pause();
      videoEl.style.display = 'none';
      onEnded();
    };

    safetyTimer = setTimeout(finish, SAFETY_TIMEOUT_MS);
    videoEl.addEventListener('ended', finish);

    videoEl.style.display = 'block';
    videoEl.currentTime = 0;
    videoEl.muted = false;
    videoEl.play().catch((err) => {
      console.warn('[GameClear] 소리 켠 영상 재생 실패, 무음으로 재시도', err);
      videoEl.muted = true;
      videoEl.play().catch((err2) => {
        console.warn('[GameClear] 무음 영상 재생도 실패, 다음 단계로 진행', err2);
        finish();
      });
    });
  }

  window.GameClear = { markCleared, isBothCleared, resetCleared, playVideo };
})();

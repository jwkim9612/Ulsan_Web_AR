// app.html 셸의 라우터. 라우트 이름 <-> 실제 파일 경로를 매핑하고, 해시 기반으로 iframe의
// src를 바꿔서 라우트를 전환한다. 각 라우트 페이지의 SFX.navigate()가 postMessage로 보내는
// "이동하려는 경로의 pathname"을 받아서 어떤 라우트인지 찾아 전환한다.
(function () {
  const ROUTES = {
    home:   { path: 'routes/home.html',    narration: 'narr_home.mp3' },
    intro:  { path: 'camera-intro.html',   narration: 'narr_intro.mp3' },
    scan:   { path: 'ar-scene/scan.html',  narration: null },
    puzzle: { path: 'ar-scene/index.html', narration: null },
    trash:  { path: 'ar-scene/trash.html', narration: null },
  };
  const DEFAULT_ROUTE = 'home';

  // 각 라우트의 실제 파일 경로를 셸 문서(app.html) 기준 절대 pathname으로 한 번만 계산해둔다.
  const RESOLVED_PATH_TO_ROUTE = {};
  Object.entries(ROUTES).forEach(([name, cfg]) => {
    const pathname = new URL(cfg.path, document.baseURI).pathname;
    RESOLVED_PATH_TO_ROUTE[pathname] = name;
  });

  // 기존 페이지들의 SFX.navigate() 호출 문자열 중, 라우트의 "정식 파일 경로"와 다른 것들에
  // 대한 별칭. 예: camera-intro.html의 뒤로가기 버튼은 지금도 SFX.navigate('index.html')을
  // 그대로 호출하는데(코드 변경 없음 원칙), 그 파일은 home 라우트의 실제 파일(routes/home.html)
  // 이 아니라 원래 index.html이므로 별도로 매핑해준다.
  RESOLVED_PATH_TO_ROUTE[new URL('index.html', document.baseURI).pathname] = 'home';

  const frame = document.getElementById('route-frame');

  function routeNameFromPathname(pathname) {
    return RESOLVED_PATH_TO_ROUTE[pathname] || null;
  }

  function routeNameFromHash() {
    const name = location.hash.replace(/^#/, '');
    return ROUTES[name] ? name : DEFAULT_ROUTE;
  }

  // 실제로 라우트를 적용하는 부분(iframe src 교체 + BGM/내레이션 트리거). hashchange 이벤트
  // 하나당 정확히 한 번만 호출되어야 한다 — 두 번 호출되면 iframe이 두 번 로드되거나 내레이션이
  // 불필요하게 재시작된다.
  function applyRoute(routeName) {
    const cfg = ROUTES[routeName];
    if (!cfg) return;

    frame.src = cfg.path;

    if (window.BGM) window.BGM.ensureStarted();
    if (window.Narration) {
      if (cfg.narration) window.Narration.play(cfg.narration);
      else window.Narration.stop();
    }
  }

  // location.hash를 바꾸면 브라우저가 비동기로 hashchange를 발생시키고, 그때 applyRoute가
  // 호출된다. 이미 원하는 해시라면(hashchange가 안 일어남) 여기서 직접 한 번만 적용한다.
  function goTo(routeName) {
    if (!ROUTES[routeName]) return;
    if (location.hash.replace(/^#/, '') === routeName) {
      applyRoute(routeName);
    } else {
      location.hash = routeName;
    }
  }

  window.addEventListener('hashchange', () => applyRoute(routeNameFromHash()));

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data) return;

    if (data.type === 'ulsanAR:navigate') {
      const routeName = routeNameFromPathname(data.pathname);
      if (routeName) {
        goTo(routeName);
      } else {
        console.warn('[Router] 알 수 없는 경로:', data.pathname);
      }
    } else if (data.type === 'ulsanAR:firstInteraction') {
      // 동일 출처 iframe 안에서 첫 클릭이 일어났다는 신호 — 이 시점엔 부모 창도 활성화된
      // 상태이므로, 페이지 로드 직후엔 막혔던 BGM/내레이션 재생을 여기서 다시 시도한다.
      if (window.BGM) window.BGM.ensureStarted();
      if (window.Narration) window.Narration.retry();
    }
  });

  // 최초 진입: 해시가 있으면 그 라우트로, 없으면 기본 라우트(home)로.
  goTo(routeNameFromHash());
})();

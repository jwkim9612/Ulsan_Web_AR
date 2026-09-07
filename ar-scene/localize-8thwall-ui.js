// 8th Wall/xrextras가 런타임에 DOM으로 직접 그려 넣는 카메라/모션 센서 권한 안내 문구가
// 영어 원문 그대로 나온다. 소스가 CDN에서 받아오는 번들(xrextras.js, xr.js) 안에 문자열로
// 박혀 있어 우리 쪽 코드에서 직접 고칠 수 없으므로, DOM에 나타나는 순간을 감지해 한글로
// 바꿔치기한다. 두 스크립트는 async라 로딩 순서가 보장되지 않으므로 head에서 최대한 일찍
// MutationObserver를 걸어둔다.

function localizeRequestingCameraPermissions() {
  const el = document.getElementById('requestingCameraPermissions');
  if (!el) return;
  Array.from(el.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Allow')) {
      node.textContent = " AR 사용을 위해 '허용'을 눌러주세요";
    }
  });
}

// xr.js가 iOS 기기 방향/동작 센서 권한을 요청하기 전에 띄우는 확인창(.prompt-box-8w).
function localizePromptBox(box) {
  const message = box.querySelector('p');
  if (message && message.textContent.includes('device motion sensors')) {
    message.textContent = 'AR 기능을 사용하려면 기기의 동작 센서 접근 권한이 필요합니다';
  }
  box.querySelectorAll('button').forEach((btn) => {
    const text = btn.textContent.trim();
    if (text === 'Cancel') btn.textContent = '취소';
    if (text === 'Continue') btn.textContent = '계속';
  });
}

const uiObserver = new MutationObserver((mutations) => {
  localizeRequestingCameraPermissions();
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.classList && node.classList.contains('prompt-box-8w')) {
        localizePromptBox(node);
      }
    });
  });
});
uiObserver.observe(document.documentElement, { childList: true, subtree: true });

localizeRequestingCameraPermissions();

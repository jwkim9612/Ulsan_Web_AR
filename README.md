# Ulsan_AR

akp_gabiya의 AR 미니게임 2종을 로그인/카드수집 없이, 휴대폰 웹 브라우저 단독으로 즐길 수 있게 만든 버전.
Unity 대신 8th Wall Web(오픈소스 전환, https://8thwall.org) + 순수 JS로 제작. 울산 이벤트용.

## 첫 화면 (index.html)

배경 이미지 풀스크린 + 상단 중앙 로고("울산 AR") + 하단 중앙 "입장" 버튼 → `select.html`(게임 선택)로 이동.
`assets/images/bg.jpg`, `assets/images/logo.png` 자리에 실제 이미지 넣으면 됨.

## 게임 2종

- **puzzle/** — 이미지 마커 인식 퍼즐. 카드 4장을 카메라로 인식하면 조각이 채워지고, 4개 다 모으면 완성.
  (원본: `akp_gabiya/Assets/Scripts/AR/PuzzleGame.cs`. 3세트 중 1세트만 사용, 이미지만 교체)
- **seaclean/** — 바다 배경 쓰레기 청소 게임. 카메라 주변에 쓰레기 오브젝트를 배치해두고, 손으로 쓰다듬으면 사라짐.
  목표 개수 다 치우면 완료.
  (원본: `akp_gabiya/Assets/Scripts/AR/IceBreakGame.cs`를 재해석 — 얼음벌→쓰레기, 여왕 처치 연출/파티클은 이번 범위 제외)

## 스코프에서 뺀 것

로그인, 카드 수집/보상, Firebase, 파티클 이펙트(추후 추가), 보스(여왕) 처치 연출.

## 필요한 준비물 (사용자 측)

1. https://8thwall.org 에서 계정/API 키 확인 (유료 플랫폼은 종료됐고 오픈소스 엔진 사용)
2. Puzzle용 마커 이미지 4장
3. 정적 호스팅 방식 결정 (Vercel / Netlify / GitHub Pages 등, 나중에 정해도 됨)

## 로컬 실행

```
npm install
npm run dev
```

폰 카메라(마커 인식/손 인식)는 HTTPS가 아니면 브라우저가 권한을 안 줍니다. PC에서 `localhost`로 띄운 걸
실제 폰으로 테스트하려면 `ngrok http 8080` 같은 터널링 도구로 HTTPS 주소를 하나 만들어서 폰 브라우저로 접속하세요.

여기에 마커 4개의 인식 데이터(JSON)를 넣습니다: `p_1.json`, `p_2.json`, `p_3.json`, `p_4.json`

## 만드는 법

1. 실물 카드로 쓸 이미지 4장 준비(대비가 뚜렷하고 패턴이 복잡한 이미지일수록 인식 잘 됨. 단색/반복 패턴은 피할 것)
2. 아래 명령 실행:
   ```
   npx @8thwall/image-target-cli@latest
   ```
3. 대화형으로 이미지 경로를 물어보면 이미지 하나씩 넣고, 타겟 이름을 `p_1`, `p_2`, `p_3`, `p_4`로 지정
4. 생성된 `p_1.json` 등 파일을 이 폴더에 복사

이름(`p_1`~`p_4`)은 `ar-scene/index.html`의 `<xrextras-named-image-target name="...">` 및
`ar-scene/puzzle.js`의 `PIECE_NAMES`와 반드시 일치해야 합니다.

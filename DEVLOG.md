# DEVLOG

## 실제로 구현한 기능

- `start.bat`: Node/npm 확인 → `node_modules` 없으면 자동 `npm install` → dev server 실행 (vite `server.open`으로 브라우저 자동 오픈) → 오류 시 pause로 창 유지
- MP3 라이브러리: 파일 선택/다중 선택/drag & drop import, IndexedDB에 Blob 저장, 목록/삭제/곡별 최고 점수 표시, 재시작 후 유지
- SEGMENT SELECT: Canvas waveform(peak 추출) + 선택 구간 반전 표시 + playhead, HTMLAudioElement 프리뷰, SPACE/M/방향키/클릭 seek, 40초 구간(잔여 길이 clamp, 최소 5초), 난이도 선택
- ANALYZING: 실제 파이프라인 단계(DECODING AUDIO → ANALYZING ONSETS → DETECTING BEATS → BUILDING CHART)와 진행률이 연동된 로그/프로그레스 바
- GAME: Canvas 4레인 하이웨이, D/F/J/K, 3-2-1-START count-in, AudioContext.currentTime 단일 시계 기준 노트 이동/판정, PERFECT/GREAT/GOOD/MISS, 콤보/마일스톤/쉐이크, 키 플래시, ESC pause(ctx.suspend로 클럭 동결), R retry, quit, focus loss 자동 pause
- 종료 연출: 마지막 5초 ENDING... 블링크, 마지막 2초 GainNode linearRamp fade-out + 화면 디밍, linger 후 RESULT 전환
- RESULT: 점수(1,000,000 정규화)/S~D 등급/정확도/콤보/판정 내역, NEW BEST 표시, RETRY/SONG SELECT
- 점수 저장: `곡ID|시작ms|난이도` 키별 최고 점수만 유지 (IndexedDB)
- SETTINGS: INPUT/VISUAL OFFSET ±ms, NOTE SPEED 3단계 (localStorage)
- 디자인: 흑백 LCD 컨셉(스캔라인, 고스트잉, pixel border, 명도/패턴/블링크로만 판정 구분), 외부 이미지/폰트 asset 없음 → 오프라인 동작

## 자동 채보 알고리즘 실제 구현

`src/analysis/` + `src/chart/chartgen.ts`:

1. **추출**: `extractMono` — 선택 구간만 stereo→mono 평균 downmix (`analyzer.ts`)
2. **프레임 특징**: `analyzeFrames` (`dsp.ts`) — 1024/512 hop, Hann window, fft.js `realTransform`, 프레임별 positive spectral flux / RMS / 저(≤250Hz)·중(250–2k)·고(2k–8k)Hz 대역 에너지 / spectral centroid. 256프레임마다 `setTimeout(0)` yield로 UI 응답성 유지
3. **Onset 검출**: `detectOnsets` (`onset.ts`) — ±0.5s local window의 mean + 1.5×std adaptive threshold, local maxima peak picking, 90ms 미만 onset은 강한 것만 유지, strength = 0.75×flux exceedance + 0.25×RMS 정규화
4. **Tempo**: `estimateTempo` (`tempo.ts`) — flux envelope autocorrelation (60–200 BPM), 120 BPM 중심 log-gaussian prior로 옥타브 오류 억제, beat phase는 그리드 에너지 최대화 오프셋
5. **채보 생성**: `generateChart` (`chartgen.ts`)
   - onset을 beat의 1/2(HARD 1/4) subdivision 그리드에 subdivision×0.3~0.4 이내면 스냅
   - 난이도별 strength percentile(EASY 55 / NORMAL 35 / HARD 18) + 최소 간격(EASY ≥0.22s / NORMAL ≥0.13s / HARD ≥0.095s, beat 비례 하한 포함) — strength 우선 greedy
   - lane: 저→왼쪽/고→오른쪽 대역 가중 점수 argmax + seeded PRNG 30% 확률 2순위 variation + 동일 레인 3연타/0.18s 미만 연타 금지 + 빠른 구간 한손 몰림 시 반대손 유도
   - chord: strength 상위 8~15% + 최소 간격(NORMAL 2s/HARD 1s) + cross-hand 쌍만, EASY는 chord 없음, 3키 이상 chord 없음
   - onset이 8개 미만인 극단적 무음 곡은 BPM quarter-note 그리드 fallback (랜덤이 아니라 추정 tempo 기반)
   - seed = FNV-1a 해시(곡ID|시작ms|난이도) → mulberry32 → 완전 deterministic

## 사용한 주요 라이브러리와 이유

| 라이브러리 | 이유 |
|---|---|
| `fft.js` | 검증된 경량 FFT. 자체 구현 대비 정확성/성능 우위, 요구사항의 "검증된 작은 라이브러리 우선"에 부합 |
| `idb` | IndexedDB Promise wrapper (~1KB). raw IDB API의 콜백/트랜잭션 보일러플레이트 제거 |
| `vite` / `typescript` / `vitest` | 개발 서버/빌드/타입/테스트 표준 스택 |

React를 쓰지 않은 이유: 60fps Canvas 게임 루프에서 re-render 모델이 오히려 복잡도를 높인다고 판단, 모듈화된 Vanilla TS로 구성 (요구사항에서 허용 명시).

## 테스트/빌드 결과

- `npx tsc --noEmit`: 오류 0
- `npm test` (vitest): **5개 파일 35개 테스트 전부 통과**
  - `judgement.test.ts`: 판정 윈도우 경계값, 점수 정규화(1,000,000/0/80%/50%), 정확도, 등급 경계
  - `segment.test.ts`: 40초 구간, 잔여 길이, 최소 5초 clamp, 단곡/초단곡 edge case
  - `chartgen.test.ts`: deterministic 생성, 정렬/레인 범위, 동시 3노트 금지, 최소 간격, EASY<HARD 밀도, EASY chord 없음, fallback 그리드, seed 차이
  - `analysis.test.ts`: pulse train BPM 추정(120/90), onset peak 검출/병합/무음
  - `pipeline.test.ts`: **합성 128 BPM 40초 트랙(kick+hat)으로 FFT→onset→tempo→chart 전 과정 통합 검증** — 실행 약 0.5초, onset~노트 정렬율 70% 이상 확인
- `npm run build`: 성공 (vite 6, gzip ~14KB JS)
- dev server smoke test: `GET /` 200 + 타이틀 확인, `/src/main.ts` 변환 200 확인

## 현재 남아 있는 한계

- BPM autocorrelation 특성상 half/double time 추정 가능 (prior로 완화했지만 완전하지 않음)
- 분석이 Web Worker가 아닌 메인 스레드 chunked async (40초 ≈ 0.5–1초, 저사양에서 미세한 UI 지연 가능)
- 탭 노트만 지원 (롱노트 없음)
- 캘리브레이션은 수동 ±ms 입력만
- 브라우저 자동 재생 정책상 첫 AudioContext 생성은 사용자 제스처 이후여야 함 (import 클릭 시점에 생성되어 실사용에서는 문제없음)

## 다음 개선 우선순위

1. 분석을 Web Worker로 이동 (Vite `?worker` import)
2. 롱노트(지속 음 에너지 구간 검출) 지원
3. onset 강도 기반 더 정교한 chord 밀도 제어 / 곡 구간별 density 곡선 반영
4. 자동 오프셋 캘리브레이션 모드 (가이드 비트에 맞춰 타격 → 평균 오차 자동 설정)
5. 재생 속도/히트사운드 옵션, 키 커스터마이즈

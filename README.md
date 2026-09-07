# MP3 RHYTHM // LCD-4K

로컬 웹 기반 **4키 리듬게임 프로토타입**. 아무 MP3나 넣으면 원하는 40초 구간을 자동 분석해서 실제 음악의 박자/타격감을 반영한 채보를 자동 생성하고, 바로 플레이할 수 있다. 모든 것은 PC 안에서 로컬로만 동작한다.

## 실행 방법

1. Node.js LTS 설치 (https://nodejs.org/) — 최초 1회만 필요
2. `start.bat` 더블클릭
3. 브라우저가 자동으로 열림 (http://localhost:5173)

- 최초 실행 시 dependency가 자동 설치된다.
- 서버를 끄려면 열린 콘솔 창을 닫는다.
- 개발자 명령: `npm run dev` / `npm run build` / `npm test`

## 조작법

### 곡 추가
- HOME에서 `+ IMPORT MP3` 버튼 또는 MP3 파일을 화면 아무 곳에나 drag & drop
- 여러 곡 등록 가능, 목록에서 클릭하면 선택, `DEL`로 삭제
- 곡/점수는 IndexedDB에 저장되어 재시작 후에도 유지된다

### 구간 선택 (SEGMENT SELECT)
| 입력 | 동작 |
|---|---|
| `SPACE` | 재생 / 일시정지 |
| `M` | 현재 재생 위치를 게임 시작 지점으로 지정 |
| `←` / `→` | 5초 seek |
| waveform 클릭/드래그 | 해당 위치로 seek |
| `START HERE` 버튼 | `M`과 동일 |

- 시작 지점부터 **40초**가 게임 구간 (곡이 짧게 남았으면 남은 길이만 사용, 최소 5초 보장)
- 난이도 EASY / NORMAL / HARD 선택 후 `ANALYZE & PLAY`

### 게임 플레이
| 입력 | 동작 |
|---|---|
| `D` `F` `J` `K` | 4개 레인 노트 타격 |
| `ESC` | 일시정지 / 재개 |
| `R` | 즉시 리트라이 |

- 판정: PERFECT ±45ms / GREAT ±90ms / GOOD ±140ms / MISS
- 최대 점수 1,000,000 정규화, PERFECT=100% GREAT=80% GOOD=50% MISS=0%
- 콤보 50/100/200/300/500에서 마일스톤 연출
- 마지막 5초 `ENDING...` 표시, 마지막 2초 음악 fade-out + 화면 디밍
- 결과 화면에서 점수/등급(S~D)/정확도/콤보/판정 수 확인, 곡+구간+난이도별 최고 점수 저장

### 설정 (HOME > SETTINGS)
- INPUT OFFSET (ms): 입력 판정 보정
- VISUAL OFFSET (ms): 노트 표시 보정
- NOTE SPEED: SLOW / NORMAL / FAST

## 사용 기술

- TypeScript + Vite (모듈화된 Vanilla TS, React 없음)
- Web Audio API: MP3 디코딩, 구간 재생, fade-out, 오디오 클럭 동기화
- Canvas 2D: 게임 플레이/파형 렌더링 (requestAnimationFrame은 시각화 전용)
- fft.js: FFT (검증된 경량 라이브러리)
- idb: IndexedDB wrapper (곡 Blob + 점수 저장)

## 자동 채보 알고리즘 개요

1. `decodeAudioData`로 MP3 디코딩 → 선택 구간만 mono downmix
2. 1024 frame / 512 hop + Hann window + FFT
3. positive spectral flux + RMS envelope 계산
4. local mean + 1.5×std adaptive threshold로 onset peak picking (90ms 미만 병합)
5. onset envelope autocorrelation으로 BPM 추정 (120 BPM 중심 prior로 옥타브 오류 억제) + beat phase 추정
6. onset을 가까운 1/8(HARD는 1/16) 그리드에 자연스럽게 스냅
7. 난이도별 strength percentile + 최소 간격으로 density 조절
8. 저/중/고주파 에너지 비율로 lane 기본 후보 결정 + deterministic variation + 연타/한손 몰림 방지 규칙
9. 매우 강한 accent에만 cross-hand 2키 chord (3~4키 chord 미사용)
10. 곡+시작점+난이도 해시를 seed로 사용 → 동일 조건이면 항상 동일 채보

## 로컬 저장 방식

- IndexedDB `rhythm-mp3-db`
  - `songs`: 곡 메타 + MP3 Blob (새로고침/재시작 후에도 라이브러리 유지)
  - `scores`: `곡ID|시작ms|난이도` 키별 최고 점수
- localStorage: 입력/시각 오프셋, 노트 속도 설정

## 알려진 제한사항

- BPM 추정은 autocorrelation 기반이라 half/double time으로 잡힐 수 있다 (prior로 완화).
- 오디오 분석은 Web Worker가 아닌 메인 스레드의 chunked async로 수행 (40초 기준 보통 1초 미만이지만 저사양에서는 잠시 UI가 느려질 수 있음).
- 롱노트/슬라이드 노트는 없고 탭 노트만 지원.
- 판정 오프셋 자동 캘리브레이션 마법은 없고 수동 ±ms 설정만 제공.
- MP3 외 포맷은 브라우저 `decodeAudioData`가 지원하면 동작하지만 MP3만 검증했다.

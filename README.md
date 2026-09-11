# MP3 RHYTHM // LCD-4K

브라우저 기반 **4키 리듬게임 프로토타입**. 아무 MP3나 넣으면 원하는 40초 구간을 자동 분석해서 실제 음악의 박자/타격감을 반영한 채보를 자동 생성하고, 미리 확인한 뒤 바로 플레이할 수 있다. MP3와 채보는 서버로 업로드하지 않고 현재 브라우저의 IndexedDB에 저장된다.

## 가장 간단한 실행: Vercel

이 저장소는 Vercel에 그대로 연결해서 정적 Vite 앱으로 배포할 수 있다.

- Framework Preset: `Vite`
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`
- `vercel.json`이 포함되어 있어 일반적으로 별도 설정이 필요 없다.

배포된 주소에서 MP3를 한 번 추가하면 해당 MP3 Blob, 생성된 채보 분석 결과/variant, 최고 점수가 **그 브라우저 안에 저장**된다. 이후 같은 주소를 같은 브라우저로 다시 열면 곡 목록이 남아 있고, 이미 분석한 동일 구간/난이도는 DSP를 다시 돌리지 않고 저장된 채보를 바로 불러온다.

> 브라우저 저장소이므로 다른 기기/다른 브라우저와 자동 동기화되지는 않는다. 사이트 데이터 삭제, 시크릿 모드 종료 등으로 로컬 라이브러리가 사라질 수 있다. 앱은 MP3를 Vercel 서버로 업로드하지 않는다.

## 로컬 실행

Vercel을 쓰지 않을 때만 필요하다.

1. Node.js LTS 설치 — 최초 1회만 필요
2. `start.bat` 더블클릭
3. 브라우저가 자동으로 열림 (`http://localhost:5173`)

- 최초 실행 시 dependency가 자동 설치된다.
- 서버를 끄려면 열린 콘솔 창을 닫는다.
- 개발자 명령: `npm run dev` / `npm run build` / `npm test`

## 조작법

### 곡 추가
- HOME에서 `+ IMPORT MP3` 버튼 또는 MP3 파일을 화면 아무 곳에나 drag & drop
- 여러 곡 등록 가능, 목록에서 클릭하면 선택, `DEL`로 삭제
- 곡/점수/채보 캐시는 IndexedDB에 저장되어 재방문 후에도 유지된다
- HOME의 `LOCAL LIBRARY` 줄에서 현재 브라우저 저장소 사용량과 persistent storage 허용 여부를 볼 수 있다
- 브라우저가 지원하면 import 시 persistent storage를 요청해 자동 eviction 가능성을 줄인다

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
- 이미 같은 곡/시작점/길이/난이도를 분석한 적이 있으면 `LOADED SAVED ANALYSIS - DSP SKIPPED`로 재분석을 건너뛴다

### 채보 미리보기
분석이 끝나면 바로 게임을 시작하지 않고 생성된 채보를 작은 타임라인으로 확인할 수 있다.

- `PLAY CHART`: 현재 채보로 게임 시작
- `REGENERATE`: DSP 분석을 다시 하지 않고 같은 분석 결과에서 다른 패턴의 채보 생성
- 최대 8개 variant를 IndexedDB에 캐시해서 브라우저 재시작 후에도 재사용
- NOTES / 평균 NPS / 추정 BPM / BEAT CONF / VAR 표시
- BPM 신뢰도가 낮으면 beat grid snap을 자동으로 약하게 적용

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
- AUTO CALIBRATE: 120 BPM 클릭을 듣고 SPACE를 8회 맞춰 누르면 median timing error를 계산해 INPUT OFFSET 추천값을 자동 적용

## 사용 기술

- TypeScript + Vite (모듈화된 Vanilla TS, React 없음)
- Vercel: 정적 프런트엔드 배포
- Web Audio API: MP3 디코딩, 구간 재생, fade-out, 오디오 클럭 동기화, 캘리브레이션 클릭
- Canvas 2D: 게임 플레이/파형/채보 미리보기 렌더링
- fft.js: FFT
- idb: IndexedDB wrapper
- Vitest + GitHub Actions: 테스트 및 production build 검증

## 자동 채보 알고리즘 개요

1. `decodeAudioData`로 MP3 디코딩 → 선택 구간 stereo→mono downmix
2. 1024 frame / 512 hop + Hann window + FFT
3. positive spectral flux에 저/중/고역 에너지 상승과 RMS 상승을 섞은 multi-band novelty envelope 생성
4. local adaptive threshold로 onset peak picking (90ms 미만 병합)
5. normalized autocorrelation + harmonic support로 BPM 추정, beat phase와 confidence 계산
6. confidence가 높을 때만 onset을 가까운 1/8(HARD 1/16) grid에 적극적으로 snap
7. 난이도별 목표 NPS를 기준으로 2초 구간마다 note budget을 배분해 조용한 부분과 강한 부분의 밀도를 다르게 생성
8. 레인은 단순 저음→왼쪽/고음→오른쪽 매핑보다 stair/alternation/zigzag/anchor 계열의 짧은 패턴을 우선하고 timbre는 보조 힌트로 사용
9. 강한 accent에만 cross-hand 2키 chord 사용 (3~4키 chord 없음)
10. 곡+시작점+난이도+variant 해시 seed → 같은 variant는 항상 같은 채보, REGENERATE는 다른 deterministic variant 생성

## 브라우저 저장 방식

- IndexedDB `rhythm-mp3-db`
  - `songs`: 곡 메타 + MP3 Blob
  - `scores`: `곡ID|시작ms|난이도` 키별 최고 점수
  - `charts`: 곡+구간+난이도별 DSP 분석 결과 + 최대 8개 생성 채보 variant
- localStorage
  - 입력/시각 오프셋
  - 노트 속도 설정

MP3는 `localStorage`에 넣지 않는다. 일반적으로 localStorage는 용량이 작기 때문에 오디오 Blob 저장에는 부적합하고, IndexedDB가 적합하다.

## 알려진 제한사항

- 실제 악곡은 tempo change, swing, rubato 등이 있어 단일 BPM 추정만으로 완벽한 beat tracking은 불가능하다. confidence가 낮을 때 snap을 줄여 오판의 영향을 완화한다.
- 오디오 분석은 Web Worker가 아닌 메인 스레드의 chunked async로 수행한다.
- 롱노트/슬라이드 노트는 없고 탭 노트만 지원한다.
- AUTO CALIBRATE는 사용자의 입력 지연을 추정하며 장치의 모든 audio output latency를 완벽히 분리 측정하는 기능은 아니다.
- 브라우저 저장 용량과 eviction 정책은 브라우저/기기별로 다르므로 대규모 음악 라이브러리보다는 몇 곡을 넣어 반복 플레이하는 용도에 적합하다.

## CI

Pull Request와 main push에서 다음을 자동 실행한다.

```bash
npm ci
npm test
npm run build
```

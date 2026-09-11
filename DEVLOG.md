# DEVLOG

## v0.2 — chart feel / calibration pass

이번 변경의 목표는 기능 수를 늘리는 것보다 **아무 MP3를 넣었을 때 자동 채보가 더 음악적이고 플레이 가능한 느낌이 나도록 만드는 것**이다.

### 분석 개선

- BPM 추정: raw autocorrelation → normalized autocorrelation + half/double harmonic support
- 120 BPM prior는 강제 보정이 아니라 tie-break 수준의 완만한 prior로 축소
- beat phase와 함께 `tempoConfidence`를 계산
- confidence가 낮으면 chart generator의 beat-grid snap을 자동으로 약화
- onset detector는 spectral flux 단독 peak 검출에서 벗어나 저/중/고역 positive energy rise + RMS rise를 섞은 novelty envelope 사용

### 채보 생성 개선

- 전역 strength percentile만으로 난이도를 결정하던 방식을 제거
- 2초 local window마다 난이도별 목표 NPS를 기준으로 note budget 배분
  - EASY 약 1.7 target NPS
  - NORMAL 약 2.8 target NPS
  - HARD 약 4.2 target NPS
- local activity에 따라 각 window budget을 0.6~1.35배 범위에서 조절
- lane은 저음→왼쪽 / 고음→오른쪽 매핑을 주 규칙으로 사용하지 않음
- 4-note phrase 단위 stair / reverse stair / alternation / zigzag / anchor 패턴을 우선
- timbre 정보는 패턴을 깨지 않는 범위의 보조 점수로 사용
- 빠른 구간 반대손 유도, 동일 레인 과도한 연타 억제 유지
- 강한 accent의 cross-hand 2-key chord만 허용

### 채보 preview / regenerate

분석 완료 후 즉시 게임으로 넘어가지 않고 다음 정보를 표시한다.

- lane timeline preview
- note count
- 평균 NPS
- 추정 BPM
- beat confidence
- chart variant 번호

`REGENERATE`는 FFT/onset/BPM 분석을 다시 수행하지 않는다. 세션에 `ChartSource`를 캐시한 뒤 seed의 variant만 바꾸어 lane/pattern chart를 즉시 다시 만든다.

### 자동 INPUT OFFSET calibration

SETTINGS에 `AUTO CALIBRATE [SPACE]` 추가.

1. 120 BPM click 2회 count-in
2. 이후 click에 맞춰 SPACE 8회 입력
3. 각 타격의 nearest-click timing error 수집
4. median error를 5ms 단위로 반올림
5. 판정 방향에 맞게 부호를 반전하여 INPUT OFFSET 추천값 적용

평균 대신 median을 사용하여 한두 번의 큰 실수를 calibration 값에서 덜 민감하게 처리한다.

### CI

`.github/workflows/ci.yml` 추가.

Pull Request / main push 시:

```bash
npm ci
npm test
npm run build
```

## 현재 핵심 구조

- `src/analysis/dsp.ts`: FFT / spectral features
- `src/analysis/onset.ts`: multi-band onset novelty + adaptive peak picking
- `src/analysis/tempo.ts`: normalized autocorrelation tempo / phase / confidence
- `src/analysis/analyzer.ts`: 전체 분석 pipeline + reusable `ChartSource`
- `src/chart/chartgen.ts`: local NPS density + pattern grammar chart generation
- `src/ui/analyzing.ts`: chart preview / regenerate
- `src/ui/game.ts`: Canvas 4-key gameplay / AudioContext clock judgement
- `src/ui/settings.ts`: manual offsets / note speed / automatic input calibration
- `src/storage/db.ts`: IndexedDB song + best-score persistence

## 현재 남아 있는 한계

1. 곡 전체가 하나의 BPM이라는 가정은 유지된다. tempo change / swing / rubato에 대한 downbeat tracker는 아직 없다.
2. 분석은 Web Worker가 아닌 chunked main-thread async다.
3. 롱노트/슬라이드 노트는 없다.
4. 자동 calibration은 실제 사용자의 end-to-end 타격 오차를 보정하는 방식이며 OS/audio-device latency를 별도 계측하지는 않는다.
5. 실제 음악 fixture 기반의 정량 chart-quality regression suite는 아직 없다. 현재 테스트는 알고리즘 안정성과 합성 트랙 pipeline 검증 중심이다.

## 다음 후보

1. 실제 음악 fixture + expected BPM/onset/NPS regression dataset
2. downbeat / local tempo tracking
3. Web Worker 분석
4. hold-note detector
5. 키 커스터마이즈 / hit sound 옵션

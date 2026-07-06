---
name: seoul-subway-arrival
version: "1.0.0"
description: 서울 지하철 실시간 도착 정보. 역 이름으로 검색하면 호선별·방향별 도착 예정 열차와 남은 시간을 표시한다. k-skill-proxy 경유로 API 키 없이 사용 가능.\n\nSeoul real-time subway arrival info. Search by station name to see upcoming trains by line and direction, with countdown times. No API key needed — routed through k-skill-proxy.
activation:
  keywords:
    - "지하철"
    - "도착"
    - "열차"
    - "호선"
    - "몇분"
    - "강남역"
    - "서울역"
    - "잠실역"
    - "홍대입구"
    - "사당역"
    - "신도림"
    - "왕십리"
    - "도착정보"
    - "막차"
    - "첫차"
    - "subway"
    - "arriving"
    - "metro"
    - "arrival"
    - "platform"
  patterns:
    - "(?i)(subway|metro|train).*(arriving|arrival|coming|next|when)"
    - "(?i)(last|first|next) train"
  tags:
    - "transit"
    - "subway"
    - "seoul"
    - "korean"
    - "realtime"
  max_context_tokens: 2000
---

# 서울 지하철 실시간 도착 정보

서울 열린데이터 광장의 실시간 지하철 도착정보 Open API를 k-skill-proxy 경유로 조회한다.
사용자는 별도 API 키 없이 프록시 서버를 통해 모든 요청을 처리한다.

## 프록시 기본 URL

`KSKILL_PROXY_BASE_URL` 환경변수가 있으면 그 값을 사용하고, 없으면 기본 hosted proxy `https://k-skill-proxy.nomadamas.org` 를 사용한다.

```bash
BASE="${KSKILL_PROXY_BASE_URL:-https://k-skill-proxy.nomadamas.org}"
```

## 언제 사용하는가

- "강남역 지금 몇 분 뒤 도착해?"
- "서울역 1호선 도착 정보"
- "잠실역 곧 들어오는 열차 정리해줘"
- "홍대입구역 막차 언제야?"
- "사당역 4호선 상행 열차"

## Workflow

### 1. 역 이름으로 도착 정보 조회

```bash
curl -fsS --get "${BASE}/v1/seoul-subway/arrival" \
  --data-urlencode 'stationName=강남'
```

`startIndex` 와 `endIndex` 로 응답 범위를 조절할 수 있다.

### 2. 응답 요약

각 도착 열차에 대해 아래 항목을 요약한다:

- 호선 (line)
- 상행/하행 또는 외선/내선 방향
- 첫 번째 도착 메시지 + 남은 시간
- 두 번째 도착 메시지 + 남은 시간 (있으면)

## 응답 요약 포맷

```
🚇 강남역 실시간 도착 정보 (2026-04-05 14:30 기준)
2호선 내선 (순환) | 잠실방면 — 3분 후 도착 (강남)
                   다음 열차 — 8분 후 (교대)
2호선 외선 (순환) | 신도림방면 — 5분 후 도착 (역삼)
                   다음 열차 — 12분 후
신분당선 하행 | 정자방면 — 2분 후 도착
             다음 열차 — 10분 후
```

## Workflow 규칙

1. 역 이름만 있으면 바로 조회한다. 추가 좌표·지역명 불필요.
2. "강남" → "강남역" 으로 자동 보정한다. 사용자가 "역"을 빼먹어도 붙여서 검색.
3. 여러 호선이 지나는 역은 모든 호선 결과를 표시한다.
4. 조회 시점을 반드시 응답에 포함한다. 실시간 데이터이므로 시점 표시가 중요.
5. "몇 시 막차" 같이 특정 시간대를 묻지 않는 한, 전체 실시간 도착 정보를 보여준다.

## 주의사항

- 실시간 데이터는 몇 초 단위로 바뀔 수 있다. 답변에 반드시 조회 시점을 포함할 것.
- 역명 표기가 불일치하면 ("서울대입구" vs "관악구청" 등) 정확한 역명으로 재시도.
- 서울 지하철만 지원한다. 다른 지역 지하철은 제공되지 않음.
- 프록시 upstream key 미설정 시 503 응답이 올 수 있다.
- API 키나 시크릿은 절대 응답에 포함하지 않는다.

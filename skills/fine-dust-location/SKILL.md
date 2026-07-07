---
name: fine-dust-location
version: "1.0.0"
description: 에어코리아 기반 미세먼지(PM10) 및 초미세먼지(PM2.5) 조회. 지역명·행정구역으로 검색하고, 측정소명·수치·등급·통합대기등급을 요약한다. k-skill-proxy 경유로 API 키 불필요.\n\nAirKorea-based fine dust (PM10) and ultra-fine dust (PM2.5) lookup. Search by region/district name; returns station name, numeric values, grade, and unified air quality index. No token needed — routed through k-skill-proxy.
activation:
  keywords:
    - "미세먼지"
    - "초미세먼지"
    - "공기질"
    - "먼지"
    - "대기"
    - "오염"
    - "황사"
    - "마스크"
    - "공기"
    - "dust"
    - "pollution"
    - "air"
    - "mask"
    - "pm10"
    - "pm25"
    - "air-quality"
    - "finedust"
    - "aqi"
    - "breathe"
    - "haze"
  patterns:
    - "(?i)(dust|air.quality|pollution|fine.dust|micro.dust|pm10|pm2.5|pm25).*(seoul|korea|today|level|status|check)"
    - "(?i)(should|do).*(wear|need).*(mask|dust)"
  tags:
    - "weather"
    - "health"
    - "korean"
    - "utility"
    - "environment"
  max_context_tokens: 2000
---

# 미세먼지 조회

에어코리아(AirKorea) 공공 API를 k-skill-proxy 경유로 호출한다.
사용자는 개인 API 키 없이 프록시 서버를 통해 조회한다.

## 프록시 기본 URL

`KSKILL_PROXY_BASE_URL` 환경변수가 있으면 그 값을 사용하고, 없으면 기본 hosted proxy `https://k-skill-proxy.nomadamas.org` 를 사용한다.

```bash
BASE="${KSKILL_PROXY_BASE_URL:-https://k-skill-proxy.nomadamas.org}"
```

## 언제 사용하는가

- "지금 미세먼지 어때?"
- "강남구 초미세먼지 수치 알려줘"
- "오늘 공기질 괜찮아?"
- "서울 종로구 미세먼지"
- "마스크 써야 돼?"
- "황사 있어?"

## 등급 기준

미세먼지(PM10):

| 등급 | PM10 (㎍/㎥) | 설명 |
|------|-------------|------|
| 좋음 | 0~30 | 매우 깨끗함 |
| 보통 | 31~80 | 일상생활 가능 |
| 나쁨 | 81~150 | 마스크 권장 |
| 매우나쁨 | 151~ | 실외 활동 자제 |

초미세먼지(PM2.5):

| 등급 | PM2.5 (㎍/㎥) | 설명 |
|------|--------------|------|
| 좋음 | 0~15 | 매우 깨끗함 |
| 보통 | 16~35 | 일상생활 가능 |
| 나쁨 | 36~75 | 마스크 권장 |
| 매우나쁨 | 76~ | 실외 활동 자제 |

## Workflow

### 1. 지역명으로 조회

```bash
curl -fsS --get "${BASE}/v1/fine-dust/report" \
  --data-urlencode 'regionHint=서울 강남구'
```

지역명은 행정구역명에 가깝게 입력한다:
- 좋음: `강남구`, `서울 강남구`, `종로구`, `수원시`
- 애매함: `강남`, `서울 남쪽` (단일 측정소로 확정되지 않을 수 있음)

### 2. 모호한 지역 처리

입력한 지역명이 단일 측정소로 확정되지 않으면 프록시는 `ambiguous_location` 과 함께 후보 측정소 목록을 반환한다.

후보 중 하나를 골라 정확한 측정소명으로 재조회:

```bash
curl -fsS --get "${BASE}/v1/fine-dust/report" \
  --data-urlencode 'stationName=우산동(광주)'
```

### 3. 응답 요약

응답에서 아래 항목을 우선 요약한다:
- 측정소명 (`stationName`)
- 조회 시각
- PM10 수치와 등급
- PM2.5 수치와 등급
- 통합대기등급

## 응답 요약 포맷

```
😷 강남구 미세먼지 (2026-04-05 14:00 기준 / 측정소: 강남구)
PM10: 45㎍/㎥ (보통)
PM2.5: 22㎍/㎥ (보통)
통합대기등급: 보통
```

## Workflow 규칙

1. 지역명은 최대한 구체적으로 입력한다. "강남" 보다는 "강남구" 또는 "서울 강남구"가 좋다.
2. 모호한 지역이면 후보를 먼저 보여주고 사용자에게 확인한 뒤 재조회한다.
3. "나쁨" 이상이면 마스크 착용을 권장한다.
4. "매우나쁨"이면 실외 활동 자제를 권장한다.
5. 수치뿐 아니라 등급(좋음~매우나쁨)도 반드시 표시한다. 수치만으로는 체감이 어렵기 때문.

## 주의사항

- 전국 측정소를 지원하지만 지역명이 너무 넓으면 모호할 수 있다.
- 프록시 서버가 다운되거나 upstream key가 비어 있으면 조회 불가.
- 측정소마다 갱신 주기가 다를 수 있다.
- API 키나 시크릿은 절대 응답에 포함하지 않는다.

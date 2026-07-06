---
name: korea-weather
version: "1.0.0"
description: 기상청 단기예보 기반 한국 날씨 조회. 위도/경도 또는 격자 좌표(nx/ny)로 기온, 하늘상태, 강수확률, 강수량, 습도, 풍속을 요약한다. k-skill-proxy 경유로 API 키 불필요.\n\nKorea weather via KMA short-term forecast. Temperature, sky condition, precipitation probability/amount, humidity, and wind speed by lat/lon or grid coordinates. No API key needed — routed through k-skill-proxy.
activation:
  keywords:
    - "날씨"
    - "기온"
    - "비"
    - "눈"
    - "습도"
    - "강수"
    - "예보"
    - "바람"
    - "날씨예보"
    - "오늘날씨"
    - "내일날씨"
    - "주말날씨"
    - "weather"
    - "temperature"
    - "rain"
    - "forecast"
    - "humidity"
    - "wind"
    - "sunny"
    - "storm"
  patterns:
    - "(?i)(weather|rain|sunny|temperature|forecast|hot|cold).*(seoul|korea|today|tomorrow|weekend|jeju|busan)"
    - "(?i)(what|how|will).*(weather|rain|sunny|hot|cold)"
  tags:
    - "weather"
    - "korean"
    - "utility"
  max_context_tokens: 2000
---

# 한국 날씨 조회

기상청 단기예보 조회서비스를 k-skill-proxy 경유로 호출한다.
사용자는 개인 OpenAPI 키를 발급할 필요 없이 프록시 서버를 통해 조회한다.

## 프록시 기본 URL

`KSKILL_PROXY_BASE_URL` 환경변수가 있으면 그 값을 사용하고, 없으면 기본 hosted proxy `https://k-skill-proxy.nomadamas.org` 를 사용한다.

```bash
BASE="${KSKILL_PROXY_BASE_URL:-https://k-skill-proxy.nomadamas.org}"
```

## 언제 사용하는가

- "서울 오늘 날씨 어때?"
- "부산 날씨 알려줘"
- "내일 비 와?"
- "강남구 지금 기온 몇 도야?"
- "주말에 날씨 좋아?"

## Workflow

### 1. 위도/경도로 조회

위도·경도가 있으면 그대로 proxy에 전달한다. proxy가 내부에서 격자 좌표로 변환한다.

```bash
curl -fsS --get "${BASE}/v1/korea-weather/forecast" \
  --data-urlencode 'lat=37.5665' \
  --data-urlencode 'lon=126.9780'
```

### 2. 격자 좌표(nx/ny)로 조회

기상청 격자 좌표를 이미 알고 있으면 직접 전달한다.

```bash
curl -fsS --get "${BASE}/v1/korea-weather/forecast" \
  --data-urlencode 'nx=60' \
  --data-urlencode 'ny=127' \
  --data-urlencode 'baseDate=20260405' \
  --data-urlencode 'baseTime=0500'
```

### 3. baseDate / baseTime 생략

`baseDate` 와 `baseTime` 을 생략하면 proxy가 KST 기준 최신 단기예보 발표 시각을 자동으로 선택한다.

### 4. 응답 요약

응답에서 아래 항목을 우선 요약한다:

| 코드 | 의미 | 설명 |
|------|------|------|
| TMP | 기온 | 현재 기온 (°C) |
| SKY | 하늘상태 | 맑음(1), 구름많음(3), 흐림(4) |
| PTY | 강수형태 | 없음(0), 비(1), 비/눈(2), 눈(3), 소나기(4) |
| POP | 강수확률 | % |
| PCP | 강수량 | mm 또는 "강수없음" |
| SNO | 적설 | cm 또는 "적설없음" |
| REH | 습도 | % |
| WSD | 풍속 | m/s |

### 5. 주요 도시 기본 좌표 참고

| 도시 | 위도(lat) | 경도(lon) | nx | ny |
|------|----------|----------|-----|-----|
| 서울 | 37.5665 | 126.9780 | 60 | 127 |
| 부산 | 35.1796 | 129.0756 | 98 | 76 |
| 인천 | 37.4563 | 126.7052 | 55 | 124 |
| 대구 | 35.8714 | 128.6014 | 89 | 90 |
| 대전 | 36.3504 | 127.3845 | 67 | 100 |
| 광주 | 35.1595 | 126.8526 | 58 | 74 |
| 수원 | 37.2636 | 127.0286 | 60 | 121 |
| 제주 | 33.4996 | 126.5312 | 52 | 38 |

## 응답 요약 포맷

```
🌤️ 서울 날씨 (2026-04-05 14:00 예보 기준)
기온: 18°C
하늘: 구름많음
강수확률: 30%
습도: 55%
풍속: 3.2m/s
```

## Workflow 규칙

1. 사용자가 도시명을 말하면 위 표의 기본 좌표를 사용한다.
2. "내일", "주말" 같은 상대 날짜는 예보 가능 범위 내에서 조회한다.
3. baseDate·baseTime 생략을 기본으로 하고, 특정 시점을 원하면 명시한다.
4. TMP, SKY, PTY, POP 위주로 간결하게 요약한다.
5. 조회 시점과 예보 발표 시각을 응답에 포함한다.

## 주의사항

- 단기예보는 약 3일 이내 예보만 제공한다. 그 이상은 신뢰도가 낮다.
- 프록시 upstream key 미설정 시 503 응답.
- nx·ny 는 기상청 격자 체계로, 일반 위경도와 다르다. lat·lon 사용이 더 간편하다.
- API 키나 시크릿은 절대 응답에 포함하지 않는다.

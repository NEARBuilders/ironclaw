---
name: seoul-density
version: "1.0.0"
description: 서울 주요 121개 핫스팟의 실시간 혼잡도(여유/보통/약간 붐빔/붐빔)와 추정 인구 범위를 조회한다. KT·SKT 통신 신호 기반으로 5분 주기 갱신. k-skill-proxy 경유로 API 키 불필요.\n\nLive crowd density for 121 Seoul hotspots (calm/moderate/busy/very busy) with estimated population range. Based on KT/SKT mobile signal data, refreshed every 5 minutes. No API key needed — routed through k-skill-proxy.
activation:
  keywords:
    - "혼잡"
    - "붐벼"
    - "인파"
    - "복잡"
    - "여유"
    - "사람많아"
    - "강남역"
    - "홍대"
    - "명동"
    - "여의도"
    - "혼잡도"
    - "사람얼마나"
    - "crowded"
    - "crowd"
    - "busy"
    - "density"
    - "congestion"
    - "packed"
    - "people"
    - "nightlife"
  patterns:
    - "(?i)(how|crowded|busy|packed|density).*(people|crowd|area|seoul|hongdae|gangnam|myeongdong)"
    - "(?i)is (hongdae|gangnam|myeongdong|itaewon|yeouido).*(crowded|busy|packed|calm)"
  tags:
    - "utility"
    - "seoul"
    - "korean"
    - "realtime"
  max_context_tokens: 2000
---

# 서울 실시간 혼잡도 조회

서울 열린데이터 광장의 실시간 도시데이터 API를 k-skill-proxy 경유로 호출한다.
KT·SKT 통신 신호 기반 추계 데이터를 5분 주기로 갱신하며, 호출 시점 기준 약 15분 전 데이터다.

사용자는 별도 API 키 없이 프록시 서버를 통해 모든 요청을 처리한다.

## 프록시 기본 URL

`KSKILL_PROXY_BASE_URL` 환경변수가 있으면 그 값을 사용하고, 없으면 기본 hosted proxy `https://k-skill-proxy.nomadamas.org` 를 사용한다.

```bash
BASE="${KSKILL_PROXY_BASE_URL:-https://k-skill-proxy.nomadamas.org}"
```

## 언제 사용하는가

- "강남역 지금 붐벼?"
- "홍대 사람 많아?"
- "명동 지금 가도 괜찮아?"
- "여의도한강공원 여유로워?"
- "주말에 강남 사람 얼마나 돼?"

## Workflow

### 1. 조회

장소명으로 혼잡도를 조회한다.

```bash
curl -fsS --get "${BASE}/v1/seoul-density/citydata" \
  --data-urlencode 'area=강남역'
```

### 2. 응답 해석

응답 JSON에서 아래 필드를 추출한다:

- `SeoulRtd.citydata_ppltn[0].AREA_NM`: 장소명
- `SeoulRtd.citydata_ppltn[0].AREA_CONGEST_LVL`: 혼잡도 단계
  - `여유` — 한산함
  - `보통` — 적당함
  - `약간 붐빔` — 사람이 몰려있을 수 있음
  - `붐빔` — 매우 혼잡
- `SeoulRtd.citydata_ppltn[0].AREA_PPLTN_MIN`: 추정 최소 인구
- `SeoulRtd.citydata_ppltn[0].AREA_PPLTN_MAX`: 추정 최대 인구
- `SeoulRtd.citydata_ppltn[0].PPLTN_TIME`: 기준 시각
- `SeoulRtd.citydata_ppltn[0].AREA_CONGEST_MSG`: 혼잡도 상황 메시지

### 3. 모호한 장소명 처리

장소명이 애매한 경우, 프록시가 후보 목록과 함께 `ambiguous_location`을 반환한다.
사용자에게 후보 중 어느 곳인지 확인한 뒤 재조회한다.

### 4. 지원 장소

서울 121개 주요 핫스팟을 지원한다. 주요 장소 예시:

| 카테고리 | 장소 예시 |
|---------|---------|
| 강남권 | 강남역, 강남 MICE 관광특구 |
| 홍대권 | 홍대 관광특구, 홍대입구역(2호선) |
| 도심권 | 명동 관광특구, 종로·청계 관광특구, 서울역 |
| 공원 | 여의도한강공원, 반포한강공원, 뚝섬한강공원 |
| 쇼핑몰 | 타임스퀘어, 코엑스몰, 이마트(주요지점) |
| 대학가 | 신촌·이대역, 건대입구역 |
| 교통 | 고속터미널역, 용산역, 김포공항 |

전체 목록은 프록시의 `/v1/seoul-density/citydata` 문서를 참고한다.

## 응답 요약 포맷

```
🏙️ 강남역 혼잡도 (2026-04-05 15:30 기준)
혼잡도: 약간 붐빔
인구 추정: 24,000~26,000명
상황: 사람이 몰려있을 수 있어요
```

## Workflow 규칙

1. 사용자의 장소 표현을 최대한 정확한 장소명으로 변환한다. "강남" → "강남역", "홍대" → "홍대 관광특구" 등.
2. 모호하면 후보를 먼저 보여주고 사용자에게 확인.
3. 새벽 01~05시에는 실시간 데이터가 제공되지 않을 수 있다. 이 시간대임을 알린다.
4. 인구는 추계치임을 인지하고 표현한다 ("약 OOO명").
5. 기준 시각을 반드시 포함한다. 데이터는 호출 시점보다 15분 정도 과거다.

## 주의사항

- 인구 수치는 실제값이 아닌 통신 신호 기반 추계치다.
- 데이터는 호출 시점 기준 약 15분 전 값이다.
- 새벽 01~05시는 실시간 데이터가 제공되지 않을 수 있다.
- 일일 호출 할당량 초과 시 다음 날 재시도해야 한다.
- 지원하지 않는 장소명은 빈 응답이 반환된다.
- API 키나 시크릿은 절대 응답에 포함하지 않는다.

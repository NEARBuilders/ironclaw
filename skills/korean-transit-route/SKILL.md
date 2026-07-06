---
name: korean-transit-route
version: "1.0.0"
description: ODsay LIVE API와 Kakao geocoding을 이용한 한국 대중교통(지하철+버스+도보) 도어투도어 길찾기. 출발지↔도착지 경로, 소요시간, 요금, 환승 횟수, 총 도보 거리를 조회한다.\n\nKorean door-to-door transit routing (subway+bus+walking) via ODsay LIVE API + Kakao geocoding. Route time, fare, transfers, and total walking distance between any two points in Korea.
activation:
  keywords:
    - "대중교통"
    - "지하철"
    - "버스"
    - "환승"
    - "길찾기"
    - "도보"
    - "경로"
    - "가는법"
    - "출발"
    - "도착"
    - "교통"
    - "버스정류장"
    - "가는길"
    - "어떻게가"
    - "transit"
    - "subway"
    - "bus"
    - "route"
    - "navigation"
    - "commute"
  patterns:
    - "(?i)(how|way|route|commute).*(subway|bus|transit|get to|go to)"
    - "(?i)from.*to.*(seoul|korea|station|airport)"
  tags:
    - "transit"
    - "navigation"
    - "seoul"
    - "korean"
  max_context_tokens: 2500
requires:
  env:
    - "ODSAY_API_KEY"
---

# 한국 대중교통 길찾기

ODsay LIVE API와 Kakao Local geocoding을 이용해 한국 대중교통(지하철+버스+도보) 도어투도어 경로를 조회한다.

## 선행 조건

ODsay Server API 키가 필요하다. 발급: `https://lab.odsay.com`
API 키는 환경변수 `ODSAY_API_KEY` 로 설정한다.

발급 후 IP 화이트리스트 등록이 필요할 수 있다. ODsay 콘솔에서 등록할 것.

## 프록시 기본 URL

Kakao geocoding은 k-skill-proxy 경유로 호출한다.

```bash
BASE="${KSKILL_PROXY_BASE_URL:-https://k-skill-proxy.nomadamas.org}"
```

## 언제 사용하는가

- "강남에서 잠실 지하철로 어떻게 가?"
- "서울역에서 인천공항까지 대중교통"
- "환승 가장 적은 경로 알려줘"
- "최소 시간으로 가는 버스+지하철"
- "부산역에서 해운대까지 가는법"

## 사용하지 말아야 할 때

- 자동차 경로 → `kakao-map` 사용
- 도보·자전거 전용 경로
- 해외 좌표·주소
- KTX/SRT 기차 예매 (길찾기만 가능)

## Workflow

### 1. 출발지·도착지 좌표 확보

좌표가 없으면 반드시 geocoding을 먼저 수행한다.
기본 hosted proxy의 Kakao Local geocode를 사용한다.

```bash
# 주소/장소명 → 좌표
curl -fsS --get "${BASE}/v1/kakao-local/geocode" \
  --data-urlencode 'q=강남역'
```

응답의 `documents[0].x`(경도), `documents[0].y`(위도) 를 사용한다.

지하철역명만 정확히 알면 ODsay `searchStation` 으로도 좌표를 얻을 수 있지만,
도어투도어 결과를 위해서는 실제 출발지·도착지 좌표를 사용해야 첫/끝 도보 구간이 계산된다.

### 2. ODsay 대중교통 경로 조회

ODsay API 키를 URL 인코딩하여 요청한다.

```bash
ODSAY_KEY=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['ODSAY_API_KEY'],safe=''))")
curl -s "https://api.odsay.com/v1/api/searchPubTransPathT?apiKey=${ODSAY_KEY}&SX=${SX}&SY=${SY}&EX=${EX}&EY=${EY}&OPT=0&SearchPathType=0"
```

파라미터:
- `SX`, `SY`: 출발지 경도, 위도 (WGS84)
- `EX`, `EY`: 도착지 경도, 위도 (WGS84)
- `OPT`: `0` 추천순(기본), `4` 최소시간, `5` 최소환승
- `SearchPathType`: `0` 지하철+버스, `1` 지하철만, `2` 버스만

### 3. 응답 해석

`result.path[]` 배열에서 각 경로:
- `pathType`: `1` 지하철, `2` 버스, `3` 지하철+버스
- `info.totalTime`: 총 소요시간 (분)
- `info.payment`: 총 요금 (원)
- `info.subwayTransitCount`: 지하철 환승 횟수
- `info.busTransitCount`: 버스 환승 횟수
- `info.totalWalk`: 총 도보 거리 (미터)
- `info.firstStartStation`: 최초 탑승역
- `info.lastEndStation`: 최종 하차역
- `subPath[]`: 구간별 상세
  - `trafficType`: `1` 지하철, `2` 버스, `3` 도보
  - `lane[0].name`: 노선명 (지하철호선·버스번호)
  - `startName`: 승차 정류장/역
  - `endName`: 하차 정류장/역
  - `passStopList.stations[]`: 경유역 목록

### 4. 지하철역명 → 좌표 변환 (ODsay)

좌표를 모르고 역명만 아는 경우:

```bash
ODSAY_KEY=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['ODSAY_API_KEY'],safe=''))")
curl -s "https://api.odsay.com/v1/api/searchStation?apiKey=${ODSAY_KEY}&stationName=강남&CID=1000"
```

`CID=1000` 은 수도권이다. 다른 지역 CID는 ODsay 문서 참고.
응답 `result.station[].x`, `.y` 가 좌표다.

## 응답 요약 포맷

```
🚇 강남 → 잠실
경로 1: 25분 · 1,350원 · 환승 0회 · 도보 450m
  🚶 도보 3분
  🚇 2호선 강남 → 잠실 (8정거장, 20분)
  🚶 도보 2분

경로 2: 32분 · 1,350원 · 환승 1회 · 도보 380m
  🚶 도보 2분
  🚇 2호선 강남 → 교대 (3정거장, 8분)
  🚇 3호선 교대 → ... (4정거장, 17분)
  🚶 도보 3분
```

3개 이내 경로 비교를 권장한다. 사용자가 "최소시간"을 원하면 `OPT=4`, "최소환승"이면 `OPT=5` 로 조회.

## Workflow 규칙

1. 좌표가 없으면 반드시 geocoding을 먼저 수행한다.
2. "출발"과 "도착"이 모두 확인되어야 ODsay를 호출한다.
3. 첫/끝 도보 구간을 반드시 요약에 포함한다. 이게 도어투도어의 핵심이다.
4. 요금과 소요시간은 반드시 포함한다.
5. ODsay API 키를 응답에 절대 노출하지 않는다.

## 에러 처리

- `error` 응답: `msg` 필드를 사용자에게 표시하고 API 키·IP 등록 상태를 확인하도록 안내
- Geocoding 결과 없음: 주소·장소명을 더 구체적으로 다시 요청
- 경로 없음: 대중교통 미개통 지역이거나 도보 가능 거리일 수 있음. 사용자에게 확인
- Quota 초과: 더 이상 호출하지 않고 사용자에게 알림

## 주의사항

- ODsay Basic 상품 기준 일일 1,000건 제한 (첫 6개월 무료 체험 후)
- `searchPubTransPathT` + `searchStation` 호출 합산이므로 호출 최소화
- 한국 이외 좌표는 지원하지 않음
- 대중교통 전용. 자동차 경로는 `kakao-map` 사용
- ODsay API 키는 절대 응답·로그에 포함하지 않는다

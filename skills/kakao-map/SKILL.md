---
name: kakao-map
version: "1.0.0"
description: 카카오맵 장소 검색(키워드/카테고리/좌표↔주소) 및 자동차 길찾기. 근처 식당, 카페, 관광명소, 지하철역, 주차장 등을 찾고 운전 경로·소요시간·택시요금을 조회한다. 모든 호출은 k-skill-proxy 경유이므로 사용자 API 키는 필요 없다.\n\nKakao Map place search (keyword/category/coord↔address) and car directions. Find nearby restaurants, cafes, attractions, transit stops, parking lots. Driving routes with time/fare estimates. All calls go through k-skill-proxy — no user API key required.
activation:
  keywords:
    - "근처"
    - "카페"
    - "식당"
    - "맛집"
    - "주변"
    - "관광"
    - "명소"
    - "호텔"
    - "편의점"
    - "주차"
    - "약국"
    - "병원"
    - "카카오맵"
    - "길찾기"
    - "주소"
    - "좌표"
    - "nearby"
    - "restaurant"
    - "directions"
    - "attraction"
  patterns:
    - "(?i)(find|search|show|nearby|around|close to).*(restaurant|cafe|place|hotel|store)"
    - "(?i)(how|drive|car).*(direction|route|time|toll|fare)"
  tags:
    - "map"
    - "navigation"
    - "local"
    - "seoul"
    - "korean"
  max_context_tokens: 3000
---

# 카카오맵 장소 검색 & 길찾기

카카오 Developers의 Kakao Local API와 Kakao Mobility API를 k-skill-proxy 경유로 호출한다.
사용자는 별도 API 키 없이 프록시 서버를 통해 모든 요청을 처리한다.

## 프록시 기본 URL

`KSKILL_PROXY_BASE_URL` 환경변수가 있으면 그 값을 사용하고, 없으면 기본 hosted proxy `https://k-skill-proxy.nomadamas.org` 를 사용한다.

```bash
BASE="${KSKILL_PROXY_BASE_URL:-https://k-skill-proxy.nomadamas.org}"
```

## 언제 사용하는가

- "강남역 근처 카페 찾아줘"
- "역삼동 식당 추천해줘"
- "서울에 있는 한식당 검색"
- "여기 좌표가 어느 동이야?"
- "강남역에서 시청까지 자동차로 얼마나 걸려?"
- "통행료 피하는 경로로 알려줘"
- "이 근처 관광명소 뭐 있어?"
- "주변에 편의점 어디야?"

## 사용하지 말아야 할 때

- 대중교통(지하철+버스) 경로 → `korean-transit-route` 사용
- 도보·자전거 경로 (Kakao Mobility 미지원)
- 대량 인덱싱·스크래핑 (KaKao 약관 위반 및 쿼터 초과 위험)

## 카카오맵 카테고리 코드

| 코드 | 의미 | 대표 사용 예 |
|------|------|------------|
| MT1 | 대형마트 | 이마트, 홈플러스, 코스트코 |
| CS2 | 편의점 | CU, GS25, 세븐일레븐 |
| PK6 | 주차장 | 근처 주차장 검색 |
| OL7 | 주유소·충전소 | 기름값·전기차 충전소 |
| SW8 | 지하철역 | 역 위치 확인 |
| BK9 | 은행 | ATM, 영업점 |
| CT1 | 문화시설 | 박물관, 미술관, 공연장 |
| AT4 | 관광명소 | 남산타워, 경복궁 등 |
| AD5 | 숙박 | 호텔, 모텔, 게스트하우스 |
| FD6 | 음식점 | 한식, 중식, 일식, 양식 등 |
| CE7 | 카페 | 스타벅스, 개인카페 등 |
| HP8 | 병원 | 종합병원, 의원 |
| PM9 | 약국 | 처방약, 일반약 |

## 1. 키워드 장소 검색

특정 중심 좌표 주변을 키워드로 검색한다.

```bash
curl -fsS --get "${BASE}/v1/kakao-map/search/keyword" \
  --data-urlencode 'q=스타벅스' \
  --data-urlencode 'x=127.0276' \
  --data-urlencode 'y=37.4979' \
  --data-urlencode 'radius=500' \
  --data-urlencode 'sort=distance'
```

파라미터:
- `q`: 검색 키워드 (필수)
- `x`, `y`: 중심 좌표 (WGS84 경도/위도. 선택이지만 정확도를 위해 권장)
- `radius`: 검색 반경 (미터, 0~20000, 기본값은 Kakao API 기본값)
- `category_group_code`: 카테고리 필터 (예: FD6, CE7)
- `sort`: `accuracy`(정확도순, 기본) 또는 `distance`(거리순)
- `page`: 페이지 번호 (1~45)
- `size`: 페이지당 결과 수 (1~15)

응답 `documents[]` 에서 `place_name`, `road_address_name`, `phone`, `place_url`, `distance` 를 추출한다.

## 2. 카테고리 장소 검색

중심 좌표 주변의 특정 카테고리 장소를 검색한다.

```bash
curl -fsS --get "${BASE}/v1/kakao-map/search/category" \
  --data-urlencode 'category_group_code=FD6' \
  --data-urlencode 'x=127.0276' \
  --data-urlencode 'y=37.4979' \
  --data-urlencode 'radius=500'
```

`x`, `y`, `category_group_code` 는 필수다.

## 3. 좌표 → 주소 변환

좌표를 도로명주소와 지번주소로 변환한다.

```bash
curl -fsS --get "${BASE}/v1/kakao-map/coord2address" \
  --data-urlencode 'x=127.0276' \
  --data-urlencode 'y=37.4979'
```

응답에서 `documents[0].road_address.address_name` (도로명), `documents[0].address.address_name` (지번) 을 사용한다.

## 4. 좌표 → 행정구역 변환

좌표가 어느 시·도·구·동에 속하는지 확인한다.

```bash
curl -fsS --get "${BASE}/v1/kakao-map/coord2region" \
  --data-urlencode 'x=127.0276' \
  --data-urlencode 'y=37.4979'
```

응답에 `region_type` (B=법정동, H=행정동) 별 결과가 포함된다.

## 5. 자동차 길찾기

출발지에서 목적지까지 자동차 경로·소요시간·통행료·택시요금을 조회한다.

```bash
curl -fsS --get "${BASE}/v1/kakao-mobility/directions" \
  --data-urlencode 'origin=126.9706,37.5559' \
  --data-urlencode 'destination=127.0276,37.4979' \
  --data-urlencode 'priority=RECOMMEND'
```

파라미터:
- `origin`: 출발지 `x,y` (WGS84 경도,위도. 필수)
- `destination`: 도착지 `x,y` (필수)
- `waypoints`: 경유지 (최대 5개, `|` 구분)
- `priority`: `RECOMMEND`(추천, 기본), `TIME`(최소시간), `DISTANCE`(최단거리)
- `car_fuel`: `GASOLINE`, `DIESEL`, `LPG`
- `car_hipass`: `true` / `false`
- `alternatives`: 대안 경로 포함 여부 (`true` / `false`)
- `avoid`: 회피 옵션 (`toll` 통행료, `motorway` 고속도로, `ferries` 페리, `schoolzone` 스쿨존, `uturn` 유턴. `|` 구분)

응답 `routes[0].summary` 에서:
- `distance` (미터) → km 환산
- `duration` (초) → 분 환산
- `fare.taxi` 예상 택시요금 (원)
- `fare.toll` 통행료 (원)

## 6. 응답 요약 포맷

장소 검색 결과:

```
강남역 근처 카페 5곳 (반경 500m, 가까운 순)
1) 스타벅스 강남R점 — 강남구 테헤란로 ... (120m, 02-...)
2) 커피빈 강남대로점 — 강남구 강남대로 ... (250m)
3) ...
```

자동차 길찾기:

```
자동차 경로: (126.9706,37.5559) → (127.0276,37.4979)
- 거리: 12.3km / 예상 소요시간: 25분
- 통행료: 1,200원 / 예상 택시요금: 18,500원
- 옵션: RECOMMEND
```

## Workflow 규칙

1. 사용자가 위치를 말하면 먼저 geocoding 으로 좌표를 얻는다. 명확한 역명·랜드마크는 바로 좌표를 추정해도 된다.
2. "근처", "주변" 같은 표현이 있으면 반드시 중심 좌표 + 반경 검색을 한다.
3. 카테고리가 명확하면 카테고리 검색(`search/category`)이 키워드 검색보다 정확하다.
4. 검색 결과가 없으면 반경을 넓히거나 `sort=accuracy` 로 전환한다.
5. 사용자가 원하는 개수만 요약한다 (보통 5개).
6. 결과에는 이름, 주소, 거리, 전화번호(있으면)를 포함한다.
7. 실시간 영업 여부나 리뷰 점수는 이 API에서 제공되지 않는다.

## 주의사항

- Kakao Mobility는 자동차 전용이다. 대중교통은 `korean-transit-route` 스킬 사용.
- 프록시 서버가 `KAKAO_REST_API_KEY` 를 관리하므로 사용자는 키를 알 필요가 없다.
- `KSKILL_PROXY_BASE_URL` 이 설정되어 있지 않으면 기본 hosted proxy를 사용한다.
- 좌표는 WGS84 (경도,위도) 형식이다. 위도/경도가 바뀌지 않도록 주의.
- API 키나 시크릿은 절대 응답에 포함하지 않는다.

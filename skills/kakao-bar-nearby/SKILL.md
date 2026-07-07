---
name: kakao-bar-nearby
version: "1.0.0"
description: 사용자 위치 기준 근처 술집·바·이자카야를 카카오맵으로 찾는다. 위치를 먼저 질문한 뒤 키워드 검색으로 주변 술집을 조회하고, 주소·전화번호·거리 정보를 요약한다. 모든 호출은 k-skill-proxy 경유이므로 사용자 API 키는 필요 없다.\n\nFind nearby bars, pubs, and izakayas by user location via Kakao Map. Asks for location first, then keyword-searches for bars and summarizes name, address, phone, and distance. All calls go through k-skill-proxy — no user token required.
activation:
  keywords:
    - "술집"
    - "바"
    - "이자카야"
    - "와인바"
    - "호프"
    - "포차"
    - "맥주"
    - "칵테일"
    - "전통주"
    - "소주"
    - "하이볼"
    - "bar"
    - "pub"
    - "drinks"
    - "wine"
    - "beer"
    - "cocktail"
    - "izakaya"
    - "nightlife"
    - "drinking"
  patterns:
    - "(?i)(bar|pub|drink|cocktail|wine|beer|izakaya).*(near|nearby|around|find|recommend)"
    - "(?i)(find|show|recommend|search).*(bar|pub|drinks|cocktail)"
  tags:
    - "food"
    - "entertainment"
    - "seoul"
    - "korean"
  max_context_tokens: 2000
---

# 근처 술집 찾기

카카오맵의 장소 검색을 k-skill-proxy 경유로 호출하여 사용자 위치 기준 근처 술집을 찾는다.
별도 API 키 없이 프록시 서버를 통해 모든 요청을 처리한다.

## 프록시 기본 URL

`KSKILL_PROXY_BASE_URL` 환경변수가 있으면 그 값을 사용하고, 없으면 기본 hosted proxy `https://k-skill-proxy.nomadamas.org` 를 사용한다.

```bash
BASE="${KSKILL_PROXY_BASE_URL:-https://k-skill-proxy.nomadamas.org}"
```

## 언제 사용하는가

- "서울역 근처 술집 찾아줘"
- "강남에서 와인바 추천해줘"
- "논현 근처 4명 갈만한 술집"
- "사당에서 전화번호 있는 이자카야"
- "신촌 근처 분위기 좋은 칵테일바"
- "홍대 가볼만한 호프"

## 가장 먼저 할 일

**위치 정보 없이 절대 바로 검색하지 않는다. 반드시 먼저 현재 위치를 질문한다.**

권장 질문:
```
현재 위치를 알려주세요. 서울역, 강남, 홍대 같은 역명이나 동네명으로 알려주시면
카카오맵 기준 근처 술집을 찾아볼게요.
```

위치가 애매하면:
```
가까운 역명이나 동네 이름으로 한 번만 더 알려주세요.
(예: 강남역, 사당역, 홍대입구, 논현동)
```

## Workflow

### 1. 위치 geocoding

사용자가 알려준 위치(역명·동네명·랜드마크)를 좌표로 변환한다.

```bash
curl -fsS --get "${BASE}/v1/kakao-local/geocode" \
  --data-urlencode 'q=서울역'
```

응답 `documents[0].x`(경도), `documents[0].y`(위도) 를 추출한다.

### 2. 키워드로 근처 술집 검색

geocoding으로 얻은 좌표를 중심으로 술집을 키워드 검색한다.
사용자가 특정 종류를 언급했으면 그 키워드를, 아니면 `술집` 으로 검색한다.

```bash
curl -fsS --get "${BASE}/v1/kakao-map/search/keyword" \
  --data-urlencode 'q=술집' \
  --data-urlencode 'x=126.9706' \
  --data-urlencode 'y=37.5559' \
  --data-urlencode 'radius=1000' \
  --data-urlencode 'sort=distance'
```

사용자 의도에 따른 검색어 예시:
- 기본: `술집`
- "와인바": `와인바`
- "이자카야": `이자카야`
- "호프": `호프`
- "칵테일바": `칵테일바`
- "전통주": `전통주`
- "분위기 좋은 술집": `분위기 좋은 술집`

### 3. 결과 요약

상위 5개 결과를 아래 기준으로 정리한다:
- 술집명
- 카테고리 (한식, 일식, 주점, 와인바 등 — `category_name` 필드)
- 주소 (`road_address_name` 또는 `address_name`)
- 전화번호 (`phone`)
- 거리 (`distance` — 미터 단위. 1km 이상이면 km로 표시)

## 응답 요약 포맷

```
🍺 서울역 근처 술집 (반경 1km)

1. 역전할머니맥주 서울역점 — 호프/맥주 (120m)
   주소: 용산구 한강대로 ...
   전화: 02-777-7777

2. 서울역이자카야 — 일식/이자카야 (250m)
   주소: 용산구 청파로 ...
   전화: 02-888-8888

3. ...
```

## Workflow 규칙

1. 위치 질문을 생략하지 않는다. 이게 스킬의 핵심 UX다.
2. 사용자가 특정 종류(와인바, 이자카야, 호프 등)를 말하면 해당 키워드로 검색.
3. 검색 반경은 기본 1km (1000m). 사용자가 "가까운 곳"을 원하면 500m, "좀 넓게"를 원하면 2km.
4. 결과가 너무 적으면 반경을 넓히거나 검색어를 `술집` 으로 일반화.
5. 결과가 너무 많으면 가까운 순으로 5개만 보여준다.
6. 거리는 미터 그대로 표시하고, 1km 이상이면 "1.2km" 로 변환.
7. 전화번호가 있는 결과는 항상 포함한다. 없는 결과도 주소가 있으면 보여준다.
8. 영업 중 여부는 이 API에서 직접 제공되지 않으므로 표시하지 않는다.

## 주의사항

- 카카오맵 검색 API는 검색어 의존도가 높다. "술집"이 가장 범용적이지만, 와인바·칵테일바 등은 별도 키워드가 더 정확하다.
- 전화번호가 없는 업체도 있다. 영세 업체나 신규 오픈 업체는 정보가 부족할 수 있다.
- 프록시 서버가 `KAKAO_REST_API_KEY` 를 관리하므로 사용자는 키를 알 필요가 없다.
- API 키나 시크릿은 절대 응답에 포함하지 않는다.

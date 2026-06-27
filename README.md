# NOLABEL · 익명배송 통합 데모 (기사 앱 + 수취인 앱)

> QR 기반 익명 배송. 송장에는 ID·지역 코드만, 상세 정보는 기사 앱에서 일회성으로 조회되고 수취인이 수령 확인하는 순간 폐기됩니다.

순수 HTML / CSS / vanilla JavaScript + Supabase 실시간 DB + Vercel 서버리스 함수로 만든 모바일 우선 데모입니다.
**기사 앱**(`index.html`)과 **수취인 앱**(`receiver.html`) 두 개의 화면이 Supabase Realtime 으로 자동 연동되어, 한쪽의 상태 변화가 다른 쪽에 즉시 반영됩니다.
아이폰 Safari (HTTPS) 에서 실제 카메라·위치 권한을 사용해 동작합니다.

### 🌐 배포된 데모

| 앱 | URL |
| --- | --- |
| **기사 앱** | https://nolabel-driver.vercel.app |
| **수취인 앱** | https://nolabel-driver.vercel.app/receiver.html |

---

## 🎬 시연 영상

▶️ https://youtube.com/shorts/dbEtpDWui2g

기사 앱과 수취인 앱의 실시간 연동 전체 플로우 — QR 스캔 등록 → 배송중 자동 전환 → AI 최적경로 → 배송완료 → 수취인 QR 인증 → 개인정보 폐기까지.

---

## 🗂 파일 구조

```
.
├── index.html              # 기사 앱 (SPA, 모든 화면 + Supabase 연동)
├── receiver.html           # 수취인 앱 (SPA, 모든 화면 + Supabase 연동)
├── supabase.js             # 두 앱 공통 Supabase 모듈 (window.NL.*)
├── qr-generate.html        # 데모용 송장 QR 생성기 (Leaflet 좌표 선택 → JSON QR)
├── api/
│   └── optimize-route.js   # Vercel 서버리스 함수 (Claude 호출 + nearest-neighbor 보정)
├── vercel.json             # 함수 설정 + 카메라/위치 Permissions-Policy
├── ikon.png                # 로고
└── README.md
```

### 각 파일 역할 한 줄 요약
- **`index.html`** — 기사 앱. QR 스캔 등록, 실제 지도(Leaflet), 실시간 GPS 추적, AI 최적 경로(Claude + nearest-neighbor + OSRM 도로), 통화(tel:), 배송 완료 알림, 데모 리셋
- **`receiver.html`** — 수취인 앱. 본인 배송만 필터, 배송 준비중/배송중/배송완료/수령완료 상태 자동 전환, 실시간 추적 지도, QR 본인 인증, 정보 폐기
- **`supabase.js`** — 두 앱이 공유하는 Supabase 클라이언트 + 헬퍼 (`window.NL`). `fetchAll`, `upsertDelivery`, `updateStatus`, `markReceived`, `subscribe`, `pushDriverLocation`, `subscribeDriverLocation`, `resetDemo` 등
- **`qr-generate.html`** — 데모 QR 생성기. 주소 입력 → Nominatim 지오코딩 → QR 출력 (실패 시 미니맵에서 수동 보정)
- **`api/optimize-route.js`** — Claude API 호출하되, 항상 nearest-neighbor 베이스라인과 거리 비교 후 더 짧은 쪽 채택

---

## 📱 데모 플로우 (기사 ↔ 수취인 실시간 연동 사이클)

| # | 상태 | 동작 |
| --- | --- | --- |
| 0 | DB 비어 있음 | 수취인 앱 카드: **"배송 준비중 · 기사님 픽업 대기"** |
| 1 | 기사 QR 스캔 | `deliveries` 테이블에 INSERT (`status='in_transit'`) → 수취인 카드가 **"배송중"** 으로 자동 전환 + 토스트 |
| 2 | 기사 🤖 AI 최적 경로 계산 | Claude 가 방문 순서 제안 → 서버가 nearest-neighbor 와 거리 비교 → **더 짧은 쪽 채택** → OSRM 으로 실제 도로 polyline + 카드 순서·번호 재배정 |
| 3 | 기사 이동 | `watchPosition` 으로 5초 throttle 마다 `driver_location` upsert → 수취인 추적 지도의 🚚 마커가 실시간 이동 |
| 4 | 기사 '배송 완료 알림' | `status='delivered'` UPDATE → 수취인 카드 **"배송완료 · 수령 확인 필요"** 로 자동 전환 + 강조 |
| 5 | 수취인 박스 QR 스캔 → 본인 인증 | 카메라로 QR → ID 일치 확인 → 인증 코드 화면 → '인증 완료' |
| 6 | 정보 폐기 | `NL.markReceived` 가 `name/address/phone = null`, `status='received'` UPDATE → 양쪽 앱이 **"🔒 정보 폐기됨"** 으로 일관 표시 |
| 7 | 폐기 완료 화면 | 수취인은 컨페티 애니메이션 + 폐기 안내 카드 |
| 8 | 새로고침(반복 시연) | 각 앱 부트스트랩이 `status='received'` 행 발견 → 즉시 DELETE → 양쪽 앱 0번 상태로 복귀 |
| 🔄 | 발표자 데모 리셋 | 기사 앱 목록 하단 '🔄 데모 리셋' → `NL.resetDemo()` 가 `deliveries` 전체 + `driver_location` 삭제 |

---

## ▶️ 로컬 실행

`index.html` / `receiver.html` 은 정적이지만 `/api/optimize-route` 와 Supabase 가 필요합니다.

```bash
# 1) Vercel CLI 설치 (한 번만)
npm i -g vercel

# 2) 환경변수 (로컬 .env.development.local 또는 vercel env)
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.development.local

# 3) 로컬 서버 실행
vercel dev
# → http://localhost:3000           (기사 앱)
# → http://localhost:3000/receiver.html (수취인 앱)
```

> **HTTPS 필요**: 카메라/위치 API 는 HTTPS 또는 `localhost` 에서만 동작합니다. 아이폰에서 테스트하려면 Vercel 배포본(자동 HTTPS)을 사용하세요.

---

## 🗄 Supabase 설정

`supabase.js` 안에 URL 과 **anon 공개 키**가 하드코딩되어 있습니다 (anon 키는 노출되어도 안전 — RLS 로 통제).
처음 한 번만 Supabase 대시보드에서 아래를 잡아주세요.

### 1) 테이블 두 개 생성

```sql
-- 송장 (배송)
create table public.deliveries (
  id          text primary key,
  name        text,
  address     text,
  phone       text,
  lat         double precision,
  lng         double precision,
  region      text,
  status      text,                       -- 'in_transit' | 'delivered' | 'received'
  updated_at  timestamptz default now()
);

-- 기사 위치 (단일 행 'driver')
create table public.driver_location (
  id          text primary key,           -- 'driver'
  lat         double precision,
  lng         double precision,
  updated_at  timestamptz default now()
);
```

### 2) RLS 정책 (anon 권한)

```sql
-- deliveries
alter table public.deliveries enable row level security;
create policy "anon_select" on public.deliveries for select to anon using (true);
create policy "anon_insert" on public.deliveries for insert to anon with check (true);
create policy "anon_update" on public.deliveries for update to anon using (true) with check (true);
create policy "anon_delete" on public.deliveries for delete to anon using (true);

-- driver_location
alter table public.driver_location enable row level security;
create policy "anon_all" on public.driver_location for all to anon using (true) with check (true);
```

### 3) Realtime publication 활성화

Supabase 대시보드 → **Database → Replication** → `supabase_realtime` publication 에
`deliveries`, `driver_location` 두 테이블을 추가 (또는 SQL):

```sql
alter publication supabase_realtime add table public.deliveries;
alter publication supabase_realtime add table public.driver_location;
```

### 🔐 보안 안내
- 이 데모는 **anon 키 + 풀오픈 RLS** 라서 누구나 read/write 가능합니다. 데모/시연용으로만 쓰세요.
- 실제 사용 시엔 RLS 를 `auth.uid()` 기반으로 잠가야 합니다.
- **`service_role` 키는 사용하지 않습니다.** 클라이언트에서 절대 노출 금지.
- 실제 개인정보(진짜 주소·전화)는 넣지 마세요.

---

## ☁️ Vercel 배포

```bash
# (1) 처음 한 번
vercel
# (2) 이후
vercel --prod
```

### ⚠️ **Vercel 환경변수 `ANTHROPIC_API_KEY` 설정 (필수)**

배포 후 Vercel 대시보드 → 프로젝트 → **Settings → Environment Variables** 에서 다음을 추가하세요.

| Key                  | Value                  | Environments                    |
| -------------------- | ---------------------- | ------------------------------- |
| `ANTHROPIC_API_KEY`  | `sk-ant-...` (본인 키) | Production, Preview, Development |

CLI 로도 가능:

```bash
vercel env add ANTHROPIC_API_KEY production
vercel env add ANTHROPIC_API_KEY preview
vercel env add ANTHROPIC_API_KEY development
```

환경변수를 추가한 뒤 **다시 배포** 해야 적용됩니다 (`vercel --prod`).

> 🔐 Anthropic API 키는 절대 클라이언트로 나가지 않습니다. `/api/optimize-route` 서버리스 함수 안에서만 사용됩니다.

---

## 📲 아이폰 Safari 권한 안내

배포된 URL 을 아이폰 Safari 에서 열면 다음 권한을 묻습니다.

1. **카메라** — 'NOLABEL …이(가) 카메라에 접근하려고 합니다.' → **허용**
2. **위치** — '… 위치를 사용하려고 합니다.' → **한 번 허용** 또는 **사용 중에 허용**

권한이 거부된 경우:

- 설정 앱 → Safari → **카메라 / 위치** → '허용' 또는 '확인'
- Safari 주소창 좌측 'AA' → 웹사이트 설정 → **카메라 / 위치 허용**

> 🧪 PC 에서 `qr-generate.html` 을 열어 화면에 QR 을 띄운 뒤, 아이폰을 그 화면에 비추면 데모 송장 등록을 시연할 수 있습니다.

---

## 🧠 AI 응답 스펙 (`/api/optimize-route`)

### Request
```json
{
  "start": { "lat": 37.881, "lng": 127.730 },
  "deliveries": [
    { "id": "ND-2026-0608-001", "address": "...", "lat": 37.88, "lng": 127.73 }
  ]
}
```

### Response
```json
{
  "order":        ["ND-2026-0608-002", "ND-2026-0608-001", ...],
  "total_km":     12.3,
  "eta_min":      95,
  "source":       "claude",                    // 'claude' | 'nearest_neighbor'
  "claude_km":    12.3,                        // Claude 가 제안한 순서의 총거리 (실패 시 null)
  "nn_km":        13.7,                        // nearest-neighbor 베이스라인 총거리
  "claude_error": null                         // 호출/파싱 실패 사유 (정상이면 null)
}
```

### 동작 정책 — **항상 거리 기반 보정**
서버는 매 요청마다 **nearest-neighbor (haversine) 베이스라인을 항상 계산**한 뒤:
- **Claude 가 정상 응답** → Claude 의 총거리 vs nearest-neighbor 총거리를 비교해 **더 짧은 쪽** 채택 (`source: 'claude'` 또는 `'nearest_neighbor'`)
- **Claude 실패/파싱실패** → **nearest-neighbor 로 폴백** (`source: 'nearest_neighbor'`)
- **등록순(입력순) 그대로 폴백은 하지 않음** — 사용자에겐 어느 경로로도 항상 거리순 최적화된 결과가 보임

응답 `order` 그대로 도로 polyline 은 [OSRM 공개 서버](https://router.project-osrm.org/) 로 받아서 그립니다.

---

## 🛠 사용된 외부 라이브러리 (CDN)

| 라이브러리 | 용도 |
| --- | --- |
| [Supabase JS SDK v2](https://supabase.com/docs/reference/javascript) | DB CRUD + Realtime postgres_changes 구독 (양 앱 공유) |
| [Leaflet 1.9.4](https://leafletjs.com/) | 실제 지도 (OpenStreetMap 타일) |
| [html5-qrcode 2.3.x](https://github.com/mebjas/html5-qrcode) | 카메라 기반 QR 스캔 (기사 등록 + 수취인 인증) |
| [qrcode-generator (Kazuhiko Arase)](https://github.com/kazuhikoarase/qrcode-generator) | 송장 QR 생성기 (qr-generate.html). 진짜 auto-typeNumber + UTF-8 byte mode. jsdelivr → unpkg → cdnjs 3단 폴백 |
| [Nominatim](https://nominatim.openstreetmap.org/) | QR 생성기 주소 → 좌표 지오코딩 (키 불필요, 1초 throttle) |
| [OSRM 공개 서버](https://router.project-osrm.org/) | AI 최적 경로의 실제 도로 라우팅 (키 불필요) |
| [Anthropic Messages API](https://docs.anthropic.com/) | 경로 최적화 (서버리스 함수, `claude-sonnet-4-6`) |

---

## 🚀 배포 순서 요약

```bash
# 0) Supabase 프로젝트 만들고 위의 'Supabase 설정' SQL 실행

# 1) 의존성 없음 — 디렉토리 그대로
cd nolabel-mockup

# 2) Vercel 배포
vercel            # 첫 배포(프로젝트 연결)
vercel --prod     # 운영 배포

# 3) 환경변수 등록
vercel env add ANTHROPIC_API_KEY production
vercel --prod     # 다시 배포

# 4) 아이폰 Safari 에서 두 URL 을 동시에 (두 단말기 또는 두 탭) 열기
#    기사 앱:   https://<your-app>.vercel.app
#    수취인 앱: https://<your-app>.vercel.app/receiver.html
#    → 카메라/위치 권한 허용
#    → 기사 QR 스캔 → 수취인 자동 '배송중'
#    → AI 최적 경로 → 실도로 polyline + 카드 재정렬
#    → 기사 이동 → 수취인 추적 지도 🚚 실시간 따라옴
#    → 기사 배송 완료 → 수취인 '수령 확인 필요'
#    → 수취인 QR 스캔 + 인증 → 양쪽 '정보 폐기됨'
#    → 새로고침 또는 '🔄 데모 리셋' 으로 초기 상태로 복귀
```

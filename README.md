# NOLABEL · 익명배송 기사 앱 (해커톤 데모)

> QR 기반 익명 배송. 송장에는 ID·지역 코드만, 상세 정보는 기사 앱에서 일회성으로 조회되고 배송 완료 즉시 폐기됩니다.

순수 HTML / CSS / vanilla JavaScript + Vercel 서버리스 함수로 만든 모바일 우선 데모입니다.
아이폰 Safari (HTTPS) 에서 실제 카메라·위치 권한을 사용해 동작합니다.

---

## 📱 데모 플로우

1. **로그인** — 기사 ID/PW 입력 (데모는 그대로 '로그인' 탭하면 진행)
2. **일괄 QR 스캔** — 후면 카메라로 송장 QR을 읽어 `DELIVERIES` 배열에 실시간 등록
3. **배송 목록 + 실제 지도** — Leaflet + OpenStreetMap, 등록된 배송지 핀 + 내 위치 마커(GPS 실시간)
4. **🤖 AI 최적 경로 계산** — Claude (`claude-sonnet-4-6`) 가 시작점(현재 GPS) → 모든 배송지의 최단 방문 순서를 JSON으로 반환 → 순서 재배열 + 파란 polyline + 총 km/분 표시
5. **카드 탭 → 정보 조회** — 미니맵 + 수취인/주소/연락처
6. **배송 완료 알림** — 상태 '완료', 지도 핀 초록 체크, 완료 안내 화면

---

## 🗂 파일 구조

```
.
├── index.html              # 기사 앱 본체 (단일 파일 SPA, 모든 화면 포함)
├── qr-generate.html        # 데모용 송장 QR 생성기 (Leaflet 좌표 선택 → JSON QR)
├── api/
│   └── optimize-route.js   # Vercel 서버리스 함수 (Claude API 호출)
├── vercel.json
├── ikon.png                # 로고
└── README.md
```

---

## ▶️ 로컬 실행

`index.html` 은 정적이지만 `/api/optimize-route` 를 사용하려면 Vercel CLI 가 가장 편합니다.

```bash
# 1) Vercel CLI 설치 (한 번만)
npm i -g vercel

# 2) 환경변수 설정 (로컬 .env.development.local 또는 vercel env)
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.development.local

# 3) 로컬 서버 실행
vercel dev
# → http://localhost:3000 에서 동작
```

> **HTTPS 필요**: 카메라/위치 API 는 HTTPS 또는 `localhost` 에서만 동작합니다. 아이폰에서 테스트하려면 Vercel 배포본(자동 HTTPS)을 사용하세요.

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

> 🔐 API 키는 절대 클라이언트로 나가지 않습니다. `/api/optimize-route` 서버리스 함수 안에서만 사용됩니다.

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

## 🧠 AI 응답 스펙

`POST /api/optimize-route`

```json
// Request
{
  "start": { "lat": 37.881, "lng": 127.730 },
  "deliveries": [
    { "id": "ND-2026-0608-001", "address": "...", "lat": 37.88, "lng": 127.73 }
  ]
}

// Response (Claude 가 반환 → 서버에서 정리)
{
  "order":   ["ND-2026-0608-002", "ND-2026-0608-001", ...],
  "total_km": 12.3,
  "eta_min":  95,
  "fallback": false
}
```

Claude 출력이 JSON 파싱에 실패하면 입력 순서를 그대로 반환합니다 (`fallback: true`).

---

## 🖼 스크린샷 / GIF (자리표시)

| 화면 | 미리보기 |
| --- | --- |
| 로그인 | `docs/screenshot-login.png` *(추후 추가)* |
| 일괄 QR 스캔 | `docs/screenshot-scan.gif` *(추후 추가)* |
| 배송 목록 + 지도 | `docs/screenshot-list.png` *(추후 추가)* |
| AI 최적 경로 | `docs/screenshot-ai-route.gif` *(추후 추가)* |
| 정보 조회 | `docs/screenshot-lookup.png` *(추후 추가)* |
| 배송 완료 | `docs/screenshot-done.png` *(추후 추가)* |

---

## 🛠 사용된 외부 라이브러리 (CDN)

| 라이브러리 | 용도 |
| --- | --- |
| [Leaflet 1.9.4](https://leafletjs.com/) | 실제 지도 (OpenStreetMap 타일) |
| [html5-qrcode 2.3.10](https://github.com/mebjas/html5-qrcode) | 카메라 기반 QR 스캔 |
| [qrcode-generator (Kazuhiko Arase)](https://github.com/kazuhikoarase/qrcode-generator) | 송장 QR 생성기 (qr-generate.html). 진짜 auto-typeNumber + UTF-8 byte mode. jsdelivr → unpkg → cdnjs 3단 폴백 |
| [Nominatim](https://nominatim.openstreetmap.org/) | QR 생성기에서 주소 → 좌표 지오코딩 (키 불필요, 1초 throttle) |
| [OSRM 공개 서버](https://router.project-osrm.org/) | AI 최적 경로의 실제 도로 라우팅 (키 불필요) |
| [Anthropic Messages API](https://docs.anthropic.com/) | 경로 최적화 (서버리스 함수) |

---

## 🚀 배포 순서 요약

```bash
# 1) 의존성 없음 — 그냥 디렉토리 그대로
cd nolabel-mockup

# 2) Vercel 배포
vercel            # 첫 배포(프로젝트 연결)
vercel --prod     # 운영 배포

# 3) 환경변수 등록
vercel env add ANTHROPIC_API_KEY production
vercel --prod     # 다시 배포

# 4) 아이폰 Safari 에서 https://<your-app>.vercel.app 접속
#    → 로그인 → 일괄 QR 스캔 → 카메라/위치 권한 허용
#    → AI 최적 경로 계산 → 배송 완료
```

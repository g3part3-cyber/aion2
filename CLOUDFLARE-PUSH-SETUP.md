# Cloudflare 푸시 알림 설정

푸시 알림을 활성화하려면 Cloudflare Worker와 KV를 배포하고, 공개 앱의 `PUSH_API_URL`을 배포된 Worker 주소로 설정해야 합니다. VAPID 개인 키는 저장소에 커밋하지 마세요.

## 1. Worker 준비

Node.js 22 이상과 npm이 필요합니다.

PowerShell에서:

```powershell
Set-Location .\push-worker
npm install
npx wrangler login
npx wrangler kv namespace create PUSH_DATA
```

KV 생성 결과의 ID를 `wrangler.jsonc`의 `REPLACE_WITH_CLOUDFLARE_KV_NAMESPACE_ID`에 입력합니다. 앱을 기본 GitHub Pages 주소가 아닌 별도 도메인에서 제공한다면 `ALLOWED_ORIGIN`을 그 도메인의 origin으로, `SCHEDULE_URL`을 해당 도메인의 `schedule.json` URL로 변경합니다.

## 2. VAPID 키와 비밀값 설정

다음 명령으로 키 쌍을 로컬에서 생성합니다.

```powershell
node .\generate-vapid-keys.mjs
```

Worker 디렉터리에서 각 값을 Cloudflare Secret으로 입력합니다. `VAPID_PRIVATE_KEY`는 절대로 저장소에 넣지 마세요.

```powershell
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

각 명령이 값을 물으면 생성된 키 쌍의 해당 값을 입력합니다. `VAPID_SUBJECT`는 `wrangler.jsonc`에서 실제 연락 가능한 `mailto:` 주소로 변경합니다. 공개 키도 Worker Secret으로 저장하는 이유는 Worker의 `/config` 응답으로 앱에 전달하기 위해서입니다.

## 3. Worker 배포 및 앱 연결

```powershell
npx wrangler deploy
```

배포된 Worker 주소(예: `https://aion2-push.<계정 하위 도메인>.workers.dev`)를 복사해 [index.html](./index.html)의 `PUSH_API_URL` 값에 입력하고 앱을 다시 배포합니다.

## 4. 휴대폰 확인

사이트를 HTTPS로 열고, iPhone은 Safari에서 **홈 화면에 추가**한 웹 앱으로 실행합니다. Android는 Chrome에서 앱을 설치하거나 사이트 알림을 허용합니다. 앱에서 일정 탭으로 이동해 원하는 일정의 🔕 버튼을 눌러 권한을 허용하고 구독을 등록합니다. 이전 버전에서 이미 🔔로 선택했던 일정은 한 번 해제한 뒤 다시 켜야 새 푸시 구독에 동기화됩니다. Worker는 매분 일정 시각을 확인하므로 실제 수신 시점은 최대 약 1분 늦을 수 있습니다.

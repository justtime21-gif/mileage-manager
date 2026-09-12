// 홈 화면에 추가해 앱처럼 쓰기 위한 서비스워커. 오프라인에서도 화면이 뜨게 껍데기만 캐시한다.
//
// 캐시 전략을 고른 이유:
// - 이 앱은 배포가 잦다. HTML을 캐시 우선으로 두면 낡은 앱이 폰에 영원히 남는다.
//   그래서 화면 요청은 항상 네트워크를 먼저 보고, 실패할 때만 캐시로 떨어진다.
// - /api/* 는 절대 손대지 않는다. 로그인 토큰 검증, OCR, 구글시트 동기화, 서버 저장이
//   전부 여기로 간다. 한 번이라도 캐시되면 남의 응답이나 옛 데이터를 보게 된다.
// - 외부 도메인(Clerk, CDN)도 건드리지 않는다.
//
// 캐시를 비우려면 CACHE 값을 올린다. 옛 캐시는 activate에서 지운다.
const CACHE = 'mileage-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  // 새 워커가 곧바로 대기 상태를 벗어나게 한다 — 배포가 한 박자 늦게 반영되는 걸 막는다.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Clerk·CDN 등 외부는 그대로
  if (url.pathname.startsWith('/api/')) return;      // 서버 응답은 절대 캐시하지 않는다

  // 화면 이동은 네트워크 우선 — 배포한 새 버전이 바로 반영돼야 한다
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // 아이콘·매니페스트 같은 정적 파일은 캐시를 바로 주고 뒤에서 갱신한다
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});

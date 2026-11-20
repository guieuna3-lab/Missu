/* 푸시 수신만 담당합니다. 화면·사진·API 응답은 캐시하지 않습니다. */
const storeName = 'missu-push-state-v1';
const statePath = '/__missu_push_state__';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data;
      try {
        data = event.data?.json();
      } catch {
        return;
      }
      const cache = await caches.open(storeName);
      const saved = await cache.match(statePath);
      const state = saved ? await saved.json() : null;
      if (
        !state?.binding ||
        data?.binding !== state.binding ||
        !/^[0-9a-f-]{36}$/.test(data?.notificationId ?? '')
      )
        return;
      await self.registration.showNotification('비슷한 습득물을 확인했어요', {
        body: '미슈에서 내 분실 신고와 비슷한 물품을 확인해 주세요.',
        icon: '/missu-192.png',
        badge: '/missu-192.png',
        tag: 'missu-matches',
        data: { binding: state.binding },
      });
    })(),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(storeName);
      const saved = await cache.match(statePath);
      const state = saved ? await saved.json() : null;
      if (!state?.binding || state.binding !== event.notification.data?.binding) return;
      const url = new URL('/notifications', self.location.origin).href;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const app = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (app) {
        await app.navigate(url);
        await app.focus();
      } else await self.clients.openWindow(url);
    })(),
  );
});

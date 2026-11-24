self.addEventListener('push', event => {
  let data = { title: 'Task assigned to you', body: 'New task', tag: 'reny-task' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch { /* keep the fallback text */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Task assigned to you', {
    body: data.body || 'New task',
    icon: '/icon-192.png',
    badge: '/notification-icon.png',
    tag: data.tag || 'reny-task',
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      const open = windows.find(window => window.url.includes(self.location.origin));
      if (open) return open.focus();
      return clients.openWindow('/');
    })
  );
});

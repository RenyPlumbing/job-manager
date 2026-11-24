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

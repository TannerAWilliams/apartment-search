/// <reference lib="webworker" />
/**
 * Service worker for alert notifications, built to /sw.js by scripts/build-service-worker.ts. It caches
 * nothing, so the app always loads current code and listings from the Worker; it only shows pushed alerts
 * and opens the app when one is tapped.
 */
import { alertFromPush } from './alert-message.ts';

function showAlert(scope: ServiceWorkerGlobalScope, data: { json(): unknown } | null) {
  const alert = alertFromPush(data);
  return scope.registration.showNotification(alert.title, {
    body: alert.body,
    tag: alert.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: alert.url },
  });
}

/** Focuses an open app window on the alert's page, or opens one. */
async function openAlert(scope: ServiceWorkerGlobalScope, path: unknown) {
  const url = new URL(typeof path === 'string' ? path : '/', scope.location.origin).href;
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => client.url.startsWith(scope.location.origin));
  if (!open) return scope.clients.openWindow(url);
  const focused = await open.focus();
  return focused.navigate(url);
}

export function register(scope: ServiceWorkerGlobalScope) {
  scope.addEventListener('install', () => {
    void scope.skipWaiting();
  });
  scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()));
  scope.addEventListener('push', (event) => event.waitUntil(showAlert(scope, event.data)));
  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(openAlert(scope, (event.notification.data as { url?: unknown } | null)?.url));
  });
}

declare const self: ServiceWorkerGlobalScope;
if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) register(self);

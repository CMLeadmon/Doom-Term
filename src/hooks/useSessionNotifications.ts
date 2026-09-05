import { useEffect, useRef } from 'react';
import type { SessionNode } from '../types/sessionTree';
import { notificationTransition } from '../core/sessionNotifications';

/**
 * Thin browser adapter around the pure notification policy.
 *
 * Permission is never requested from a background transition: browsers reject
 * non-gesture requests, and an unsolicited prompt is worse than silence. The
 * switcher exposes the explicit enable action. Once granted, each native
 * notification carries a tag and activation routes to the exact session.
 */
export function useSessionNotifications(
  nodes: SessionNode[],
  activeSessionId: string,
  onActivate: (sessionId: string) => void,
): void {
  const previous = useRef<Map<string, SessionNode> | null>(null);
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;

  useEffect(() => {
    const current = new Map(nodes.map((node) => [node.id, node]));
    const before = previous.current;
    previous.current = current;
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const canWebNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';

    if (!before || (!isTauri && !canWebNotify)) return;

    for (const node of nodes) {
      const prior = before.get(node.id);
      if (!prior) continue;
      const notice = notificationTransition(prior, node, {
        activeSessionId,
        documentFocused: document.hasFocus(),
      });
      if (!notice) continue;

      if (isTauri) {
        import('@tauri-apps/api/core')
          .then(({ invoke }) => {
            void invoke('send_desktop_notification', { title: notice.title, body: notice.body });
          })
          .catch(() => {
            if (canWebNotify) {
              const native = new Notification(notice.title, { body: notice.body, tag: notice.key });
              native.onclick = () => {
                window.focus();
                activateRef.current(notice.sessionId);
                native.close();
              };
            }
          });
      } else if (canWebNotify) {
        const native = new Notification(notice.title, { body: notice.body, tag: notice.key });
        native.onclick = () => {
          window.focus();
          activateRef.current(notice.sessionId);
          native.close();
        };
      }
    }
  }, [nodes, activeSessionId]);
}

/** Explicit user-gesture entry point used by the command palette. */
export async function enableSessionNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

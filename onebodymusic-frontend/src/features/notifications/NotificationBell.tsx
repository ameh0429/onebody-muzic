import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { newUnreadNotification, useInbox, type InboxItem } from './notifications';
export function NotificationBell() {
  const { user } = useAuth(); const { data } = useInbox(user!.id);
  const seen = useRef<{ userId: string; ids: Set<string> } | null>(null);
  const [alert, setAlert] = useState<InboxItem | null>(null);
  useEffect(() => {
    if (!data) return;
    const previous = seen.current;
    if (previous?.userId === user!.id) {
      const newest = newUnreadNotification(data.data, previous.ids);
      if (newest) setAlert(newest);
      for (const item of data.data) previous.ids.add(item.id);
    } else {
      seen.current = { userId: user!.id, ids: new Set(data.data.map(item => item.id)) };
      setAlert(null);
    }
  }, [data, user!.id]);
  useEffect(() => {
    if (!alert) return;
    const timer = window.setTimeout(() => setAlert(null), 10000);
    return () => clearTimeout(timer);
  }, [alert]);
  const unread = data?.unreadCount || 0;
  return <><Link className="icon-btn notification-bell" to="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Bell size={20}/>{unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}</Link>{alert && <div className="notification-toast" role="status" aria-live="polite"><strong>{alert.title}</strong><p>{alert.body}</p><Link to="/notifications" onClick={() => setAlert(null)}>View notifications</Link><button className="quiet" aria-label="Dismiss notification" onClick={() => setAlert(null)}>Dismiss</button></div>}</>;
}

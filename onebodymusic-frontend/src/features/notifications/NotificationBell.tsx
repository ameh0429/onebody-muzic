import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useInbox } from './notifications';
export function NotificationBell() {
  const { user } = useAuth(); const { data } = useInbox(user!.id);
  const unread = data?.unreadCount || 0;
  return <Link className="icon-btn notification-bell" to="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Bell size={20}/>{unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}</Link>;
}

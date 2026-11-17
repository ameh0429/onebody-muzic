import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Busy, Empty, Failure, Heading, Pagination } from '../../components/ui';
import { markRead, useInbox } from './notifications';
import { message } from '../../lib/api';
export default function Notifications() {
  const { user } = useAuth(); const [page, setPage] = useState(1); const result = useInbox(user!.id, page);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const navigate = useNavigate();
  async function read(id?: string, href?: string) {
    setBusy(true); setError('');
    try { await markRead(id); if (href) navigate(href); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return <><Heading eyebrow="STAY IN THE LOOP" title="Notifications">Account updates and everything you need for your next rehearsal.</Heading>
    <div className="toolbar"><Link className="back" to="/profile">Notification preferences →</Link><button className="btn secondary" disabled={busy || !result.data?.unreadCount} onClick={() => void read()}>Mark all as read</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {result.isPending ? <Busy/> : result.error ? <Failure error={result.error} retry={() => void result.refetch()}/> : !result.data.data.length ? <Empty title="You’re all caught up">New notifications will appear here.</Empty> : <><ul className="panel notification-list" aria-label="Your notifications">{result.data.data.map(item => <li key={item.id} className={item.readAt ? '' : 'notification-unread'}>
      <div><h2>{item.title}{!item.readAt && <span className="pill">Unread</span>}</h2><p>{item.body}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>
      <div className="notification-actions"><button className="btn secondary" disabled={busy} onClick={() => void read(item.id, item.href)}>View details</button>{!item.readAt && <button className="quiet" disabled={busy} onClick={() => void read(item.id)}>Mark as read</button>}</div>
    </li>)}</ul><Pagination page={page} totalPages={result.data.totalPages} setPage={setPage}/></>}
  </>;
}

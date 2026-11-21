import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../../lib/query';
import { api, message } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { rememberPushDevice, hasBrowserPush, disableBrowserPush, enableBrowserPush, type Preferences } from './notifications';
interface EmailPreferences {
  enabled: boolean;
  rehearsals: boolean;
  reminders: boolean;
}

export default function NotificationPreferences() {
  const { user } = useAuth(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [subscribed, setSubscribed] = useState(false);
  const result = useQuery({ queryKey: ['notification-preferences', user!.id], queryFn: async () => (await api.get<Preferences>('/notifications/preferences')).data });
  const options = useQuery({ queryKey: ['push-options', user!.id], queryFn: async () => (await api.get<{ enabled: boolean; publicKey: string | null }>('/notifications/push/options')).data });
  const email = useQuery({
    queryKey: ['email-preferences', user!.id],
    queryFn: async () => (await api.get<EmailPreferences>('/notifications/email/preferences')).data,
  });
  async function saveEmail(next: Pick<EmailPreferences, 'rehearsals' | 'reminders'>) {
    setBusy(true); setError(''); setNotice('');
    const key = ['email-preferences', user!.id];
    const previous = email.data;
    queryClient.setQueryData(key, { ...previous, ...next });
    try {
      const response = await api.patch<EmailPreferences>('/notifications/email/preferences', next);
      queryClient.setQueryData(key, response.data);
      setNotice('Email preferences saved.');
    } catch (err) {
      queryClient.setQueryData(key, previous);
      setError(message(err));
    } finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    const check = () => { void hasBrowserPush(user!.id).then(enabled => { if (active) setSubscribed(enabled); }).catch(() => undefined); };
    check(); window.addEventListener('push-subscription-changed', check);
    return () => { active = false; window.removeEventListener('push-subscription-changed', check); };
  }, [user!.id]);
  async function save(next: Preferences) {
    setBusy(true); setError(''); setNotice('');
    const previous = result.data;
    queryClient.setQueryData(['notification-preferences', user!.id], next);
    try { await api.patch('/notifications/preferences', next); await result.refetch(); setNotice('Notification preferences saved.'); }
    catch (err) { queryClient.setQueryData(['notification-preferences', user!.id], previous); setError(message(err)); } finally { setBusy(false); }
  }
  async function togglePush() {
    setBusy(true); setError(''); setNotice('');
    try {
      if (subscribed && result.data?.push) { await disableBrowserPush(); setSubscribed(false); }
      else { await enableBrowserPush(user!.id, options.data!.publicKey!); setSubscribed(true); }
      const next = { ...result.data!, push: !(subscribed && result.data?.push) };
      await api.patch('/notifications/preferences', next); await result.refetch(); rememberPushDevice(user!.id, next.push); setNotice(next.push ? 'Push notifications enabled.' : 'Push notifications disabled.');
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return <section className="notification-preferences" aria-labelledby="notification-preferences-title"><h3 id="notification-preferences-title">Notification preferences</h3>
    <p className="subtle">Your inbox is always available. Choose which rehearsal alerts you receive.</p>
    {result.error ? <p className="error" role="alert">Could not load preferences. <button className="quiet" onClick={() => void result.refetch()}>Retry</button></p> : !result.data ? <p className="subtle">Loading preferences…</p> : <>
      <label className="notification-setting"><input type="checkbox" checked={result.data.rehearsals} disabled={busy} onChange={e => void save({ ...result.data!, rehearsals: e.target.checked })}/>Rehearsal and setlist changes</label>
      <label className="notification-setting"><input type="checkbox" checked={result.data.reminders} disabled={busy} onChange={e => void save({ ...result.data!, reminders: e.target.checked })}/>Rehearsal reminders (24 hours before)</label>
      <button className="btn secondary" disabled={busy || (!(subscribed && result.data.push) && !options.data?.enabled)} onClick={() => void togglePush()}>{subscribed && result.data.push ? 'Disable push notifications' : 'Enable notifications on this device'}</button>
      <p className="subtle text-sm">{options.isError ? 'Could not check push availability. Reload to retry.' : options.data?.enabled ? 'Disabling push stops alerts on all your devices.' : 'Push notifications are not configured yet. You can still use your inbox.'}</p>
    </>}
    {email.data?.enabled && <fieldset>
      <legend>Email notifications</legend>
      <label className="notification-setting"><input type="checkbox" checked={email.data.rehearsals} disabled={busy}
        onChange={e => void saveEmail({ rehearsals: e.target.checked, reminders: email.data!.reminders })}/>Email me about rehearsal and setlist changes</label>
      <label className="notification-setting"><input type="checkbox" checked={email.data.reminders} disabled={busy}
        onChange={e => void saveEmail({ rehearsals: email.data!.rehearsals, reminders: e.target.checked })}/>Email me rehearsal reminders</label>
      <p className="subtle text-sm">Account access emails are sent separately.</p>
    </fieldset>}
    {email.isError && <p className="error" role="alert">Could not load email preferences. <button className="quiet" onClick={() => void email.refetch()}>Retry</button></p>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}

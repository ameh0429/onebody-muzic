import NotificationPreferences from '../notifications/NotificationPreferences';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Camera, LoaderCircle, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { api, message } from '../../lib/api';
import type { User } from '../../lib/types';
import { Heading } from '../../components/ui';
import { InstallApp } from '../../components/PwaPrompt';
import { Avatar } from '../../components/Avatar';

const imageLimit = Number(import.meta.env.VITE_IMAGE_MAX_BYTES || 5242880);
export default function Profile() {
  const { user, update, logout } = useAuth();
  const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState<'name' | 'picture' | 'remove' | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);

  async function uploadPicture(file: File) {
    if (busy) return;
    if (!/\.(jpe?g|png|webp)$/iu.test(file.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > imageLimit) {
      setError(`Choose a non-empty JPEG, PNG or WebP image up to ${Math.round(imageLimit / 1048576)} MB.`); setSuccess(''); return;
    }
    setBusy('picture'); setError(''); setSuccess(''); setProgress(0);
    try {
      const body = new FormData(); body.append('file', file);
      const result = await api.post<User>('/users/me/picture', body, {
        timeout: Number(import.meta.env.VITE_MEDIA_UPLOAD_TIMEOUT_SECONDS || 120) * 1000,
        onUploadProgress: (event) => setProgress(Math.round((event.progress || 0) * 100)),
      });
      update(result.data); setSuccess('Your profile picture has been updated.');
    } catch (err: unknown) { setError(message(err)); } finally { setBusy(null); }
  }
  async function removePicture() {
    setBusy('remove'); setError(''); setSuccess('');
    try {
      const result = await api.delete<User>('/users/me/picture'); update(result.data);
      setSuccess('Your profile picture has been removed.');
    } catch (err: unknown) { setError(message(err)); } finally { setBusy(null); }
  }
  async function saveName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); setBusy('name'); setError(''); setSuccess('');
    try { const result = await api.patch<User>('/users/me', { name: String(data.get('name')).trim() }); update(result.data); setSuccess('Your profile has been updated.'); }
    catch (err: unknown) { setError(message(err)); } finally { setBusy(null); }
  }
  return <>
    <Heading eyebrow="YOUR PLACE IN THE COMMUNITY" title="Your profile">Good to have you here.</Heading>
    <section className="panel p-6 max-w-xl">
      <button type="button" className="profile-picture-button" aria-label="Change profile picture" aria-describedby="profile-picture-help" aria-busy={busy === 'picture'} disabled={!!busy} onClick={() => picker.current?.click()}>
        <Avatar className="profile-avatar" name={user?.name || ''} url={user?.profileImageUrl}/>
        <span className="profile-picture-camera" aria-hidden="true">{busy === 'picture' ? <LoaderCircle size={16} className="animate-spin"/> : <Camera size={16}/>}</span>
      </button>
      <input ref={picker} type="file" hidden aria-label="Profile picture" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={!!busy} onChange={e => {
        const selected = e.currentTarget.files?.[0]; e.currentTarget.value = '';
        if (selected) void uploadPicture(selected);
      }}/>

      <h2 className="mt-5">{user?.name}</h2><p className="subtle mt-1 break-all">{user?.email}</p>
      <span className="pill my-5">{user?.role === 'ADMIN' ? 'Administrator' : 'Church member'} · Active</span>
      <div className="profile-picture-form">
        <p id="profile-picture-help" className="subtle text-sm">JPEG, PNG or WebP · up to {Math.round(imageLimit / 1048576)} MB.</p>
        {user?.profileImageUrl && <button type="button" className="btn secondary mt-4" disabled={!!busy} onClick={() => void removePicture()}><Trash2 size={18}/>{busy === 'remove' ? 'Removing…' : 'Remove picture'}</button>}
        {busy === 'picture' && <p role="status" className="text-accent mt-4">{progress < 100 ? `Sending picture… ${progress}%` : 'Picture sent. Finishing upload…'}</p>}
      </div>
      <form className="form-stack" onSubmit={(e) => void saveName(e)}>
        <label>Full name<input required name="name" defaultValue={user?.name} minLength={2} maxLength={200}/></label>
        <p className="subtle text-sm">For account access or email changes, contact your church administrator.</p>
        <button className="btn" disabled={!!busy}>{busy === 'name' ? 'Saving…' : 'Save profile'}</button>
      </form>
      {error && <p className="error mt-4" role="alert">{error}</p>}{success && <p className="text-accent mt-4" role="status">{success}</p>}
      {user?.role === 'ADMIN' && <Link className="btn secondary mt-6" to="/admin"><ShieldCheck size={18}/>Admin workspace</Link>}
      <NotificationPreferences/>
      <InstallApp/>
      <button className="quiet mt-6" onClick={logout} disabled={!!busy}><LogOut size={18}/>Sign out</button>
    </section>
  </>;
}

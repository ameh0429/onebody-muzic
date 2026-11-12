import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Camera, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { api, message } from '../../lib/api';
import type { User } from '../../lib/types';
import { Heading } from '../../components/ui';
import { Avatar } from '../../components/Avatar';

const imageLimit = Number(import.meta.env.VITE_IMAGE_MAX_BYTES || 5242880);
export default function Profile() {
  const { user, update, logout } = useAuth();
  const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState<'name' | 'picture' | 'remove' | null>(null);
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState('');
  const [progress, setProgress] = useState(0); const [fileKey, setFileKey] = useState(0);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function savePicture(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!file) return;
    setBusy('picture'); setError(''); setSuccess(''); setProgress(0);
    try {
      const body = new FormData(); body.append('file', file);
      const result = await api.post<User>('/users/me/picture', body, {
        timeout: Number(import.meta.env.VITE_MEDIA_UPLOAD_TIMEOUT_SECONDS || 120) * 1000,
        onUploadProgress: (event) => setProgress(Math.round((event.progress || 0) * 100)),
      });
      update(result.data); setFile(null); setFileKey((key) => key + 1); setSuccess('Your profile picture has been updated.');
    } catch (err: unknown) { setError(message(err)); } finally { setBusy(null); }
  }
  async function removePicture() {
    setBusy('remove'); setError(''); setSuccess('');
    try {
      const result = await api.delete<User>('/users/me/picture'); update(result.data);
      setFile(null); setFileKey((key) => key + 1); setSuccess('Your profile picture has been removed.');
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
      <Avatar className="profile-avatar" name={user?.name || ''} url={preview || user?.profileImageUrl}/>
      <h2 className="mt-5">{user?.name}</h2><p className="subtle mt-1 break-all">{user?.email}</p>
      <span className="pill my-5">{user?.role === 'ADMIN' ? 'Administrator' : 'Church member'} · Active</span>
      <form className="form-stack profile-picture-form" onSubmit={(e) => void savePicture(e)}>
        <label>Profile picture<input key={fileKey} type="file" name="picture" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={!!busy} aria-describedby="profile-picture-help" onChange={(e) => {
          const selected = e.target.files?.[0]; setError(''); setSuccess('');
          if (!selected) { setFile(null); return; }
          if (!/\.(jpe?g|png|webp)$/iu.test(selected.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size === 0 || selected.size > imageLimit) {
            setError(`Choose a non-empty JPEG, PNG or WebP image up to ${Math.round(imageLimit / 1048576)} MB.`); setFile(null); e.target.value = ''; return;
          }
          setFile(selected);
        }}/></label>
        <p id="profile-picture-help" className="subtle text-sm">JPEG, PNG or WebP · up to {Math.round(imageLimit / 1048576)} MB. Profile pictures use a public image link; choose a photo you’re comfortable sharing.</p>
        <div className="profile-picture-actions"><button className="btn" disabled={!!busy || !file}><Camera size={18}/>{busy === 'picture' ? 'Uploading picture…' : user?.profileImageUrl ? 'Replace picture' : 'Upload picture'}</button>
          {file && <button type="button" className="btn secondary" disabled={!!busy} onClick={() => { setFile(null); setFileKey((key) => key + 1); }}>Cancel selection</button>}
          {user?.profileImageUrl && <button type="button" className="btn secondary" disabled={!!busy} onClick={() => void removePicture()}><Trash2 size={18}/>{busy === 'remove' ? 'Removing…' : 'Remove picture'}</button>}
        </div>
        {busy === 'picture' && <p role="status" className="text-accent">{progress < 100 ? `Sending picture… ${progress}%` : 'Picture sent. Finishing upload…'}</p>}
      </form>
      <form className="form-stack" onSubmit={(e) => void saveName(e)}>
        <label>Full name<input required name="name" defaultValue={user?.name} minLength={2} maxLength={200}/></label>
        <p className="subtle text-sm">For account access or email changes, contact your church administrator.</p>
        <button className="btn" disabled={!!busy}>{busy === 'name' ? 'Saving…' : 'Save profile'}</button>
      </form>
      {error && <p className="error mt-4" role="alert">{error}</p>}{success && <p className="text-accent mt-4" role="status">{success}</p>}
      {user?.role === 'ADMIN' && <Link className="btn secondary mt-6" to="/admin"><ShieldCheck size={18}/>Admin workspace</Link>}
      <button className="quiet mt-6" onClick={logout} disabled={!!busy}><LogOut size={18}/>Sign out</button>
    </section>
  </>;
}

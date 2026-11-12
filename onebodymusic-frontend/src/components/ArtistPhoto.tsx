import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import { refresh, useApi } from '../lib/query';
import type { Artist, MediaAsset } from '../lib/types';
import { Cover } from './ui';

const limit = Number(import.meta.env.VITE_IMAGE_MAX_BYTES || 5242880);
export function artistPhotoError(file: File): string {
  return !/\.(jpe?g|png|webp)$/iu.test(file.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > limit
    ? `Choose a non-empty JPEG, PNG or WebP photo up to ${Math.round(limit / 1048576)} MB.` : '';
}
export async function uploadArtistPhoto(file: File): Promise<MediaAsset & { url: string; publicId: string }> {
  const error = artistPhotoError(file); if (error) throw new Error(error);
  const body = new FormData(); body.append('folder', 'artists'); body.append('file', file);
  const { data } = await api.post<MediaAsset & { url: string; publicId: string }>('/media/images', body, { timeout: Number(import.meta.env.VITE_MEDIA_UPLOAD_TIMEOUT_SECONDS || 120) * 1000 });
  if (data.status !== 'READY' || !data.url || !data.publicId) {
    if (data.id) await api.delete(`/media/${data.id}`).catch(() => undefined);
    throw new Error('The artist photo is not ready. Please try again.');
  }
  return data;
}
export function ArtistPhotoInput({ file, onChange, optional = false }: { file: File | null; onChange: (file: File | null) => void; optional?: boolean }) {
  const [preview, setPreview] = useState(''); const input = useRef<HTMLInputElement>(null);
  const error = file ? artistPhotoError(file) : '';
  useEffect(() => {
    if (!file || artistPhotoError(file)) { setPreview(''); if (!file && input.current) input.current.value = ''; return; }
    const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div className="form-stack"><label>Artist photo{optional ? ' (optional)' : ''}<input ref={input} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(e) => onChange(e.target.files?.[0] || null)}/></label><span className="subtle text-xs">JPEG, PNG or WebP · up to {Math.round(limit / 1048576)} MB</span>
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <img className="artist-photo-preview" src={preview} alt="Selected artist photo preview"/>}
    {file && <button type="button" className="quiet" onClick={() => onChange(null)}>Cancel photo selection</button>}
  </div>;
}
export function ArtistPhotoEditor({ artistId, busy, setBusy }: { artistId: string; busy: boolean; setBusy: (value: boolean) => void }) {
  const artist = useApi<Artist>(`/artists/${artistId}`); const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [saving, setSaving] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!file) return;
    setBusy(true); setSaving(true); setError(''); setSuccess(''); let assetId = ''; let saved = false;
    try {
      const asset = await uploadArtistPhoto(file); assetId = asset.id;
      await api.patch(`/artists/${artistId}`, { imageUrl: asset.url, imagePublicId: asset.publicId }); saved = true;
      setFile(null); setSuccess('Artist photo updated.'); await refresh();
    } catch (err: unknown) {
      let detail = message(err);
      if (assetId && !saved) { try { await api.delete(`/media/${assetId}`); } catch { detail += ' An unused upload remains tracked for automatic cleanup.'; } }
      setError(detail);
    } finally { setSaving(false); setBusy(false); }
  }
  return <details className="my-5"><summary className="text-accent min-h-11 cursor-pointer flex items-center">Add or replace artist photo</summary>
    <form className="form-stack mt-3" onSubmit={(e) => void save(e)}>
      <p className="subtle text-sm">Photo for {artist.data?.name || 'the selected artist'}. This is separate from song artwork.</p>
      {artist.data?.imageUrl && <div className="artist-photo-preview"><Cover src={artist.data.imageUrl}/></div>}
      {artist.error && <p className="error" role="alert">{message(artist.error)}</p>}
      <ArtistPhotoInput file={file} onChange={(value) => { setFile(value); setError(''); setSuccess(''); }}/>
      <button className="btn secondary" disabled={busy || !file || !!artistPhotoError(file)}>{saving ? 'Uploading artist photo…' : 'Save artist photo'}</button>
      {saving && <p role="status" className="text-accent">Uploading and saving the artist photo…</p>}
      {error && <p role="alert" className="error">{error}</p>}{success && <p role="status" className="text-accent">{success}</p>}
    </form>
  </details>;
}

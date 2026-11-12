import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import { refresh, useApi } from '../lib/query';
import type { Album, Artist, MediaAsset } from '../lib/types';
import { Cover } from './ui';

const limit = Number(import.meta.env.VITE_IMAGE_MAX_BYTES || 5242880);
export function artistPhotoError(file: File): string {
  return !/\.(jpe?g|png|webp)$/iu.test(file.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > limit
    ? `Choose a non-empty JPEG, PNG or WebP photo up to ${Math.round(limit / 1048576)} MB.` : '';
}
async function uploadLibraryImage(file: File, folder: 'artists' | 'albums'): Promise<MediaAsset & { url: string; publicId: string }> {
  const error = artistPhotoError(file); if (error) throw new Error(error);
  const body = new FormData(); body.append('folder', folder); body.append('file', file);
  const { data } = await api.post<MediaAsset & { url: string; publicId: string }>('/media/images', body, { timeout: Number(import.meta.env.VITE_MEDIA_UPLOAD_TIMEOUT_SECONDS || 120) * 1000 });
  if (data.status !== 'READY' || !data.url || !data.publicId) {
    if (data.id) await api.delete(`/media/${data.id}`).catch(() => undefined);
    throw new Error('The image is not ready. Please try again.');
  }
  return data;
}
export const uploadArtistPhoto = (file: File) => uploadLibraryImage(file, 'artists');
export const uploadAlbumCover = (file: File) => uploadLibraryImage(file, 'albums');
export function ArtistPhotoInput({ file, onChange, optional = false, label = 'Artist photo' }: { file: File | null; onChange: (file: File | null) => void; optional?: boolean; label?: string }) {
  const [preview, setPreview] = useState(''); const input = useRef<HTMLInputElement>(null);
  const error = file ? artistPhotoError(file) : '';
  useEffect(() => {
    if (!file || artistPhotoError(file)) { setPreview(''); if (!file && input.current) input.current.value = ''; return; }
    const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div className="form-stack"><label>{label}{optional ? ' (optional)' : ''}<input ref={input} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(e) => onChange(e.target.files?.[0] || null)}/></label><span className="subtle text-xs">JPEG, PNG or WebP · up to {Math.round(limit / 1048576)} MB</span>
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <img className="artist-photo-preview" src={preview} alt={`Selected ${label.toLowerCase()} preview`}/>}
    {file && <button type="button" className="quiet" onClick={() => onChange(null)}>Cancel photo selection</button>}
  </div>;
}
function LibraryImageEditor({ id, resource, busy, setBusy }: { id: string; resource: 'artists' | 'albums'; busy: boolean; setBusy: (value: boolean) => void }) {
  const item = useApi<Artist | Album>(`/${resource}/${id}`); const label = resource === 'artists' ? 'Artist photo' : 'Album cover';
  const currentImage = item.data && ('name' in item.data ? item.data.imageUrl : item.data.coverImageUrl);
  const itemName = item.data && ('name' in item.data ? item.data.name : item.data.title); const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [saving, setSaving] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!file) return;
    setBusy(true); setSaving(true); setError(''); setSuccess(''); let assetId = ''; let saved = false;
    try {
      const asset = await uploadLibraryImage(file, resource); assetId = asset.id;
      await api.patch(`/${resource}/${id}`, resource === 'artists' ? { imageUrl: asset.url, imagePublicId: asset.publicId } : { coverImageUrl: asset.url, coverImagePublicId: asset.publicId }); saved = true;
      setFile(null); setSuccess(`${label} updated.`); await refresh();
    } catch (err: unknown) {
      let detail = message(err);
      if (assetId && !saved) { try { await api.delete(`/media/${assetId}`); } catch { detail += ' An unused upload remains tracked for automatic cleanup.'; } }
      setError(detail);
    } finally { setSaving(false); setBusy(false); }
  }
  return <details className="my-5"><summary className="text-accent min-h-11 cursor-pointer flex items-center">Add or replace {label.toLowerCase()}</summary>
    <form className="form-stack mt-3" onSubmit={(e) => void save(e)}>
      <p className="subtle text-sm">{label} for {itemName || 'the selected item'}. This is separate from song artwork.</p>
      {currentImage && <div className="artist-photo-preview"><Cover src={currentImage}/></div>}
      {item.error && <p className="error" role="alert">{message(item.error)}</p>}
      <ArtistPhotoInput label={label} file={file} onChange={(value) => { setFile(value); setError(''); setSuccess(''); }}/>
      <button className="btn secondary" disabled={busy || !file || !!artistPhotoError(file)}>{saving ? `Uploading ${label.toLowerCase()}…` : `Save ${label.toLowerCase()}`}</button>
      {saving && <p role="status" className="text-accent">Uploading and saving the {label.toLowerCase()}…</p>}
      {error && <p role="alert" className="error">{error}</p>}{success && <p role="status" className="text-accent">{success}</p>}
    </form>
  </details>;
}

export function ArtistPhotoEditor({ artistId, ...props }: { artistId: string; busy: boolean; setBusy: (value: boolean) => void }) {
  return <LibraryImageEditor id={artistId} resource="artists" {...props}/>;
}
export function AlbumCoverEditor({ albumId, ...props }: { albumId: string; busy: boolean; setBusy: (value: boolean) => void }) {
  return <LibraryImageEditor id={albumId} resource="albums" {...props}/>;
}

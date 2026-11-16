import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RemoteSelect } from '../../components/RemoteSelect';
import { refresh } from '../../lib/query';
import { audioLimit, uploadError, uploadItem, type UploadItem } from './bulkUpload';

export default function BulkUpload({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [artistId, setArtistId] = useState('');
  const [albumId, setAlbumId] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => { if (controller.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('beforeunload', warn); };
  }, []);
  function patch(id: string, change: Partial<UploadItem>) { if (mounted.current) setItems(rows => rows.map(row => row.id === id ? { ...row, ...change } : row)); }
  function add(files: File[]) {
    setNotice('');
    setItems(rows => {
      const added: UploadItem[] = [];
      for (const file of files) {
        if ([...rows, ...added].some(row => row.file.name === file.name && row.file.size === file.size && row.file.lastModified === file.lastModified)) continue;
        added.push({ id: crypto.randomUUID(), file, title: file.name.replace(/\.[^.]+$/u, '').replace(/[_-]+/gu, ' ').slice(0, 200), artistId, albumId, category, status: 'queued', progress: 0 });
      }
      return [...rows, ...added];
    });
  }
  async function run() {
    if (controller.current || disabled) return;
    const pending = items.filter(row => ['queued', 'failed', 'cancelled'].includes(row.status));
    if (!pending.length) return;
    if (pending.some(row => uploadError(row))) { setNotice('Fix the validation messages before starting.'); return; }
    const active = new AbortController(); controller.current = active; setBusy(true); onBusyChange(true); setNotice('');
    try {
      for (const row of pending) {
        if (active.signal.aborted) { patch(row.id, { status: 'cancelled', error: 'Cancelled before upload.' }); continue; }
        await uploadItem(row, active.signal, change => patch(row.id, change));
      }
      try { await refresh(); } catch { if (mounted.current) setNotice('Uploads finished. Reload the library to refresh its contents.'); }
    } finally { controller.current = null; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }
  const pending = items.filter(row => ['queued', 'failed', 'cancelled'].includes(row.status));
  return <section className="panel p-6 mt-6" aria-labelledby="bulk-heading">
    <h2 id="bulk-heading">Bulk music upload</h2>
    <p className="subtle my-3">Select several songs, review their details, then upload. Keep this page open. Songs publish individually, one at a time. Cancelling during a save lets that save finish.</p>
    <fieldset disabled={busy || disabled} className="form-stack">
      <RemoteSelect label="Default artist" resource="artists" value={artistId} onChange={id => { setArtistId(id); setAlbumId(''); }}/>
      {artistId && <RemoteSelect key={artistId} label="Default album" resource="albums" value={albumId} onChange={setAlbumId} filter={`&artistId=${artistId}`} optional/>}
      <label>Default category<input value={category} maxLength={100} onChange={e => setCategory(e.target.value)}/></label>
      <button type="button" className="btn secondary" disabled={!artistId} onClick={() => setItems(rows => rows.map(row => ['queued', 'failed', 'cancelled'].includes(row.status) ? { ...row, artistId, albumId, category } : row))}>Apply defaults to pending songs</button>
      <label className="file-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) add(Array.from(e.dataTransfer.files)); }}>
        Select or drop audio files · MP3/M4A · up to {Math.round(audioLimit / 1048576)} MB each
        <input type="file" multiple accept=".mp3,.m4a,audio/mpeg,audio/mp4" onChange={e => { add(Array.from(e.target.files || [])); e.target.value = ''; }}/>
      </label>
    </fieldset>
    <ol className="form-stack my-5">
      {items.map((row, index) => <li key={row.id} className="panel p-4">
        <h3 className="break-all">{index + 1}. {row.file.name}</h3>
        <fieldset disabled={busy || disabled || ['completed', 'unknown'].includes(row.status)} className="form-stack mt-3">
          <label>Song title<input value={row.title} maxLength={200} onChange={e => patch(row.id, { title: e.target.value })}/></label>
          <RemoteSelect label={`Artist for song ${index + 1}`} resource="artists" value={row.artistId} onChange={id => patch(row.id, { artistId: id, albumId: '' })}/>
          {row.artistId && <RemoteSelect key={row.artistId} label={`Album for song ${index + 1}`} resource="albums" value={row.albumId} onChange={id => patch(row.id, { albumId: id })} filter={`&artistId=${row.artistId}`} optional/>}
          <label>Category<input value={row.category} maxLength={100} onChange={e => patch(row.id, { category: e.target.value })}/></label>
          <label>Artwork (optional)<input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={e => patch(row.id, { cover: e.target.files?.[0] })}/></label>
          <button type="button" className="quiet" onClick={() => setItems(rows => rows.filter(item => item.id !== row.id))}>Remove from queue</button>
        </fieldset>
        <p role="status" className="mt-3">{row.status === 'audio' ? row.progress < 100 ? `Sending audio: ${row.progress}%` : 'Audio sent; waiting for provider…' : row.status === 'artwork' ? 'Uploading artwork…' : row.status === 'saving' ? 'Saving song…' : row.status === 'unknown' ? 'Save needs checking' : row.status}</p>
        {!busy && !['completed', 'unknown'].includes(row.status) && uploadError(row) && <p className="error">{uploadError(row)}</p>}
        {row.error && <p className="error" role="alert">{row.error}</p>}
        {row.songId && <Link className="text-accent underline" to={`/songs/${row.songId}`}>View song</Link>}
        {row.status === 'unknown' && <Link className="text-accent underline" to="/songs">Check library</Link>}
      </li>)}
    </ol>
    <p role="status">{items.filter(row => row.status === 'completed').length} of {items.length} completed</p>
    {notice && <p role="alert" className="error my-3">{notice}</p>}
    <div className="flex flex-wrap gap-3 mt-3">
      <button type="button" className="btn" disabled={busy || disabled || !pending.length} onClick={() => void run()}>{busy ? 'Uploading queue…' : 'Upload pending / retry failed songs'}</button>
      {busy && <button type="button" className="btn secondary" onClick={() => { controller.current?.abort(); setNotice('Stopping the queue. Any song already saving will finish.'); }}>Cancel remaining uploads</button>}
      <button type="button" className="quiet" disabled={busy || disabled} onClick={() => setItems(rows => rows.filter(row => row.status !== 'completed'))}>Clear completed</button>
    </div>
  </section>;
}

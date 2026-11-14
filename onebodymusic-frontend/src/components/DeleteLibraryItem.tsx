import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import axios from 'axios';
import { api, message } from '../lib/api';
import { queryClient, refresh } from '../lib/query';
import { useAuth } from '../features/auth/AuthProvider';
import { usePlayer } from '../features/player/PlayerProvider';

type LibraryKind = 'songs' | 'albums' | 'artists';
const prerequisites: Record<LibraryKind, string> = {
  songs: 'Remove this song from any playlists before deleting it.',
  albums: 'Delete or move the songs out of this album before deleting it.',
  artists: 'Remove this artist’s albums, main-artist songs, and featured credits before deleting the artist.',
};

export function DeleteLibraryItem({ kind, id, title }: { kind: LibraryKind; id: string; title: string }) {
  const { user } = useAuth(); const player = usePlayer(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (user?.role !== 'ADMIN') return null;
  const singular = kind.slice(0, -1); const path = `/${kind}/${id}`;
  async function remove() {
    if (busy || !window.confirm(`Delete ${singular} “${title}”? This cannot be undone.\n\n${prerequisites[kind]}`)) return;
    setBusy(true); setError('');
    try {
      await api.delete(path);
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 409) setError(`Cannot delete this ${singular} yet. ${prerequisites[kind]}`);
      else if (axios.isAxiosError(error) && ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code || '')) setError('The deletion request timed out. Refresh the page to check whether the item was deleted before trying again.');
      else setError(message(error));
      setBusy(false); return;
    }
    if (kind === 'songs') player.stopIfSelected(id);
    queryClient.removeQueries({ queryKey: [path], exact: true });
    navigate(`/${kind}`, { replace: true, state: { libraryDeletion: { kind, title } } });
    void refresh();
  }
  return <section className="library-delete panel p-5 mb-6" aria-label={`Delete ${singular}`}><div className="flex items-center justify-between gap-4 flex-wrap"><p className="subtle text-sm flex-1 min-w-0">{prerequisites[kind]}</p><button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}><Trash2 size={18}/>{busy ? 'Deleting…' : `Delete ${singular}`}</button></div>{error && <p className="error mt-4" role="alert">{error}</p>}</section>;
}

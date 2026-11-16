import axios from 'axios';
import { api, message } from '../../lib/api';
import type { MediaAsset, Song } from '../../lib/types';

export type UploadStatus = 'queued' | 'audio' | 'artwork' | 'saving' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export interface UploadItem {
  id: string;
  file: File;
  title: string;
  artistId: string;
  albumId: string;
  category: string;
  cover?: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  songId?: string;
}
export const audioLimit = Number(import.meta.env.VITE_AUDIO_MAX_BYTES || 26214400);
export function uploadError(item: UploadItem): string {
  if (!item.file.size || !/\.(mp3|m4a)$/iu.test(item.file.name)) return 'Choose a nonempty MP3 or M4A file.';
  if (item.file.size > audioLimit) return `Audio must be at most ${Math.round(audioLimit / 1048576)} MB.`;
  if (!item.title.trim() || item.title.trim().length > 200) return 'Enter a song title of 1–200 characters.';
  if (!item.artistId) return 'Choose an artist.';
  if (item.category.trim().length > 100) return 'Category must be at most 100 characters.';
  if (item.cover && (!item.cover.size || !/\.(jpe?g|png|webp)$/iu.test(item.cover.name) || item.cover.size > Number(import.meta.env.VITE_IMAGE_MAX_BYTES || 5242880))) return 'Choose a JPEG, PNG or WebP artwork within the image size limit.';
  return '';
}

// Unknown save outcomes must never be retried with freshly uploaded audio.
export async function uploadItem(item: UploadItem, signal: AbortSignal, update: (patch: Partial<UploadItem>) => void): Promise<void> {
  const invalid = uploadError(item);
  if (invalid) { update({ status: 'failed', error: invalid }); return; }
  const assets: string[] = [];
  let saving = false;
  const timeout = Number(import.meta.env.VITE_MEDIA_UPLOAD_TIMEOUT_SECONDS || 120) * 1000;
  try {
    signal.throwIfAborted();
    update({ status: 'audio', progress: 0, error: undefined });
    const body = new FormData(); body.append('file', item.file);
    const { data: audio } = await api.post<MediaAsset>('/media/audio', body, { signal, timeout, onUploadProgress: e => update({ progress: Math.round((e.progress || 0) * 100) }) });
    assets.push(audio.id);
    if (audio.status !== 'READY') throw new Error('Audio is not ready.');
    let coverAssetId: string | null = null;
    signal.throwIfAborted();
    if (item.cover) {
      update({ status: 'artwork' });
      const image = new FormData(); image.append('folder', 'songs'); image.append('file', item.cover);
      const { data: cover } = await api.post<MediaAsset>('/media/images', image, { signal, timeout });
      assets.push(cover.id); coverAssetId = cover.id;
      if (cover.status !== 'READY') throw new Error('Artwork is not ready.');
    }
    signal.throwIfAborted();
    saving = true;
    update({ status: 'saving' });
    // Do not abort a database write: cancellation stops subsequent queue entries.
    const { data: song } = await api.post<Song>('/songs', { title: item.title.trim(), artistId: item.artistId, albumId: item.albumId || null, category: item.category.trim() || null, audioAssetId: audio.id, coverAssetId });
    update({ status: 'completed', progress: 100, songId: song.id });
  } catch (error) {
    const definitive = axios.isAxiosError(error) && !!error.response && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 408;
    if (saving && !definitive) {
      update({ status: 'unknown', error: 'The save result could not be confirmed. Check the library before uploading this file again. Its media remains tracked by the server.' });
      return;
    }
    let detail = signal.aborted ? 'Cancelled. Unfinished uploads remain tracked for cleanup.' : message(error);
    for (const id of assets) {
      try { await api.delete(`/media/${id}`); }
      catch { detail += ' An unused upload remains tracked for automatic cleanup.'; }
    }
    update({ status: signal.aborted ? 'cancelled' : 'failed', error: detail });
  }
}

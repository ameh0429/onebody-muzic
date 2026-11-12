import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play, RotateCw, X } from 'lucide-react';
import { api, message, playbackUrl } from '../../lib/api';
import type { Song } from '../../lib/types';

interface Player {
  song: Song | null; busy: boolean; error: string;
  prepare: (song: Song, play?: boolean, position?: number) => Promise<void>;
  stop: () => void; refresh: () => void;
}
const Context = createContext<Player | null>(null);
export function usePlayer() { const value = useContext(Context); if (!value) throw new Error('Player provider missing'); return value; }

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null); const request = useRef<AbortController | null>(null);
  const generation = useRef(0); const current = useRef<Song | null>(null); const expires = useRef(0);
  const position = useRef(0); const pendingPosition = useRef(0); const retried = useRef(false);
  const [song, setSong] = useState<Song | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [playing, setPlaying] = useState(false); const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  function stop() {
    generation.current++; request.current?.abort(); current.current = null; expires.current = 0;
    const element = audio.current; if (element) { element.pause(); element.removeAttribute('src'); element.load(); }
    position.current = 0; pendingPosition.current = 0; retried.current = false;
    setSong(null); setBusy(false); setPlaying(false); setTime(0); setLength(0); setError('');
  }
  useEffect(() => {
    const element = audio.current;
    return () => { generation.current++; request.current?.abort(); if (element) { element.pause(); element.removeAttribute('src'); element.load(); } };
  }, []);
  async function prepare(next: Song, play = false, resume = 0) {
    const version = ++generation.current; request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const changing = current.current?.id !== next.id;
    current.current = next; setSong(next); setBusy(true); setError('');
    if (changing) { const element = audio.current; if (element) { element.pause(); element.removeAttribute('src'); element.load(); } position.current = 0; expires.current = 0; setTime(0); retried.current = false; setLength(0); }
    try {
      const { data } = await api.get<{ url: string; expiresAt?: string; expiresIn?: number }>(`/songs/${next.id}/stream?redirect=false`, { signal: controller.signal });
      if (version !== generation.current) return;
      const element = audio.current; if (!element) return;
      const url = playbackUrl(data.url);
      expires.current = data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + (data.expiresIn || 60) * 1000;
      position.current = resume; pendingPosition.current = resume; setTime(resume);
      element.src = url; element.load();
      if (play) {
        try { await element.play(); }
        catch { if (version === generation.current) setError('Press Play to continue playback.'); }
      }
    } catch (err: unknown) { if (version === generation.current && !controller.signal.aborted) setError(message(err)); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function toggle() {
    const element = audio.current; const track = current.current; if (!element || !track) return;
    if (!element.paused) { element.pause(); return; }
    if (Date.now() >= expires.current) { retried.current = false; await prepare(track, true, element.ended ? 0 : Number.isFinite(element.currentTime) ? element.currentTime : position.current); return; }
    try { await element.play(); setError(''); } catch { setError('Press Play again, or refresh playback access.'); }
  }
  function seek(value: number) {
    const track = current.current; if (!track) return;
    if (Date.now() >= expires.current) { retried.current = false; void prepare(track, playing, value); }
    else if (audio.current) { pendingPosition.current = audio.current.readyState === 0 ? value : 0; audio.current.currentTime = value; position.current = value; setTime(value); }
  }
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = song && typeof MediaMetadata !== 'undefined' ? new MediaMetadata({ title: song.title, artist: song.artist.name, album: song.album?.title || '', artwork: song.coverImageUrl ? [{ src: song.coverImageUrl }] : [] }) : null;
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { if (audio.current?.paused) void toggle(); }, pause: () => audio.current?.pause(), stop,
      seekto: (details) => { if (details.seekTime !== undefined) seek(details.seekTime); },
      seekbackward: (details) => seek(Math.max(0, position.current - (details.seekOffset || 10))),
      seekforward: (details) => seek(Math.min(length || position.current + 10, position.current + (details.seekOffset || 10))),
    };
    for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler!); } catch { /* Some browsers support only a subset. */ } }
    navigator.mediaSession.playbackState = song ? playing ? 'playing' : 'paused' : 'none';
    return () => {
      for (const action of Object.keys(handlers)) { try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null); } catch { /* Unsupported action. */ } }
      navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none';
    };
  }, [song, playing, length]);
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try { if (length > 0) navigator.mediaSession.setPositionState({ duration: length, playbackRate: 1, position: Math.min(time, length) }); else navigator.mediaSession.setPositionState(); } catch { /* Browser may not support position state. */ }
  }, [time, length]);
  useEffect(() => {
    document.body.classList.toggle('has-player', !!song);
    return () => document.body.classList.remove('has-player');
  }, [song]);
  return <Context.Provider value={{ song, busy, error, prepare, stop, refresh: () => { const track = current.current; if (track) { retried.current = false; void prepare(track, !audio.current?.paused, audio.current && Number.isFinite(audio.current.currentTime) ? audio.current.currentTime : position.current); } } }}>{children}
    <section className="mini-player" aria-label="Now playing" hidden={!song}>
      {song && <><div className="player-title"><Link to={`/songs/${song.id}`}><strong>{song.title}</strong><span>{song.artist.name}</span></Link></div>
        <button className="icon-btn" aria-label={playing ? 'Pause audio' : 'Play audio'} disabled={busy} onClick={() => void toggle()}>{playing ? <Pause size={20}/> : <Play size={20}/>}</button>
        <button className="icon-btn" aria-label="Refresh playback access" disabled={busy} onClick={() => { retried.current = false; void prepare(song, playing, audio.current && Number.isFinite(audio.current.currentTime) ? audio.current.currentTime : position.current); }}><RotateCw size={18}/></button>
        <button className="icon-btn" aria-label="Close player" onClick={stop}><X size={20}/></button></>}
      <audio ref={audio} crossOrigin="anonymous" controls preload="none" className="player-native" aria-label="Audio player"
        onLoadedMetadata={() => { const element = audio.current; if (!element) return; if (Number.isFinite(element.duration)) setLength(element.duration); if (pendingPosition.current > 0) { element.currentTime = Math.min(pendingPosition.current, Number.isFinite(element.duration) ? element.duration : pendingPosition.current); pendingPosition.current = 0; } }}
        onTimeUpdate={() => { const value = audio.current?.currentTime || 0; position.current = value; setTime(value); }}
        onPlay={() => { const track = current.current; if (track && Date.now() >= expires.current && !retried.current) { retried.current = true; void prepare(track, true, position.current); } }}
        onPlaying={() => { setPlaying(true); setError(''); retried.current = false; }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onError={() => { const track = current.current; if (!track || !audio.current?.getAttribute('src')) return; if (!retried.current && navigator.onLine && Date.now() >= expires.current) { retried.current = true; void prepare(track, playing, position.current); } else setError('Audio could not be played. Refresh playback access and try again.'); }}/>
      {song && busy && <p role="status">Preparing audio…</p>}{song && error && <p className="player-error" role="alert">{error}</p>}
    </section>
  </Context.Provider>;
}

import type { ArtistCredit } from '../lib/types';
import { RemoteSelect } from './RemoteSelect';

export function FeaturedArtistPicker({ mainArtistId, value, onChange }: { mainArtistId: string; value: ArtistCredit[]; onChange: (value: ArtistCredit[]) => void }) {
  function move(index: number, delta: number) {
    const next = [...value]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next);
  }
  return <div className="form-stack"><RemoteSelect label="Add featured artist" resource="artists" optional value="" excludeIds={[mainArtistId, ...value.map(artist => artist.id)]} onChange={(id, name) => {
    if (id && id !== mainArtistId && !value.some(artist => artist.id === id) && value.length < 20) onChange([...value, { id, name: name || 'Artist' }]);
  }}/><p className="subtle text-xs">Optional. Choose up to 20 artists in the order their names should appear. The main artist is credited separately.</p>
  {value.length > 0 && <ol aria-label="Featured artists" className="form-stack">{value.map((artist, index) => <li key={artist.id} className="flex items-center gap-2 flex-wrap"><span className="flex-1">{index + 1}. {artist.name}</span><button type="button" className="quiet" disabled={index === 0} aria-label={`Move ${artist.name} up`} onClick={() => move(index, -1)}>↑</button><button type="button" className="quiet" disabled={index === value.length - 1} aria-label={`Move ${artist.name} down`} onClick={() => move(index, 1)}>↓</button><button type="button" className="quiet" onClick={() => onChange(value.filter(item => item.id !== artist.id))} aria-label={`Remove ${artist.name}`}>Remove</button></li>)}</ol>}</div>;
}

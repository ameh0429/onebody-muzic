import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { ArtistCredit } from '../lib/types';

export function creditText(main: string, featured: ArtistCredit[] = []): string {
  return main + (featured.length ? ` feat. ${featured.map(artist => artist.name).join(' & ')}` : '');
}
export function SongCredits({ main, featured = [] }: { main: ArtistCredit; featured?: ArtistCredit[] }) {
  return <div className="text-accent"><Link to={`/artists/${main.id}`}>{main.name}</Link>{featured.length > 0 && <> feat. {featured.map((artist, index) => <Fragment key={artist.id}>{index > 0 && ' & '}<Link to={`/artists/${artist.id}`}>{artist.name}</Link></Fragment>)}</>}</div>;
}

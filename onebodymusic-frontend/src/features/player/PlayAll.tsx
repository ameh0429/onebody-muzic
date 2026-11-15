import { Play } from 'lucide-react';
import { usePlayer } from './PlayerProvider';

export function PlayAll({ songIds }: { songIds: string[] }) {
  const player = usePlayer();
  return <button className="btn mb-5" disabled={!songIds.length || player.busy} onClick={() => player.playQueue(songIds)}><Play size={18}/>Play all</button>;
}

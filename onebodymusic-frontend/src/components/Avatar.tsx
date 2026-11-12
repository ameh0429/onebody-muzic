import { useEffect, useState } from 'react';
export function Avatar({ name, url, className = 'avatar' }: { name: string; url?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className={className}>{url && !failed ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : name.slice(0, 1).toUpperCase()}</span>;
}

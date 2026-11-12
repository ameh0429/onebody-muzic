import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Music2, RefreshCw } from 'lucide-react';
import { message } from '../lib/api';
import type { ReactNode } from 'react';
export function Heading({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children?: ReactNode; action?: ReactNode }) { return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <p className="subtle mt-2">{children}</p>}</div>{action}</div>; }
export function Busy() { return <div className="state" role="status"><RefreshCw className="animate-spin"/><p>Finding your music…</p></div>; }
export function Failure({ error, retry }: { error: unknown; retry?: () => void }) { return <div className="state" role="alert"><AlertCircle/><p>{message(error)}</p>{retry && <button className="btn secondary" onClick={retry}>Try again</button>}</div>; }
export function Empty({ title = 'A little quiet here', children }: { title?: string; children?: ReactNode }) { return <div className="state"><Music2/><h2>{title}</h2><p className="subtle">{children || 'Music added by your church will appear here.'}</p></div>; }
export function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (value: number) => void }) { return totalPages > 1 && <nav className="pagination" aria-label="Pagination"><button className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft/></button><span>Page {page} of {totalPages}</span><button className="icon-btn" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight/></button></nav>; }
export function Cover({ src, index = 0, small = false }: { src?: string | null; index?: number; small?: boolean }) { return <div className={`cover shade-${index % 4} ${small ? 'small' : ''}`}>{src ? <img src={src} loading="lazy" decoding="async" alt="" referrerPolicy="no-referrer"/> : <Music2 aria-hidden="true"/>}</div>; }
export function Back({ to, children }: { to: string; children: ReactNode }) { return <Link className="back" to={to}><ArrowLeft size={18}/>{children}</Link>; }
export function duration(seconds: number | null | undefined) { return seconds == null ? '—' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
export function date(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

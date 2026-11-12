export type Role = 'ADMIN' | 'MEMBER';
export interface User { profileImageUrl?: string | null; id: string; name: string; email: string; role: Role; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' }
export interface Page<T> { data: T[]; page: number; limit: number; total: number; totalPages: number }
export interface Artist { id: string; name: string; biography: string | null; imageUrl: string | null; albumCount: number; songCount: number }
export interface Song { id: string; title: string; artistId: string; artist: { id: string; name: string }; albumId: string | null; album: { id: string; title: string } | null; category: string | null; durationSeconds: number | null; coverImageUrl: string | null; hasAudioAsset: boolean; lyrics?: string | null }
export interface Album { id: string; title: string; artistId: string; artist: { id: string; name: string }; releaseYear: number; coverImageUrl: string | null; songCount: number; songs?: Pick<Song, 'id' | 'title' | 'durationSeconds' | 'coverImageUrl'>[] }
export interface Playlist { id: string; title: string; description: string | null; type: 'PERSONAL' | 'REHEARSAL'; publicationStatus: 'DRAFT' | 'PUBLISHED'; createdById: string; songCount: number; songs?: { songId: string; position: number; song: { id: string; title: string; artistName: string } }[] }
export interface Rehearsal { id: string; title: string; description: string | null; scheduledAt: string; playlistId: string; playlist: Playlist }
export interface MediaAsset { id: string; status: string }

import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { Busy, Empty } from '../components/ui';
import Shell from './Shell';
import { PlayerProvider } from '../features/player/PlayerProvider';
const AuthPage = lazy(() => import('../features/auth/AuthPage'));
const Dashboard = lazy(() => import('../features/dashboard/Dashboard'));
const Library = lazy(() => import('../features/library/Library'));
const Details = lazy(() => import('../features/library/Details'));
const Playlists = lazy(() => import('../features/playlists/Playlists'));
const PlaylistDetail = lazy(() => import('../features/playlists/Playlists').then((m) => ({ default: m.PlaylistDetail })));
const Rehearsals = lazy(() => import('../features/rehearsals/Rehearsals'));
const RehearsalDetail = lazy(() => import('../features/rehearsals/Rehearsals').then((m) => ({ default: m.RehearsalDetail })));
const Profile = lazy(() => import('../features/profile/Profile'));
const Admin = lazy(() => import('../features/admin/Admin'));
const Upload = lazy(() => import('../features/admin/Upload'));
function Protected({ admin = false }: { admin?: boolean }) { const { user } = useAuth(); if (!user) return <Navigate to="/login" replace/>; if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace/>; return <Outlet/>; }
export default function App() { const { user } = useAuth(); return <BrowserRouter><PlayerProvider key={user?.id || 'signed-out'}><Suspense fallback={<Busy/>}><Routes><Route path="/login" element={<AuthPage key="login"/>}/><Route path="/register" element={<AuthPage key="register" register/>}/><Route element={<Protected/>}><Route element={<Shell/>}><Route index element={<Dashboard/>}/><Route path="songs" element={<Library/>}/><Route path="songs/:id" element={<Details/>}/><Route path="artists" element={<Library kind="artists"/>}/><Route path="artists/:id" element={<Details kind="artists"/>}/><Route path="albums" element={<Library kind="albums"/>}/><Route path="albums/:id" element={<Details kind="albums"/>}/><Route path="playlists" element={<Playlists/>}/><Route path="playlists/:id" element={<PlaylistDetail/>}/><Route path="rehearsals" element={<Rehearsals/>}/><Route path="rehearsals/:id" element={<RehearsalDetail/>}/><Route path="profile" element={<Profile/>}/><Route element={<Protected admin/>}><Route path="admin" element={<Admin/>}/><Route path="admin/upload" element={<Upload/>}/></Route><Route path="*" element={<Empty title="This page couldn’t be found">Use the navigation to find your way back.</Empty>}/></Route></Route></Routes></Suspense></PlayerProvider></BrowserRouter>; }

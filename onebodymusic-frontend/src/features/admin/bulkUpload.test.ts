import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { api } from '../../lib/api';
import { uploadError, uploadItem, type UploadItem } from './bulkUpload';
vi.mock('../../lib/api', () => ({ api: { post: vi.fn(), delete: vi.fn() }, message: () => 'Request failed' }));
function item(): UploadItem { return { id: 'row', file: new File(['audio'], 'worship.mp3'), title: 'Worship', artistId: 'artist', albumId: '', category: '', status: 'queued', progress: 0 }; }
const ready = { data: { id: 'audio', status: 'READY' } };
function rejection(status: number) { return new AxiosError('failed', undefined, undefined, undefined, { status, statusText: '', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() }, data: {} }); }
beforeEach(() => vi.resetAllMocks());
describe('bulk song upload lifecycle', () => {
  it('validates files and metadata before sending requests', async () => {
    const row = item(); row.file = new File(['x'], 'bad.wav');
    const update = vi.fn(); await uploadItem(row, new AbortController().signal, update);
    expect(api.post).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(uploadError({ ...item(), title: ' ' })).toContain('title');
    expect(uploadError({ ...item(), artistId: '' })).toContain('artist');
    expect(uploadError({ ...item(), cover: new File(['x'], 'bad.exe') })).toContain('artwork');
  });
  it('uploads audio and artwork before publishing and reports success', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(ready).mockResolvedValueOnce({ data: { id: 'cover', status: 'READY' } }).mockResolvedValueOnce({ data: { id: 'song' } });
    const update = vi.fn();
    await uploadItem({ ...item(), cover: new File(['image'], 'cover.png') }, new AbortController().signal, update);
    expect(vi.mocked(api.post).mock.calls.map(call => call[0])).toEqual(['/media/audio', '/media/images', '/songs']);
    expect(api.post).toHaveBeenLastCalledWith('/songs', expect.objectContaining({ audioAssetId: 'audio', coverAssetId: 'cover', albumId: null }));
    expect(update).toHaveBeenLastCalledWith({ status: 'completed', progress: 100, songId: 'song' });
    expect(api.delete).not.toHaveBeenCalled();
  });
  it('cleans uploaded assets when publishing is rejected and can retry', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(ready).mockRejectedValueOnce(rejection(400));
    const update = vi.fn(); await uploadItem(item(), new AbortController().signal, update);
    expect(api.delete).toHaveBeenCalledWith('/media/audio');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
    vi.mocked(api.post).mockResolvedValueOnce(ready).mockResolvedValueOnce({ data: { id: 'song' } });
    await uploadItem(item(), new AbortController().signal, update);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' }));
  });
  it.each([new AxiosError('timeout', 'ECONNABORTED'), rejection(500)])('retains media and blocks retry after an uncertain save: %s', async error => {
    vi.mocked(api.post).mockResolvedValueOnce(ready).mockRejectedValueOnce(error);
    const update = vi.fn(); await uploadItem(item(), new AbortController().signal, update);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unknown' }));
    expect(api.delete).not.toHaveBeenCalled();
  });
  it('cleans up when cancelled after uploading audio, without publishing', async () => {
    const controller = new AbortController();
    vi.mocked(api.post).mockImplementationOnce(async () => { controller.abort(); return ready; });
    const update = vi.fn(); await uploadItem(item(), controller.signal, update);
    expect(api.post).toHaveBeenCalledTimes(1); expect(api.delete).toHaveBeenCalledWith('/media/audio');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });
  it('finishes an in-flight save when cancelled instead of deleting attached media', async () => {
    const controller = new AbortController();
    vi.mocked(api.post).mockResolvedValueOnce(ready).mockImplementationOnce(async () => { controller.abort(); return { data: { id: 'song' } }; });
    const update = vi.fn(); await uploadItem(item(), controller.signal, update);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' })); expect(api.delete).not.toHaveBeenCalled();
  });
});

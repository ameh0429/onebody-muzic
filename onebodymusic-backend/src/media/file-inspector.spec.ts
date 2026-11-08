import { ConfigService } from '@nestjs/config';
import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { FileInspector } from './file-inspector';
import { EnvironmentVariables } from '../config/environment';
import { MediaKind } from '../database/models';
import { JPEG, m4a, mp3, PNG, uploaded, WEBP } from '../../test/fixtures/media';

const inspector = new FileInspector(new ConfigService<EnvironmentVariables, true>({ MEDIA_AUDIO_MAX_BYTES: 4096, MEDIA_IMAGE_MAX_BYTES: 1024 }));
describe('media content validation', () => {
  it.each([[PNG, 'cover.png', 'image/png', 'png'], [JPEG, 'cover.jpeg', 'image/jpeg', 'jpg'], [WEBP, 'cover.webp', 'image/webp', 'webp']] as const)('recognizes supported image signatures %s', async (buffer, name, mime, format) => {
    expect(await inspector.inspect(uploaded(buffer, name, mime), MediaKind.IMAGE)).toMatchObject({ format });
  });
  it('recognizes MP3 frames and audio-only M4A containers', async () => {
    expect(await inspector.inspect(uploaded(mp3(), 'song.mp3', 'audio/mpeg'), MediaKind.AUDIO)).toMatchObject({ format: 'mp3' });
    expect(await inspector.inspect(uploaded(m4a(), 'song.m4a', 'audio/mp4'), MediaKind.AUDIO)).toMatchObject({ format: 'm4a' });
  });
  it.each([undefined, uploaded(Buffer.alloc(0))])('rejects missing/empty files', async (file) => { await expect(inspector.inspect(file, MediaKind.IMAGE)).rejects.toBeInstanceOf(BadRequestException); });
  it.each(['../cover.png', 'folder/cover.png', 'folder\\cover.png', '.cover.png', 'cover\u0000.png', 'bad..name.png'])('rejects unsafe filenames %s', async (name) => {
    await expect(inspector.inspect(uploaded(PNG, name), MediaKind.IMAGE)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects mismatched signatures, MIME types, and extensions', async () => {
    for (const file of [uploaded(Buffer.from('<script>bad</script>')), uploaded(PNG, 'cover.jpg', 'image/jpeg'), uploaded(PNG, 'cover.png', 'application/octet-stream')]) await expect(inspector.inspect(file, MediaKind.IMAGE)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });
  it('rejects image bytes on the audio endpoint and video tracks disguised as M4A', async () => {
    await expect(inspector.inspect(uploaded(PNG, 'song.mp3', 'audio/mpeg'), MediaKind.AUDIO)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(inspector.inspect(uploaded(m4a('vide'), 'song.m4a', 'audio/mp4'), MediaKind.AUDIO)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });
  it('rejects ID3-only or truncated MP3 files without two complete audio frames', async () => {
    await expect(inspector.inspect(uploaded(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00'), 'song.mp3', 'audio/mpeg'), MediaKind.AUDIO)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(inspector.inspect(uploaded(mp3().subarray(0, 450), 'song.mp3', 'audio/mpeg'), MediaKind.AUDIO)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });
  it('enforces configured byte limits and buffer sizes', async () => {
    await expect(inspector.inspect(uploaded(Buffer.alloc(1025)), MediaKind.IMAGE)).rejects.toBeInstanceOf(PayloadTooLargeException);
    const file = uploaded(PNG); file.size++;
    await expect(inspector.inspect(file, MediaKind.IMAGE)).rejects.toBeInstanceOf(BadRequestException);
  });
});

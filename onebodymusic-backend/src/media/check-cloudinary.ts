import 'reflect-metadata';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { EnvironmentVariables, validateEnvironment } from '../config/environment';
import { createDatabase } from '../database/connection';
import { MediaAsset, MediaStatus, Song } from '../database/models';
import { CloudinaryClient } from './cloudinary.client';
import { CloudinaryAudioGateway } from './cloudinary-audio.gateway';
import { CloudinaryOperationError, MediaOperationException } from './errors/media-operation.error';
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--song' || !isUUID(args[1]))) throw new Error('Invalid arguments');
  const config = validateEnvironment(process.env);
  const settings = new ConfigService<EnvironmentVariables, true>(config); const client = new CloudinaryClient(settings);
  await client.checkConnection();
  console.log('Cloudinary connection and authentication succeeded. This ping does not verify audio upload limits or authenticated playback.');
  if (!args.length) return;
  const database = createDatabase(config.DATABASE_URL);
  try {
    const song = await Song.findByPk(args[1], { attributes: ['id', 'audioAssetId'] });
    if (!song?.audioAssetId) throw new Error('No tracked song audio');
    const asset = await MediaAsset.findByPk(song.audioAssetId);
    if (!asset || asset.status !== MediaStatus.READY || asset.kind !== 'AUDIO') throw new Error('Audio not ready');
    const gateway = new CloudinaryAudioGateway(client, settings);
    // Bound DNS/connect as well as socket idle time. Never print signed URLs or credentials.
    let failures = 0;
    for (const [label, range, head] of [['HEAD', undefined, true], ['one-byte range', 'bytes=0-0', false]] as const) {
      try {
        const result = await gateway.open(asset, range, head, AbortSignal.timeout(15000));
        result.stream.destroy();
        console.log(`Authenticated audio ${label} succeeded: HTTP ${result.status}.`);
      } catch {
        failures++;
        console.error(`Authenticated audio ${label} failed. Check the safe delivery code above (or network/connect timeout).`);
      }
    }
    if (failures) process.exitCode = 1;
  } finally { await database.close(); }
}
void main().catch((error: unknown) => {
  if (error instanceof CloudinaryOperationError) console.error(`Cloudinary check failed (${error.failure}): ${error.failure === 'REJECTED' ? 'Cloudinary rejected the connection check. Verify the cloud name, account configuration and Admin API permissions.' : new MediaOperationException(error.failure).message}`);
  else console.error('Media check failed. For --song use a valid existing song UUID with READY tracked audio. Check the safe Audio delivery failed log for provider status or network/range failure. No files were changed.');
  process.exitCode = 1;
});

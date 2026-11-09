import 'reflect-metadata';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../config/environment';
import { CloudinaryClient } from './cloudinary.client';
import { CloudinaryOperationError, MediaOperationException } from './errors/media-operation.error';
async function main(): Promise<void> {
  const config = validateEnvironment(process.env);
  await new CloudinaryClient(new ConfigService(config)).checkConnection();
  console.log('Cloudinary connection and authentication succeeded. This ping does not verify audio upload limits or authenticated playback.');
}
void main().catch((error: unknown) => {
  if (error instanceof CloudinaryOperationError) console.error(`Cloudinary check failed (${error.failure}): ${error.failure === 'REJECTED' ? 'Cloudinary rejected the connection check. Verify the cloud name, account configuration and Admin API permissions.' : new MediaOperationException(error.failure).message}`);
  else console.error('Cloudinary check could not run. Check required environment settings and MEDIA_ENABLED=true.');
  process.exitCode = 1;
});

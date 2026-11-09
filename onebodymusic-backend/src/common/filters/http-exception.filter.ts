import { MediaOperationException } from '../../media/errors/media-operation.error';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DatabaseError } from 'sequelize';
import { STATUS_CODES } from 'node:http';
import { Request, Response } from 'express';
import { ApiErrorDto } from '../dto/api-error.dto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const parent = exception instanceof DatabaseError ? exception.parent as Error & { code?: string; constraint?: string } : undefined;
    const mediaConflict = parent?.code === '23514' && parent.constraint === 'media_reference_ready';
    const status = mediaConflict ? HttpStatus.CONFLICT : exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = mediaConflict ? 'Media reference is unavailable, incompatible, or still in use' : 'Internal server error';
    if (exception instanceof HttpException && (status < 500 || exception instanceof MediaOperationException)) {
      const body: unknown = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (typeof body === 'object' && body !== null && 'message' in body) {
        const detail: unknown = body.message;
        if (typeof detail === 'string') message = detail;
        else if (Array.isArray(detail) && detail.every((item: unknown) => typeof item === 'string')) message = detail as string[];
      }
    }
    if (status >= 500) this.logger.error(`Unhandled server error (${status})`);
    const body: ApiErrorDto = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
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
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    if (exception instanceof HttpException && status < 500) {
      const body: unknown = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (typeof body === 'object' && body !== null && 'message' in body) {
        const detail: unknown = body.message;
        if (typeof detail === 'string') message = detail;
        else if (Array.isArray(detail) && detail.every((item: unknown) => typeof item === 'string')) message = detail as string[];
      }
    }
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : 'Unknown server error');
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

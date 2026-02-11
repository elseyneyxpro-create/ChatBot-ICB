/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
// import { catchError, delay, firstValueFrom, retry, throwError } from 'rxjs';
import { catchError, firstValueFrom, retry, throwError, timer } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import type { AxiosError } from 'axios';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly maxRetries: number;

  constructor(
    private readonly http: HttpService,
    private readonly cfg: ConfigService,
  ) {
    this.maxRetries = Number(this.cfg.get('PYTHON_MAX_RETRIES') ?? 0);
  }

  async askPython(body: Record<string, any>) {
    // Pequeña “sanitización”/defaults
    const payload = { session_id: 'demo', ...body };

    const obs$ = this.http.post('/ai/answer', payload).pipe(
      retry({
        count: this.maxRetries,
        delay: (_err, retryCount) => timer(250 * retryCount), // backoff lineal
      }),
      catchError((err: AxiosError<any>) => {
        const status = err.response?.status;
        const data = err.response?.data;
        this.logger.error(
          `Python error ${status ?? ''}: ${JSON.stringify(data ?? err.message)}`,
        );
        return throwError(
          () =>
            new InternalServerErrorException({
              status: 'error',
              source: 'python-service',
              message: data ?? err.message ?? 'Error proxying to Python',
            }),
        );
      }),
    );

    const { data } = await firstValueFrom(obs$);
    return data;
  }
}

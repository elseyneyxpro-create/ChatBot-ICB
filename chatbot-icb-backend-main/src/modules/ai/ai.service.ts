/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
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
    this.logger.log(`PYTHON_BASE_URL = ${this.cfg.get('PYTHON_BASE_URL')}`);
  }

  private async proxyPost(path: string, body: Record<string, any>) {
    const obs$ = this.http.post(path, body).pipe(
      retry({
        count: this.maxRetries,
        delay: (_err, retryCount) => timer(250 * retryCount),
      }),
      catchError((err: AxiosError<any>) => {
        const status = err.response?.status;
        const data = err.response?.data;
        this.logger.error(`Python error ${status ?? ''}: ${JSON.stringify(data ?? err.message)}`);
        return throwError(
          () => new InternalServerErrorException({
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

  private async proxyGet(path: string) {
    const obs$ = this.http.get(path).pipe(
      catchError((err: AxiosError<any>) => {
        const status = err.response?.status;
        const data = err.response?.data;
        this.logger.error(`Python error ${status ?? ''}: ${JSON.stringify(data ?? err.message)}`);
        return throwError(
          () => new InternalServerErrorException({
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

  async askPython(body: Record<string, any>) {
    return this.proxyPost('/ai/answer', { session_id: 'demo', ...body });
  }

  async getVideos() {
    return this.proxyGet('/ai/videos');
  }

  async evaluateConcepto(body: Record<string, any>) {
    return this.proxyPost('/ai/evaluate-concepto', body);
  }

  async evaluateVof(body: Record<string, any>) {
    return this.proxyPost('/ai/evaluate-vof', body);
  }

  async evaluateError(body: Record<string, any>) {
    return this.proxyPost('/ai/evaluate-error', body);
  }

  async saveExerciseResult(body: Record<string, any>) {
    return this.proxyPost('/ai/save-exercise-result', body);
  }
}

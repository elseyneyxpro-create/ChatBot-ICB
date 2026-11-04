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

  /** GET genérico al servicio Python con query params (lo usan los reportes). */
  get(path: string, params?: Record<string, string | undefined>) {
    return this.proxyGet(this.conParams(path, params));
  }

  /** GET de un archivo (Excel) al servicio Python: devuelve los bytes y sus encabezados. */
  async getArchivo(path: string, params?: Record<string, string | undefined>) {
    const obs$ = this.http.get<ArrayBuffer>(this.conParams(path, params), {
      responseType: 'arraybuffer',
      timeout: Number(this.cfg.get('PYTHON_REPORT_TIMEOUT_MS') ?? 60000),
    }).pipe(
      catchError((err: AxiosError<any>) => {
        this.logger.error(`Python error ${err.response?.status ?? ''} al descargar ${path}: ${err.message}`);
        return throwError(() => new InternalServerErrorException({
          status: 'error', source: 'python-service', message: 'No se pudo generar el archivo.',
        }));
      }),
    );
    const res = await firstValueFrom(obs$);
    return {
      data: Buffer.from(res.data),
      contentType: String(res.headers['content-type'] ?? 'application/octet-stream'),
      disposition: res.headers['content-disposition'] ? String(res.headers['content-disposition']) : undefined,
    };
  }

  private conParams(path: string, params?: Record<string, string | undefined>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') qs.set(k, v);
    const s = qs.toString();
    return s ? `${path}?${s}` : path;
  }

  /** POST genérico al servicio Python (lo usa la nivelación). */
  post(path: string, body: Record<string, any>) {
    return this.proxyPost(path, body);
  }

  async askPython(body: Record<string, any>) {
    return this.proxyPost('/ai/answer', body);
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

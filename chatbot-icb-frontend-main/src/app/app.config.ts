import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideMarkdown, MARKED_OPTIONS } from 'ngx-markdown';
import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimations(),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptorsFromDi()),
    provideMarkdown(),

    {
      provide: MARKED_OPTIONS,
      useFactory: () => {
        marked.use(markedKatex({ throwOnError: false }));
        return { gfm: true, breaks: false };

      },
    },
  ],
};


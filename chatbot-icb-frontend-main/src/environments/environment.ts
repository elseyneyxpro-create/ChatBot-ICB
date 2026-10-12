export const environment = {
  production: true,

  /**
   * Solo para develop. Ponlo en false para producción:
   *  - selectorModulos: después del login muestra la pantalla para elegir Chatbot o Nivelación,
   *    y agrega el acceso a la Nivelación en el menú del chatbot (y a /inicio desde la nivelación).
   */
  dev: {
    selectorModulos: true,
  },

  /** Base del BFF NestJS (sin versión). Nginx redirige /api/* al backend. */
  API_URL: '/api',

  /** Base del BFF NestJS versionada → /api/v1 */
  AGENTS_URL: '/api/v1',

  auth: {
    /** El backend inicia el OAuth con Google y vuelve a /auth/callback con la cookie seteada */
    loginUrl: '/api/auth/google',
  },

  /** Paths relativos a AGENTS_URL para cada endpoint del backend */
  endpoints: {
    ai: {
      answer:              '/ai/answer',
      videos:              '/ai/videos',
      evaluateConcepto:    '/ai/evaluate-concepto',
      evaluateVof:         '/ai/evaluate-vof',
      evaluateError:       '/ai/evaluate-error',
      saveExerciseResult:  '/ai/save-exercise-result',
    },
    users: {
      me: '/users/me',
    },
  },
};

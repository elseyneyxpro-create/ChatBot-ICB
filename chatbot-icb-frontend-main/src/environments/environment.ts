export const environment = {
  production: true,

  /** Base del BFF NestJS (sin versión) */
  API_URL: '/api',

  /** Base del BFF NestJS versionada → /api/v1 */
  AGENTS_URL: '/api/v1',

  auth: {
    loginUrl: '/api/auth/google',
    exchangeUrl: '/api/auth/exchange',
  },

  supabase: {
    url: 'https://eedzligubmjwgemoxzob.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZHpsaWd1Ym1qd2dlbW94em9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDU1ODEsImV4cCI6MjA4OTEyMTU4MX0.s31XL7AfAKBQx_qyth2NizCXqwvZUxHQpQbHH9ZFtO8',
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

  firebase: {
    apiKey: "AIzaSyB03EfnfWmKIOfLDe5PO9uAHLPbUkR1m4o",
    authDomain: "chat-icb.firebaseapp.com",
    projectId: "chat-icb",
    storageBucket: "chat-icb.firebasestorage.app",
    messagingSenderId: "905837597605",
    appId: "1:905837597605:web:0588c297f6c9d729764e4c",
    measurementId: "G-QHERKVW4LR"
  },
};
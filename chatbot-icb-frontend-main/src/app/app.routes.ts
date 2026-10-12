import { Routes } from '@angular/router';
import { authGuard, chatbotGuard } from './core/auth.guard';
import { AuthCallbackComponent } from './features/auth/login/auth-callback.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'auth/callback', component: AuthCallbackComponent },
  {
    path: 'logout',
    loadComponent: () => import('./features/auth/logout/logout-screen.component').then(m => m.LogoutScreenComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'signup',
    loadComponent: () => import('./features/auth/signup/signup.component').then(m => m.SignUpComponent)
  },
  {
    path: 'app',
    canActivate: [chatbotGuard],
    loadComponent: () => import('./features/shell/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'chat' },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat-page/chat-page.component').then(m => m.ChatPageComponent)
      },
      {
        path: 'perfil',
        loadComponent: () => import('./features/profile/profile-page.component').then(m => m.ProfilePageComponent)
      },
      {
        path: 'library',
        loadComponent: () => import('./features/library/video-library/video-library.component').then(m => m.VideoLibraryComponent)
      },
      {
        path: 'leaderboard',
        loadComponent: () => import('./features/leaderboard/leaderboard-page.component').then(m => m.LeaderboardPageComponent)
      },
    ]
  },
  {
    // Selector Chatbot / Nivelación después del login (develop: environment.dev.selectorModulos)
    path: 'inicio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/inicio/selector-modulo.component').then(m => m.SelectorModuloComponent)
  },
  {
    // Nivelación: abierta a todos los alumnos logueados (antes de habilitar el chatbot)
    path: 'nivelacion',
    canActivate: [authGuard],
    loadComponent: () => import('./features/nivelacion/niv-layout.component').then(m => m.NivLayoutComponent),
    children: [
      { path: '', loadComponent: () => import('./features/nivelacion/niv-mundos.component').then(m => m.NivMundosComponent) },
      { path: 'mundo/:id', loadComponent: () => import('./features/nivelacion/niv-mundo.component').then(m => m.NivMundoComponent) },
      { path: 'mundo/:id/test', data: { modo: 'test' },
        loadComponent: () => import('./features/nivelacion/niv-evaluacion.component').then(m => m.NivEvaluacionComponent) },
      { path: 'nodo/:id/fase', data: { modo: 'fase' },
        loadComponent: () => import('./features/nivelacion/niv-evaluacion.component').then(m => m.NivEvaluacionComponent) },
      { path: 'nodo/:id/entrenar',
        loadComponent: () => import('./features/nivelacion/niv-entrenar.component').then(m => m.NivEntrenarComponent) },
    ]
  },
  { path: '**', redirectTo: 'login' }
];

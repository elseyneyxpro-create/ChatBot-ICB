import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AuthCallbackComponent } from './features/auth/login/auth-callback.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'auth/callback', component: AuthCallbackComponent },
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
    canActivate: [authGuard],
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
  { path: '**', redirectTo: 'login' }
];

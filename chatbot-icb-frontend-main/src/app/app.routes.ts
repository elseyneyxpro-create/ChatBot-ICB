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
    // 👇 RUTA CORREGIDA: Añadimos 'features'
    loadComponent: () => import('./features/shell/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'chat' },
      { 
        path: 'chat',
        loadComponent: () => import('./features/chat/chat-page/chat-page.component').then(m => m.ChatPageComponent)
      },
      {
        path: 'profile',
        loadComponent: () =>
        import('./features/profile/profile.component').then(m => m.ProfileComponent)
      },
      { 
        path: 'library',
        loadComponent: () => import('./features/library/video-library/video-library.component').then(m => m.VideoLibraryComponent)
      },
    ]
  },
  { path: '**', redirectTo: 'login' }
];
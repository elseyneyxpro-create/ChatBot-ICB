import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard'; 

// export const routes: Routes = [
//   { path: '', pathMatch: 'full', redirectTo: 'chat' },
//   {
//     path: 'login',
//     loadComponent: () =>
//       import('./features/auth/login/login.component').then(m => m.LoginComponent)
//   },
//   {
//     path: 'chat',
//     canActivate: [authGuard],
//     loadComponent: () =>
//       import('./features/chat/chat-page/chat-page.component').then(m => m.ChatPageComponent)
//   },
//   { path: '**', redirectTo: 'chat' }
// ];

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },

  { path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent)
  },

  { path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'chat' },
      { path: 'chat',
        loadComponent: () => import('./features/chat/chat-page/chat-page.component').then(m => m.ChatPageComponent)
      },
      { path: 'library',
        loadComponent: () => import('./features/library/video-library/video-library.component').then(m => m.VideoLibraryComponent)
      },
    ]
  },

  { path: '**', redirectTo: 'login' }
];
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { authState } from '@angular/fire/auth';
import { take } from 'rxjs';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `<p style="padding:16px">Finalizando inicio de sesión...</p>`,
})
export class AuthCallbackComponent implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);

  ngOnInit() {
    authState(this.auth).pipe(take(1)).subscribe(user => {
      if (user) {
        this.router.navigateByUrl('/app');
      } else {
        this.router.navigateByUrl('/login?error=auth_failed');
      }
    });
  }
}

import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private auth        = inject(Auth);
  private authService = inject(AuthService);

  ngOnInit() {
    // Restaura el estado del usuario si Firebase ya tiene sesión activa
    // (por ejemplo, al recargar la página con custom token todavía válido)
    user(this.auth).subscribe(firebaseUser => {
      this.authService.restoreSession(firebaseUser);
    });
  }
}

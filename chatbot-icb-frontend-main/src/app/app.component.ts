import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private authService = inject(AuthService);
  // Se crea al inicio para aplicar el modo claro/oscuro guardado
  private theme = inject(ThemeService);

  ngOnInit() {
    // Restaura el estado del usuario si la cookie de sesión del backend sigue válida
    this.authService.restoreSession();
  }
}

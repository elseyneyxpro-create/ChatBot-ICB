import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service'; // Asegúrate de que AuthService está importado

import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatIconModule, MatButtonModule, MatListModule, MatDividerModule
  ],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
})
export class ShellComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  // 👇 CAMBIO CLAVE: Llamamos al nuevo método signOut() en lugar de logout()
  signOut() { 
    this.auth.signOut(); 
  }
}
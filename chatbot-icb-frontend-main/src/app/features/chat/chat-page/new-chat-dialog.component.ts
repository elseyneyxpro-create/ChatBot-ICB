import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

@Component({
  selector: 'app-new-chat-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatInputModule, MatFormFieldModule],
  template: `
    <h2 mat-dialog-title>Nuevo chat</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>Nombre del chat</mat-label>
        <input matInput [(ngModel)]="nombre" placeholder="Ej: Dudas derivadas" (keydown.enter)="confirm()" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" [disabled]="!nombre.trim()" (click)="confirm()">Crear</button>
    </mat-dialog-actions>
  `,
})
export class NewChatDialogComponent {
  private dialogRef = inject(MatDialogRef<NewChatDialogComponent>);
  nombre = '';

  confirm() {
    if (this.nombre.trim()) {
      this.dialogRef.close(this.nombre.trim());
    }
  }
}

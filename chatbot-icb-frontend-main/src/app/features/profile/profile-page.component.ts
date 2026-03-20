import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FirestoreService, ProfileSnapshot } from '../../core/firestore.service';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatSelectModule, MatFormFieldModule],
  templateUrl: './profile-page.component.html',
  styleUrls: ['./profile-page.component.scss'],
})
export class ProfilePageComponent implements OnInit {
  private fs = inject(FirestoreService);
  private router = inject(Router);

  loading = signal(true);
  snapshots = signal<ProfileSnapshot[]>([]);
  selectedTema = signal<string>('');

  temas = computed(() => {
    return [...new Set(this.snapshots().map(s => s.tema))].sort();
  });

  filteredSnapshots = computed(() => {
    const tema = this.selectedTema();
    const all = this.snapshots();
    return tema ? all.filter(s => s.tema === tema) : all;
  });

  // Most recent snapshot per topic
  latestPerTema = computed(() => {
    const map = new Map<string, ProfileSnapshot>();
    for (const s of this.snapshots()) {
      if (!map.has(s.tema)) map.set(s.tema, s);
    }
    return [...map.values()];
  });

  async ngOnInit() {
    const data = await this.fs.getSnapshots();
    this.snapshots.set(data);
    this.loading.set(false);
  }

  setTema(tema: string) {
    this.selectedTema.set(tema);
  }

  goToChat() {
    this.router.navigate(['/app/chat']);
  }
}

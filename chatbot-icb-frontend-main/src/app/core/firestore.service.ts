import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, addDoc, getDocs, query, where, orderBy,
  doc, updateDoc, setDoc, getDoc, getDocFromServer, increment, Timestamp, limit, onSnapshot, deleteDoc
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

export interface Ejercicio {
  tipo: 'verdadero_falso' | 'encuentra_el_error' | 'concepto';
  enunciado: string;
  desarrollo?: string;
}

export interface Reinforcement {
  nivel: 'rojo' | 'amarillo' | 'trivial';
  texto: string;
  ejercicios?: Ejercicio[];
  /** Timestamp Unix (segundos) del servidor cuando el backend guardó este reinforcement.
   *  Presente solo en reinforcements generados en background (no en los guardados por el frontend antiguo). */
  saved_at?: number;
}

export interface ChatNr {
  id: string;
  uid: string;
  nombre: string;
  id_head: string;
  id_tail: string;
  total_hilos: number;
  created_at: Date;
  last_reinforcement?: Reinforcement | null;
  resumen_conversacion?: string | null;
}

export interface HiloChat {
  id?: string;
  id_chat_nr: string;
  input: string;
  output: string;
  resumen: string;
  tipo_agente: 'respuesta' | 'refuerzo';
  tema: string | null;
  count: number;
  id_next: string;
  created_at: Date;
}

export interface LeaderboardEntry {
  uid: string;
  display_name: string;
  email: string | null;
  photo_url: string | null;
  total_matematicas: number;
  fecha_actualizacion: Date;
}

export interface ProfileSnapshot {
  id: string;
  fecha: Date;
  tema: string;
  puntos_fuertes: string[];
  puntos_debiles: string[];
}

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);

  private get uid(): string {
    return this.auth.currentUser?.uid ?? 'anon';
  }

  // ─── Chats ─────────────────────────────────────────────────────────────────

  async getChatList(): Promise<ChatNr[]> {
    const q = query(
      collection(this.firestore, 'Chat_nr'),
      where('uid', '==', this.uid),
      orderBy('created_at', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        uid: data['uid'],
        nombre: data['nombre'],
        id_head: data['id_head'],
        id_tail: data['id_tail'],
        total_hilos: data['total_hilos'] ?? 0,
        created_at: (data['created_at'] as Timestamp)?.toDate?.() ?? new Date(),
        last_reinforcement: this._mapReinforcement(data['last_reinforcement']),
        resumen_conversacion: data['resumen_conversacion'] ?? null,
      } as ChatNr;
    });
  }

  async createChat(nombre: string): Promise<ChatNr> {
    const ref = await addDoc(collection(this.firestore, 'Chat_nr'), {
      uid: this.uid,
      nombre,
      id_head: '',
      id_tail: '',
      total_hilos: 0,
      created_at: new Date(),
    });
    return {
      id: ref.id,
      uid: this.uid,
      nombre,
      id_head: '',
      id_tail: '',
      total_hilos: 0,
      created_at: new Date(),
    };
  }

  async getChatTotalHilos(id_chat_nr: string): Promise<number> {
    const snap = await getDoc(doc(this.firestore, 'Chat_nr', id_chat_nr));
    return snap.data()?.['total_hilos'] ?? 0;
  }

  /** Mapea el campo raw de Firestore a la interfaz Reinforcement (incluye saved_at si existe). */
  private _mapReinforcement(raw: any): Reinforcement | null {
    if (!raw?.['nivel']) return null;
    return {
      nivel: raw['nivel'],
      texto: raw['texto'] ?? '',
      ejercicios: raw['ejercicios'] ?? [],
      saved_at: raw['saved_at'] ?? undefined,
    } as Reinforcement;
  }

  async renameChat(id: string, nombre: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'Chat_nr', id), { nombre });
  }

  async deleteChat(id: string): Promise<void> {
    const q = query(collection(this.firestore, 'Hilo_chat'), where('id_chat_nr', '==', id));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(doc(this.firestore, 'Hilo_chat', d.id))));
    await deleteDoc(doc(this.firestore, 'Chat_nr', id));
  }

  async saveReinforcement(id_chat_nr: string, reinforcement: Reinforcement): Promise<void> {
    await updateDoc(doc(this.firestore, 'Chat_nr', id_chat_nr), {
      last_reinforcement: {
        nivel: reinforcement.nivel,
        texto: reinforcement.texto,
        ejercicios: reinforcement.ejercicios ?? [],
      },
    });
  }

  /**
   * Escucha en tiempo real el campo last_reinforcement del chat.
   * Llama al callback cada vez que Firestore actualiza el documento.
   * Retorna una función de unsubscribe.
   */
  watchReinforcement(
    id_chat_nr: string,
    callback: (r: Reinforcement | null) => void,
  ): () => void {
    const ref = doc(this.firestore, 'Chat_nr', id_chat_nr);
    return onSnapshot(ref, (snap) => {
      callback(this._mapReinforcement(snap.data()?.['last_reinforcement']));
    });
  }

  // ─── Hilos ─────────────────────────────────────────────────────────────────

  async appendHilo(
    id_chat_nr: string,
    input: string,
    output: string,
    tema: string | null,
  ): Promise<number> {
    const chatRef = doc(this.firestore, 'Chat_nr', id_chat_nr);
    const chatSnap = await getDoc(chatRef);
    const chatData = chatSnap.data() ?? {};
    const newCount = (chatData['total_hilos'] ?? 0) + 1;

    const hiloRef = collection(this.firestore, 'Hilo_chat');
    const newDoc = await addDoc(hiloRef, {
      id_chat_nr,
      input,
      output,
      resumen: '',
      tipo_agente: 'respuesta',
      tema,
      count: newCount,
      id_next: '',
      created_at: new Date(),
    });

    // Actualizar id_next del tail anterior
    if (chatData['id_tail']) {
      await updateDoc(doc(this.firestore, 'Hilo_chat', chatData['id_tail']), {
        id_next: newDoc.id,
      });
    }

    await updateDoc(chatRef, {
      id_tail: newDoc.id,
      total_hilos: increment(1),
      ...(chatData['id_head'] === '' ? { id_head: newDoc.id } : {}),
    });

    return newCount;
  }

  async loadHistory(id_chat_nr: string): Promise<HiloChat[]> {
    const q = query(
      collection(this.firestore, 'Hilo_chat'),
      where('id_chat_nr', '==', id_chat_nr),
      orderBy('created_at', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as HiloChat));
  }

  // ─── Perfil / Snapshots ────────────────────────────────────────────────────

  // ─── Leaderboard ───────────────────────────────────────────────────────────

  async getUserStats(): Promise<{ total_hilos_global: number }> {
    try {
      const snap = await getDoc(doc(this.firestore, 'Perfil_usuario', this.uid));
      return { total_hilos_global: snap.data()?.['total_hilos_global'] ?? 0 };
    } catch {
      return { total_hilos_global: 0 };
    }
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const q = query(
      collection(this.firestore, 'Leaderboard'),
      orderBy('total_matematicas', 'desc'),
      limit(20)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        uid: d.id,
        display_name: data['display_name'] ?? 'Estudiante',
        email: data['email'] ?? null,
        photo_url: data['photo_url'] ?? null,
        total_matematicas: data['total_matematicas'] ?? 0,
        fecha_actualizacion: (data['fecha_actualizacion'] as Timestamp)?.toDate?.() ?? new Date(),
      } as LeaderboardEntry;
    });
  }

  /**
   * Escucha en tiempo real la colección Leaderboard.
   * Retorna una función de unsubscribe.
   */
  watchLeaderboard(
    callback: (entries: LeaderboardEntry[]) => void,
    onError?: (err: any) => void,
  ): () => void {
    const q = query(
      collection(this.firestore, 'Leaderboard'),
      orderBy('total_matematicas', 'desc'),
      limit(20)
    );
    return onSnapshot(q, (snap) => {
      const entries = snap.docs.map(d => {
        const data = d.data();
        return {
          uid: d.id,
          display_name: data['display_name'] ?? 'Estudiante',
          email: data['email'] ?? null,
          photo_url: data['photo_url'] ?? null,
          total_matematicas: data['total_matematicas'] ?? 0,
          fecha_actualizacion: (data['fecha_actualizacion'] as Timestamp)?.toDate?.() ?? new Date(),
        } as LeaderboardEntry;
      });
      callback(entries);
    }, (err) => {
      if (onError) onError(err);
    });
  }

  // ─── Perfil / Snapshots ────────────────────────────────────────────────────

  async getSnapshots(): Promise<ProfileSnapshot[]> {
    const q = query(
      collection(this.firestore, 'Perfil_usuario', this.uid, 'snapshots'),
      orderBy('fecha', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        fecha: (data['fecha'] as Timestamp)?.toDate?.() ?? new Date(),
        tema: data['tema'],
        puntos_fuertes: data['puntos_fuertes'] ?? [],
        puntos_debiles: data['puntos_debiles'] ?? [],
      } as ProfileSnapshot;
    });
  }
}

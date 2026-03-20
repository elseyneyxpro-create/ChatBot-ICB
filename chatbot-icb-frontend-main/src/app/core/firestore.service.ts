import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, addDoc, getDocs, query, where, orderBy,
  doc, updateDoc, setDoc, getDoc, increment, Timestamp
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

export interface ChatNr {
  id: string;
  uid: string;
  nombre: string;
  id_head: string;
  id_tail: string;
  total_hilos: number;
  created_at: Date;
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

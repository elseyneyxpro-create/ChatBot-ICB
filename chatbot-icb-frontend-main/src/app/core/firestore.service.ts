import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, addDoc, getDocs, query, where, orderBy,
  doc, updateDoc, setDoc, getDoc, increment, Timestamp, limit, onSnapshot, deleteDoc,
  collectionGroup,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

export interface Ejercicio {
  tipo: 'verdadero_falso' | 'encuentra_el_error' | 'concepto';
  enunciado: string;
  desarrollo?: string[];
  respuesta_correcta?: boolean;
  paso_error?: number;
  explicacion?: string;
  // Estado del alumno (se llena al responder)
  respondido?: boolean;
  es_correcto?: boolean;
  respuesta_alumno?: any;
  feedback?: string;
}

export interface Reinforcement {
  nivel: 'rojo' | 'amarillo' | 'trivial';
  texto: string;
  ejercicios?: Ejercicio[];
  videos?: { url: string; categoria: string }[];
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
  last_videos?: { url: string; categoria: string }[];
  resumen_rolling?: string | null;
  resumenes?: string[];
  super_resumenes?: string[];
  // Contadores para perfil/leaderboard
  aciertos_concepto?: number;
  aciertos_vof?: number;
  aciertos_error?: number;
  errores_concepto?: number;
  errores_vof?: number;
  errores_error?: number;
}

export interface HiloChat {
  id?: string;
  id_chat_nr: string;
  tipo: 'respuesta' | 'system';
  texto?: string;             // solo para tipo 'system'
  input?: string;             // solo para tipo 'respuesta'
  output?: string;            // solo para tipo 'respuesta'
  tema: string | null;
  count: number;
  id_next: string;
  created_at: Date;
  ejemplo_videos?: string[];
  reinforcement?: Reinforcement | null;
}

export interface ProfileTemaStats {
  tema: string;
  vof_aciertos: number;
  vof_errores: number;
  error_aciertos: number;
  error_errores: number;
  concepto_aciertos: number;
  concepto_errores: number;
  errores_rojo: number;
  ultima_actividad?: Date;
}

export interface LeaderboardEntry {
  uid: string;
  display_name: string;
  photo_url: string | null;
  total_aciertos: number;
  total_errores: number;
  porcentaje: number;
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
    return snap.docs.map(d => this._mapChatNr(d.id, d.data()));
  }

  async createChat(nombre: string): Promise<ChatNr> {
    const data = {
      uid: this.uid,
      nombre,
      id_head: '',
      id_tail: '',
      total_hilos: 0,
      created_at: new Date(),
      resumen_rolling: '',
      resumenes: [],
      super_resumenes: [],
      aciertos_concepto: 0,
      aciertos_vof: 0,
      aciertos_error: 0,
      errores_concepto: 0,
      errores_vof: 0,
      errores_error: 0,
    };
    const ref = await addDoc(collection(this.firestore, 'Chat_nr'), data);
    return this._mapChatNr(ref.id, { ...data, created_at: Timestamp.fromDate(data.created_at) });
  }

  async getChatTotalHilos(id_chat_nr: string): Promise<number> {
    const snap = await getDoc(doc(this.firestore, 'Chat_nr', id_chat_nr));
    return snap.data()?.['total_hilos'] ?? 0;
  }

  private _mapChatNr(id: string, data: any): ChatNr {
    return {
      id,
      uid: data['uid'],
      nombre: data['nombre'],
      id_head: data['id_head'] ?? '',
      id_tail: data['id_tail'] ?? '',
      total_hilos: data['total_hilos'] ?? 0,
      created_at: (data['created_at'] as Timestamp)?.toDate?.() ?? new Date(),
      last_reinforcement: this._mapReinforcement(data['last_reinforcement']),
      last_videos: data['last_videos'] ?? [],
      resumen_rolling: data['resumen_rolling'] ?? data['resumen_conversacion'] ?? null,
      resumenes: data['resumenes'] ?? [],
      super_resumenes: data['super_resumenes'] ?? [],
      aciertos_concepto: data['aciertos_concepto'] ?? 0,
      aciertos_vof: data['aciertos_vof'] ?? 0,
      aciertos_error: data['aciertos_error'] ?? 0,
      errores_concepto: data['errores_concepto'] ?? 0,
      errores_vof: data['errores_vof'] ?? 0,
      errores_error: data['errores_error'] ?? 0,
    };
  }

  private _mapReinforcement(raw: any): Reinforcement | null {
    if (!raw?.['nivel']) return null;
    return {
      nivel: raw['nivel'],
      texto: raw['texto'] ?? '',
      ejercicios: (raw['ejercicios'] ?? []).map((ej: any) => this._mapEjercicio(ej)),
      videos: raw['videos'] ?? [],
      saved_at: raw['saved_at'] ?? undefined,
    } as Reinforcement;
  }

  private _mapEjercicio(ej: any): Ejercicio {
    return {
      tipo: ej['tipo'],
      enunciado: ej['enunciado'] ?? '',
      desarrollo: Array.isArray(ej['desarrollo']) ? ej['desarrollo'] : undefined,
      respuesta_correcta: this._parseBool(ej['respuesta_correcta']),
      paso_error: typeof ej['paso_error'] === 'number' ? ej['paso_error'] : undefined,
      explicacion: typeof ej['explicacion'] === 'string' ? ej['explicacion'] : '',
      respondido: ej['respondido'] === true,
      es_correcto: typeof ej['es_correcto'] === 'boolean' ? ej['es_correcto'] : undefined,
      respuesta_alumno: ej['respuesta_alumno'],
      feedback: typeof ej['feedback'] === 'string' ? ej['feedback'] : undefined,
    };
  }

  private _parseBool(val: any): boolean | undefined {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const v = val.trim().toLowerCase();
      if (v === 'true' || v === 'verdadero' || v === '1' || v === 'v') return true;
      if (v === 'false' || v === 'falso' || v === '0' || v === 'f') return false;
    }
    return undefined;
  }

  async saveLastVideos(id_chat_nr: string, videos: { url: string; categoria: string }[]): Promise<void> {
    try {
      await updateDoc(doc(this.firestore, 'Chat_nr', id_chat_nr), { last_videos: videos });
    } catch (e) {
      console.warn('[FirestoreService] saveLastVideos falló:', e);
    }
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
    ejemploVideos: string[] = [],
  ): Promise<{ count: number; hiloId: string }> {
    const chatRef = doc(this.firestore, 'Chat_nr', id_chat_nr);
    const chatSnap = await getDoc(chatRef);
    const chatData = chatSnap.data() ?? {};
    const newCount = (chatData['total_hilos'] ?? 0) + 1;

    const hiloRef = collection(this.firestore, 'Hilo_chat');
    const newDoc = await addDoc(hiloRef, {
      id_chat_nr,
      tipo: 'respuesta',
      input,
      output,
      tema,
      count: newCount,
      id_next: '',
      created_at: new Date(),
      ejemplo_videos: ejemploVideos,
      reinforcement: null,
    });

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

    return { count: newCount, hiloId: newDoc.id };
  }

  /**
   * Crea un hilo de tipo 'system' que aparece como mensaje permanente en el historial.
   * Se usa cuando el sistema resume el contexto cada N hilos.
   */
  async appendSystemHilo(id_chat_nr: string, texto: string): Promise<string> {
    const chatRef = doc(this.firestore, 'Chat_nr', id_chat_nr);
    const chatSnap = await getDoc(chatRef);
    const chatData = chatSnap.data() ?? {};
    const newCount = (chatData['total_hilos'] ?? 0) + 1;

    const hiloRef = collection(this.firestore, 'Hilo_chat');
    const newDoc = await addDoc(hiloRef, {
      id_chat_nr,
      tipo: 'system',
      texto,
      tema: null,
      count: newCount,
      id_next: '',
      created_at: new Date(),
    });

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

    return newDoc.id;
  }

  /**
   * Persiste el reinforcement en el último hilo del chat (id_tail).
   * Lo llama el frontend cuando recibe el reinforcement vía watchReinforcement.
   */
  async updateHiloReinforcement(id_chat_nr: string, reinforcement: Reinforcement): Promise<void> {
    try {
      const chatSnap = await getDoc(doc(this.firestore, 'Chat_nr', id_chat_nr));
      const id_tail = chatSnap.data()?.['id_tail'];
      if (!id_tail) return;
      await updateDoc(doc(this.firestore, 'Hilo_chat', id_tail), { reinforcement });
    } catch (e) {
      console.warn('[FirestoreService] updateHiloReinforcement falló:', e);
    }
  }

  /**
   * Actualiza un ejercicio específico del reinforcement embebido en un hilo,
   * marcando la respuesta del alumno (respondido, es_correcto, respuesta_alumno, feedback).
   */
  async updateHiloEjercicio(
    hiloId: string,
    ejercicioTipo: 'concepto' | 'verdadero_falso' | 'encuentra_el_error',
    update: { es_correcto: boolean; respuesta_alumno: any; feedback?: string },
  ): Promise<void> {
    try {
      const hiloRef = doc(this.firestore, 'Hilo_chat', hiloId);
      const snap = await getDoc(hiloRef);
      const data = snap.data();
      const reinforcement = data?.['reinforcement'];
      if (!reinforcement?.ejercicios) return;
      const ejercicios = (reinforcement.ejercicios as any[]).map(ej => {
        if (ej.tipo !== ejercicioTipo) return ej;
        return {
          ...ej,
          respondido: true,
          es_correcto: update.es_correcto,
          respuesta_alumno: update.respuesta_alumno,
          ...(update.feedback !== undefined ? { feedback: update.feedback } : {}),
        };
      });
      await updateDoc(hiloRef, { reinforcement: { ...reinforcement, ejercicios } });
    } catch (e) {
      console.warn('[FirestoreService] updateHiloEjercicio falló:', e);
    }
  }

  async loadHistory(id_chat_nr: string): Promise<HiloChat[]> {
    const q = query(
      collection(this.firestore, 'Hilo_chat'),
      where('id_chat_nr', '==', id_chat_nr),
      orderBy('created_at', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        id_chat_nr: data['id_chat_nr'],
        tipo: data['tipo'] ?? 'respuesta',
        texto: data['texto'],
        input: data['input'],
        output: data['output'],
        tema: data['tema'] ?? null,
        count: data['count'] ?? 0,
        id_next: data['id_next'] ?? '',
        created_at: (data['created_at'] as Timestamp)?.toDate?.() ?? new Date(),
        ejemplo_videos: data['ejemplo_videos'] ?? [],
        reinforcement: this._mapReinforcement(data['reinforcement']),
      } as HiloChat;
    });
  }

  // ─── Perfil ────────────────────────────────────────────────────────────────

  /**
   * Guarda el nombre y foto del usuario en Perfil_usuario/{uid}.profile.
   * Se llama al login o al primer mensaje, para que el leaderboard tenga estos datos.
   */
  async saveUserProfile(displayName: string | null, photoURL: string | null): Promise<void> {
    try {
      await setDoc(doc(this.firestore, 'Perfil_usuario', this.uid), {
        profile: {
          display_name: displayName ?? '',
          photo_url: photoURL ?? '',
        },
        fecha_actualizacion: new Date(),
      }, { merge: true });
    } catch (e) {
      console.warn('[FirestoreService] saveUserProfile falló:', e);
    }
  }

  /**
   * Estadísticas del usuario actual: lee todos sus chats y agrega los contadores,
   * además devuelve estadísticas por tema desde Perfil_usuario/{uid}/temas/* y weak_points_text.
   */
  async getProfileStats(): Promise<{
    total_aciertos: number;
    total_errores: number;
    porcentaje: number;
    weak_points_text: string;
    temas: ProfileTemaStats[];
  }> {
    const chats = await this.getChatList();
    let total_aciertos = 0;
    let total_errores = 0;
    for (const c of chats) {
      total_aciertos += (c.aciertos_concepto ?? 0) + (c.aciertos_vof ?? 0) + (c.aciertos_error ?? 0);
      total_errores += (c.errores_concepto ?? 0) + (c.errores_vof ?? 0) + (c.errores_error ?? 0);
    }
    const total = total_aciertos + total_errores;
    const porcentaje = total > 0 ? Math.round((total_aciertos / total) * 100) : 0;

    let weak_points_text = '';
    const temas: ProfileTemaStats[] = [];
    try {
      const profileSnap = await getDoc(doc(this.firestore, 'Perfil_usuario', this.uid));
      weak_points_text = profileSnap.data()?.['weak_points_text'] ?? '';

      const temasSnap = await getDocs(
        collection(this.firestore, 'Perfil_usuario', this.uid, 'temas')
      );
      for (const t of temasSnap.docs) {
        const d = t.data();
        temas.push({
          tema: d['tema'] ?? t.id,
          vof_aciertos: d['vof_aciertos'] ?? 0,
          vof_errores: d['vof_errores'] ?? 0,
          error_aciertos: d['error_aciertos'] ?? 0,
          error_errores: d['error_errores'] ?? 0,
          concepto_aciertos: d['concepto_aciertos'] ?? 0,
          concepto_errores: d['concepto_errores'] ?? 0,
          errores_rojo: d['errores_rojo'] ?? 0,
          ultima_actividad: (d['ultima_actividad'] as Timestamp)?.toDate?.(),
        });
      }
    } catch (e) {
      console.warn('[FirestoreService] getProfileStats falló:', e);
    }

    return { total_aciertos, total_errores, porcentaje, weak_points_text, temas };
  }

  /**
   * Leaderboard ordenado por aciertos totales.
   * Lee todos los Chat_nr, agrupa por uid, suma y ordena.
   */
  async getLeaderboardTotals(topN = 50): Promise<LeaderboardEntry[]> {
    const snap = await getDocs(collection(this.firestore, 'Chat_nr'));
    const map = new Map<string, { aciertos: number; errores: number }>();
    for (const d of snap.docs) {
      const data = d.data();
      const uid = data['uid'];
      if (!uid) continue;
      const a = (data['aciertos_concepto'] ?? 0) + (data['aciertos_vof'] ?? 0) + (data['aciertos_error'] ?? 0);
      const e = (data['errores_concepto'] ?? 0) + (data['errores_vof'] ?? 0) + (data['errores_error'] ?? 0);
      const cur = map.get(uid) ?? { aciertos: 0, errores: 0 };
      map.set(uid, { aciertos: cur.aciertos + a, errores: cur.errores + e });
    }

    const entries = await Promise.all([...map.entries()].map(async ([uid, stats]) => {
      const profile = await this._getUserProfile(uid);
      const total = stats.aciertos + stats.errores;
      return {
        uid,
        display_name: profile.display_name,
        photo_url: profile.photo_url,
        total_aciertos: stats.aciertos,
        total_errores: stats.errores,
        porcentaje: total > 0 ? Math.round((stats.aciertos / total) * 100) : 0,
      } as LeaderboardEntry;
    }));

    return entries
      .filter(e => e.total_aciertos + e.total_errores > 0)
      .sort((a, b) => b.total_aciertos - a.total_aciertos)
      .slice(0, topN);
  }

  /**
   * Leaderboard filtrado por tema. Usa collectionGroup en la subcolección 'temas'.
   */
  async getLeaderboardPorTema(tema: string, topN = 50): Promise<LeaderboardEntry[]> {
    const q = query(collectionGroup(this.firestore, 'temas'), where('tema', '==', tema));
    const snap = await getDocs(q);

    const entries = await Promise.all(snap.docs.map(async (d) => {
      const data = d.data();
      const uid = d.ref.parent.parent?.id;
      if (!uid) return null;
      const aciertos = (data['vof_aciertos'] ?? 0) + (data['error_aciertos'] ?? 0) + (data['concepto_aciertos'] ?? 0);
      const errores = (data['vof_errores'] ?? 0) + (data['error_errores'] ?? 0) + (data['concepto_errores'] ?? 0);
      if (aciertos + errores === 0) return null;
      const profile = await this._getUserProfile(uid);
      const total = aciertos + errores;
      return {
        uid,
        display_name: profile.display_name,
        photo_url: profile.photo_url,
        total_aciertos: aciertos,
        total_errores: errores,
        porcentaje: total > 0 ? Math.round((aciertos / total) * 100) : 0,
      } as LeaderboardEntry;
    }));

    return entries
      .filter((e): e is LeaderboardEntry => e !== null)
      .sort((a, b) => b.total_aciertos - a.total_aciertos)
      .slice(0, topN);
  }

  /**
   * Top 5 temas con más actividad (suma de aciertos+errores) entre todos los usuarios.
   */
  async getTop5Temas(): Promise<string[]> {
    const snap = await getDocs(collectionGroup(this.firestore, 'temas'));
    const counter = new Map<string, number>();
    for (const d of snap.docs) {
      const data = d.data();
      const tema = data['tema'];
      if (!tema) continue;
      const total = (data['vof_aciertos'] ?? 0) + (data['vof_errores'] ?? 0)
        + (data['error_aciertos'] ?? 0) + (data['error_errores'] ?? 0)
        + (data['concepto_aciertos'] ?? 0) + (data['concepto_errores'] ?? 0);
      counter.set(tema, (counter.get(tema) ?? 0) + total);
    }
    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);
  }

  private async _getUserProfile(uid: string): Promise<{ display_name: string; photo_url: string | null }> {
    try {
      const snap = await getDoc(doc(this.firestore, 'Perfil_usuario', uid));
      const profile = snap.data()?.['profile'];
      return {
        display_name: profile?.['display_name'] || 'Estudiante',
        photo_url: profile?.['photo_url'] || null,
      };
    } catch {
      return { display_name: 'Estudiante', photo_url: null };
    }
  }
}

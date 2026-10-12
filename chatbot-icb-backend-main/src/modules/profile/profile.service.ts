import { Injectable } from '@nestjs/common';
import { MongoService } from '../../database/mongo.service';

export interface LeaderboardEntry {
  uid: string;
  display_name: string;
  photo_url: string | null;
  total_aciertos: number;
  total_errores: number;
  total_ejercicios: number;
  porcentaje: number;
}

const aciertosDe = (d: any) => (d.vof_aciertos ?? 0) + (d.error_aciertos ?? 0) + (d.concepto_aciertos ?? 0);
const erroresDe  = (d: any) => (d.vof_errores ?? 0) + (d.error_errores ?? 0) + (d.concepto_errores ?? 0);
const pct = (a: number, total: number) => (total > 0 ? Math.round((a / total) * 100) : 0);

/**
 * Perfil y leaderboard. Antes el frontend hacía estas consultas con collectionGroup('nivel_usuario')
 * sobre Firestore; ahora nivel_usuario es una colección plana con { uid, tema, ... }.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly mongo: MongoService) {}

  private get niveles() { return this.mongo.col('nivel_usuario'); }

  async getStats(uid: string) {
    const perfil = await this.mongo.col('Perfil_usuario').findOne({ _id: uid });
    const docs = await this.niveles.find({ uid }).toArray();

    let total_aciertos = 0;
    let total_errores = 0;
    const temas = docs.map((d: any) => {
      total_aciertos += aciertosDe(d);
      total_errores += erroresDe(d);
      return {
        tema: d.tema,
        nivel: d.nivel ?? 'normal',
        vof_aciertos: d.vof_aciertos ?? 0,
        vof_errores: d.vof_errores ?? 0,
        error_aciertos: d.error_aciertos ?? 0,
        error_errores: d.error_errores ?? 0,
        concepto_aciertos: d.concepto_aciertos ?? 0,
        concepto_errores: d.concepto_errores ?? 0,
        errores_rojo: d.errores_rojo ?? 0,
        ultima_actividad: d.ultima_actividad ?? null,
      };
    });

    return {
      total_aciertos,
      total_errores,
      porcentaje: pct(total_aciertos, total_aciertos + total_errores),
      weak_points_text: perfil?.['weak_points_text'] ?? '',
      temas,
    };
  }

  async leaderboard(topN = 50, sortBy: 'aciertos' | 'uso' = 'aciertos', tema?: string): Promise<LeaderboardEntry[]> {
    const docs = await this.niveles.find(tema ? { tema } : {}).toArray();
    const map = new Map<string, { aciertos: number; errores: number }>();
    for (const d of docs as any[]) {
      if (!d.uid) continue;
      const cur = map.get(d.uid) ?? { aciertos: 0, errores: 0 };
      map.set(d.uid, { aciertos: cur.aciertos + aciertosDe(d), errores: cur.errores + erroresDe(d) });
    }

    const uids = [...map.keys()];
    const perfiles = await this.mongo.col('Perfil_usuario')
      .find({ _id: { $in: uids } }, { projection: { profile: 1 } })
      .toArray();
    const perfilPorUid = new Map(perfiles.map((p: any) => [p._id, p.profile ?? {}]));

    const entries: LeaderboardEntry[] = [...map.entries()]
      .map(([uid, s]) => {
        const total = s.aciertos + s.errores;
        const profile = perfilPorUid.get(uid) ?? {};
        return {
          uid,
          display_name: profile.display_name || 'Estudiante',
          photo_url: profile.photo_url || null,
          total_aciertos: s.aciertos,
          total_errores: s.errores,
          total_ejercicios: total,
          porcentaje: pct(s.aciertos, total),
        };
      })
      .filter((e) => e.total_ejercicios > 0);

    if (tema) entries.sort((a, b) => b.total_aciertos - a.total_aciertos);
    else if (sortBy === 'uso') entries.sort((a, b) => b.total_ejercicios - a.total_ejercicios);
    else entries.sort((a, b) => b.porcentaje - a.porcentaje || b.total_aciertos - a.total_aciertos);

    return entries.slice(0, topN);
  }

  async top5Temas(): Promise<string[]> {
    const docs = await this.niveles.find({}).toArray();
    const counter = new Map<string, number>();
    for (const d of docs as any[]) {
      if (!d.tema) continue;
      counter.set(d.tema, (counter.get(d.tema) ?? 0) + aciertosDe(d) + erroresDe(d));
    }
    return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
  }
}

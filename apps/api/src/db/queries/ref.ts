/** Spravochnik so'rovlari. */
import type { Bootstrap, Elektroset, Mfy, NetworkSegment, Norm, Tp } from '@beap/shared';

import { type AppContext, query, queryOne } from '../pool.ts';
import { dataRange } from './dashboard.ts';

export async function bootstrap(ctx: AppContext): Promise<Bootstrap> {
  const [elektrosets, mfys, norms, categories, refresh, range] = await Promise.all([
    query<{ id: number; code: string; name_uz: string; name_uz_cyr: string | null }>(
      `SELECT id, code, name_uz, name_uz_cyr FROM ref.elektroset WHERE is_active ORDER BY id`, [], ctx),
    query<Record<string, unknown>>(
      `SELECT m.id, m.elektroset_id, e.name_uz AS elektroset_name, m.code, m.name_uz,
              m.name_uz_cyr, m.short_name, m.sort_order, m.grid_row, m.grid_col
       FROM ref.mfy m JOIN ref.elektroset e ON e.id = m.elektroset_id
       WHERE m.valid_to IS NULL ORDER BY m.sort_order, m.name_uz`, [], ctx),
    query<Record<string, unknown>>(
      `SELECT id, scope_type, scope_id, metric, value_num, unit,
              effective_from::text, effective_to::text, source_doc
       FROM ref.norm
       WHERE effective_to IS NULL OR effective_to > CURRENT_DATE
       ORDER BY metric, scope_type`, [], ctx),
    query<{ code: string; name_uz: string }>(
      `SELECT code, name_uz FROM ref.consumer_category ORDER BY id`, [], ctx),
    queryOne<{ at: string | null }>(
      `SELECT max(finished_at)::text AS at FROM agg.refresh_log WHERE ok`, [], ctx),
    dataRange(ctx),
  ]);

  return {
    elektrosets: elektrosets.map((e) => ({
      id: e.id, code: e.code, nameUz: e.name_uz, nameUzCyr: e.name_uz_cyr,
    })) as Elektroset[],
    mfys: mfys.map((m) => ({
      id: Number(m['id']), elektrosetId: Number(m['elektroset_id']),
      elektrosetName: String(m['elektroset_name']), code: String(m['code']),
      nameUz: String(m['name_uz']), nameUzCyr: (m['name_uz_cyr'] as string | null) ?? null,
      shortName: String(m['short_name']), sortOrder: Number(m['sort_order']),
      gridRow: m['grid_row'] === null ? null : Number(m['grid_row']),
      gridCol: m['grid_col'] === null ? null : Number(m['grid_col']),
    })) as Mfy[],
    norms: norms.map((n) => ({
      id: Number(n['id']), scopeType: n['scope_type'] as Norm['scopeType'],
      scopeId: n['scope_id'] === null ? null : Number(n['scope_id']),
      metric: String(n['metric']), valueNum: Number(n['value_num']), unit: String(n['unit']),
      effectiveFrom: String(n['effective_from']),
      effectiveTo: (n['effective_to'] as string | null) ?? null,
      sourceDoc: (n['source_doc'] as string | null) ?? null,
    })),
    categories: categories.map((c) => ({
      code: c.code as Bootstrap['categories'][number]['code'], nameUz: c.name_uz,
    })),
    lastRefreshAt: refresh?.at ?? null,
    dataRange: range,
  };
}

export async function listTp(ctx: AppContext, mfyId: number | null): Promise<Tp[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT t.id, t.mfy_id, m.name_uz AS mfy_name, t.code, t.name, t.rated_kva,
            t.voltage_class, t.avg_distance_m,
            t.commissioned_on::text, t.decommissioned_on::text
     FROM ref.tp t JOIN ref.mfy m ON m.id = t.mfy_id
     WHERE ($1::int IS NULL OR t.mfy_id = $1)
     ORDER BY t.code`, [mfyId], ctx);

  return rows.map((r) => ({
    id: Number(r['id']), mfyId: Number(r['mfy_id']), mfyName: String(r['mfy_name']),
    code: String(r['code']), name: (r['name'] as string | null) ?? null,
    ratedKva: Number(r['rated_kva']), voltageClass: String(r['voltage_class']),
    avgDistanceM: r['avg_distance_m'] === null ? null : Number(r['avg_distance_m']),
    commissionedOn: (r['commissioned_on'] as string | null) ?? null,
    decommissionedOn: (r['decommissioned_on'] as string | null) ?? null,
  }));
}

export async function listNetworkSegments(ctx: AppContext, mfyId: number | null): Promise<NetworkSegment[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, mfy_id, voltage_kv, line_type, length_km,
            installed_on::text, retired_on::text
     FROM ref.network_segment
     WHERE ($1::int IS NULL OR mfy_id = $1)
     ORDER BY mfy_id, voltage_kv`, [mfyId], ctx);

  return rows.map((r) => ({
    id: Number(r['id']), mfyId: Number(r['mfy_id']), voltageKv: Number(r['voltage_kv']),
    lineType: r['line_type'] as NetworkSegment['lineType'], lengthKm: Number(r['length_km']),
    installedOn: (r['installed_on'] as string | null) ?? null,
    retiredOn: (r['retired_on'] as string | null) ?? null,
  }));
}

export async function getMfy(ctx: AppContext, id: number): Promise<Mfy | null> {
  const r = await queryOne<Record<string, unknown>>(
    `SELECT m.id, m.elektroset_id, e.name_uz AS elektroset_name, m.code, m.name_uz,
            m.name_uz_cyr, m.short_name, m.sort_order, m.grid_row, m.grid_col
     FROM ref.mfy m JOIN ref.elektroset e ON e.id = m.elektroset_id
     WHERE m.id = $1`, [id], ctx);
  if (!r) return null;
  return {
    id: Number(r['id']), elektrosetId: Number(r['elektroset_id']),
    elektrosetName: String(r['elektroset_name']), code: String(r['code']),
    nameUz: String(r['name_uz']), nameUzCyr: (r['name_uz_cyr'] as string | null) ?? null,
    shortName: String(r['short_name']), sortOrder: Number(r['sort_order']),
    gridRow: r['grid_row'] === null ? null : Number(r['grid_row']),
    gridCol: r['grid_col'] === null ? null : Number(r['grid_col']),
  };
}

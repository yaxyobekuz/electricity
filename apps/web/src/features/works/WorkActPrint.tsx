/**
 * Ish dalolatnomasi - chop etish sahifasi.
 *
 * Qobiqsiz, A4 ga moslangan (`print.css`). Ma'lumot va rasmlar kelgach chop
 * etish oynasi o'zi ochiladi - foydalanuvchi bitta tugma bosadi, qolganini
 * brauzer qiladi.
 */
import { dateShort } from '@beap/shared';
import { useEffect } from 'react';
import { useParams } from 'react-router';

import { LoadingState } from '../../components/layout/AppShell.tsx';
import { useWork } from '../../lib/queries.ts';
import { WorkAct } from './WorkAct.tsx';

export default function WorkActPrint() {
  const params = useParams();
  const id = Number(params['id'] ?? 0);
  const work = useWork(Number.isFinite(id) && id > 0 ? id : null);

  /*
   * Kechikish ATAYLAB: rasmlar `blob:` sifatida yuklanadi va ular kelmasidan
   * chop etilsa, qog'ozda bo'sh to'rtburchaklar chiqadi.
   */
  useEffect(() => {
    if (!work.data) return undefined;
    const timer = setTimeout(() => window.print(), work.data.photos.length > 0 ? 1200 : 400);
    return () => clearTimeout(timer);
  }, [work.data]);

  if (work.isLoading) return <LoadingState rows={4} />;
  if (!work.data) return <p className="p-8 text-center text-sm text-muted">Ish topilmadi</p>;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-6 text-black">
      <header className="mb-4 text-center">
        <p className="text-[11px] uppercase tracking-wide">
          Baliqchi tumani hokimligi · Elektr ta’minoti
        </p>
        <h1 className="mt-1 text-[16px] font-bold uppercase">Bajarilgan ish dalolatnomasi</h1>
        <p className="mt-0.5 text-[11px]">
          Sana: {dateShort(work.data.actualEnd ?? work.data.plannedEnd ?? '')}
        </p>
      </header>

      <WorkAct print work={work.data} />
    </div>
  );
}

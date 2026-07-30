/**
 * Chop etish uchun pasport — qobiqsiz, A4 ga moslangan.
 *
 * Chop etishda majburiy yorug' tema (print.css). Rasmiy hujjat ko'rinishi:
 * markazlashtirilgan sarlavha, raqamli qatorlar, imzo joyi.
 */
import { periodLabel } from '@beap/shared';
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { LoadingState } from '../../components/layout/AppShell.tsx';
import { useMfyPassport, useTumanPassport } from '../../lib/queries.ts';
import { currentScript } from '../../i18n/index.ts';
import { PassportTable } from './PassportTable.tsx';
export default function PassportPrint() {
    const params = useParams();
    const scope = params['scope'] === 'mfy' ? 'mfy' : 'tuman';
    const id = Number(params['id'] ?? 0);
    const periodParam = params['period'] ?? 'latest';
    const period = periodParam === 'latest' ? undefined : periodParam;
    const tuman = useTumanPassport(period);
    const mfy = useMfyPassport(id, period);
    const query = scope === 'mfy' ? mfy : tuman;
    const passport = query.data;
    // Ma'lumot kelgach chop etish oynasini ochamiz.
    useEffect(() => {
        if (passport) {
            const timer = setTimeout(() => window.print(), 400);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [passport]);
    if (query.isLoading)
        return <LoadingState rows={4}/>;
    if (!passport) {
        return (<div className="p-10 text-center text-sm">Bu davr uchun pasport ma’lumoti topilmadi.</div>);
    }
    const cyr = currentScript() === 'cyrl';
    return (<div className="mx-auto max-w-[210mm] bg-white p-8 text-black">
      <header className="mb-6 text-center">
        <h1 className="text-base font-bold leading-snug">
          {passport.scopeName}
          {cyr
            ? 'нинг электр энергиясидан фойдаланишда йўқотишларни олдини олиш бўйича'
            : ' elektr energiyasidan foydalanishda yo‘qotishlarni oldini olish bo‘yicha'}
          <br />
          {cyr ? 'ПАСПОРТИ' : 'PASPORTI'}
        </h1>
        <p className="mt-2 text-xs">
          {cyr ? 'Давр' : 'Davr'}: {periodLabel(passport.period, cyr ? 'cyrl' : 'latn')}
        </p>
      </header>

      <PassportTable compact passport={passport}/>

      <footer className="mt-8 flex justify-between text-xs">
        <div>
          <p className="mb-8">{cyr ? 'Тайёрлади:' : 'Tayyorladi:'}</p>
          <p className="border-t border-black pt-1">
            {cyr ? '(имзо, Ф.И.Ш.)' : '(imzo, F.I.SH.)'}
          </p>
        </div>
        <div>
          <p className="mb-8">{cyr ? 'Тасдиқлади:' : 'Tasdiqladi:'}</p>
          <p className="border-t border-black pt-1">
            {cyr ? '(имзо, Ф.И.Ш.)' : '(imzo, F.I.SH.)'}
          </p>
        </div>
      </footer>

      {passport.frozen && (<p className="mt-6 text-center font-mono text-[9px] text-neutral-600">
          {cyr ? 'Назорат суммаси' : 'Nazorat summasi'} (SHA-256): {passport.frozen.sha256}
          <br />
          {cyr ? 'Музлатилган' : 'Muzlatilgan'}: {passport.frozen.at} · {passport.frozen.by}
        </p>)}

      <p className="mt-4 text-center text-[9px] text-neutral-500">
        BEAP — {cyr ? 'Балиқчи тумани энергетика назорат тизими' : 'Baliqchi tumani energetika nazorat tizimi'}
      </p>
    </div>);
}

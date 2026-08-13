/**
 * Transformatorlar - fiderning asosiy tafsiloti.
 *
 * Fider darajasidagi tizimda eng qimmatli kesim shu yerda: har bir TP ning
 * balans hisoblagichi, foydali oqimi, yo'qotishi va iste'molchilari. Uch
 * manba birlashtiriladi - registr, oylik hisobot va TP kunlik yo'qotishi.
 *
 * SARALASH - barcha qator bir ekranga sig'maydi va foydalanuvchining savoli
 * deyarli har doim "qaysi biri eng yomon?" bo'ladi. Har bir ustun sarlavhasi
 * bosiladi va o'sha ustun bo'yicha saralaydi; aniq TP ni topish uchun esa
 * qidiruv maydoni bor. Ikkalasi birga ishlaydi.
 */
import { num, pct } from '@beap/shared';
import { Button, Chip, SearchField, cn } from '@heroui/react';
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { useBootstrap, useMfyTpLoss, useTpMonthly, useTpMonitoring } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

/** Jadval qatori - uch manbadan birlashtirilgan. */
interface Row {
  code: string;
  consumersTotal: number | null;
  consumersActive: number | null;
  consumersOff: number | null;
  offShare: number | null;
  /** Balans hisoblagichi - hisobotdagi «Hisoblangan». */
  balanceKwh: number | null;
  /** Biriktirilgan iste'molchilardan yig'ilgan - «Foydali oqim». */
  soldKwh: number | null;
  lossKwh: number | null;
  lossPct: number | null;
  share: number | null;
}

type SortKey = keyof Row;
type SortDir = 'asc' | 'desc';

/*
 * Matnli ustunlar A→Z, raqamlilar esa KATTADAN kichikka boshlanadi.
 *
 * Sabab: "iste'mol" ustunini bosgan odam eng kattasini ko'rmoqchi, eng
 * kichigini emas. Har safar ikki marta bosishga majburlash - ortiqcha ish.
 */
const TEXT_KEYS = new Set<SortKey>(['code']);

/*
 * Sahifa ENG KO'P ISTE'MOL QILGANDAN boshlanadi.
 *
 * «Qaysi TP eng ko'p yeyapti?» - sahifaga kirgan odamning birinchi savoli.
 * Kod bo'yicha alifbo tartibi esa hech qanday savolga javob bermasdi.
 */
const DEFAULT_SORT: SortKey = 'soldKwh';
const DEFAULT_DIR: SortDir = 'desc';

/** Saralanadigan ustunlar - sarlavha matni va kengligi bilan. */
const COLUMNS: { key: SortKey; label: string; width: string }[] = [
  { key: 'code', label: 'Transformator', width: 'w-[12%]' },
  { key: 'consumersTotal', label: 'Iste’molchilar', width: 'w-[10%]' },
  { key: 'consumersActive', label: 'Aloqada', width: 'w-[9%]' },
  { key: 'consumersOff', label: 'Aloqada emas', width: 'w-[10%]' },
  { key: 'balanceKwh', label: 'Hisoblangan (kWh)', width: 'w-[12%]' },
  { key: 'soldKwh', label: 'Foydali oqim (kWh)', width: 'w-[12%]' },
  { key: 'lossKwh', label: 'Yo’qotish (kWh)', width: 'w-[11%]' },
  { key: 'lossPct', label: 'Yo’qotish %', width: 'w-[9%]' },
  { key: 'share', label: 'Ulushi', width: 'w-[10%]' },
];

/**
 * Bosiladigan ustun sarlavhasi.
 *
 * Komponent sahifadan TASHQARIDA turadi: ichkarida e'lon qilinsa React uni
 * har renderda YANGI tur deb biladi va tugmani qayta yaratadi - saralash
 * uchun bosilgan tugmadan fokus yo'qolib, klaviatura bilan ishlash uziladi.
 */
function SortTh({
  label, sortKey, width, activeKey, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  width: string;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={width}
    >
      <button
        className={cn(
          'inline-flex items-center gap-1 rounded transition-colors hover:text-accent',
          active && 'text-accent',
        )}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={cn('size-3 shrink-0', !active && 'opacity-35')} strokeWidth={2.5} />
      </button>
    </th>
  );
}

export default function TpListPage() {
  const period = useUi((s) => s.period);
  const monitoring = useTpMonitoring(period ?? undefined, 1000);
  const monthly = useTpMonthly(period ?? undefined);
  /*
   * Balans hisoblagichi va yo'qotish TP kesimida `fact.tp_loss_daily` da
   * turadi - oylik hisobotda emas. Tizim qamrovi bitta fider, shuning uchun
   * registrdagi birinchi (yagona) fider olinadi.
   */
  const boot = useBootstrap();
  const feederId = boot.data?.mfys[0]?.id ?? 0;
  const tpLoss = useMfyTpLoss(feederId, { period: period ?? undefined });

  /*
   * Qidiruv boshlang'ich qiymati manzildan olinadi (`?q=TP-067`).
   *
   * AI agent «TP-067 ni ko'rsat» deganda shu sahifani ochadi va qidiruvni
   * oldindan to'ldiradi - foydalanuvchi ro'yxatdan o'zi izlamaydi. Keyin
   * maydon oddiy holatga o'tadi, ya'ni qo'lda o'zgartirish erkin.
   */
  const [params] = useSearchParams();
  const queryParam = params.get('q');
  const [search, setSearch] = useState(() => queryParam ?? '');
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR);

  /*
   * Foydalanuvchi ALLAQACHON shu sahifada bo'lsa komponent qayta
   * yaratilmaydi va yuqoridagi boshlang'ich qiymat ishlamaydi. Manzildagi
   * `q` o'zgarganda maydonni yangilaymiz. Foydalanuvchi qo'lda yozganda
   * `q` o'zgarmaydi, ya'ni yozayotgan matn ustidan yozilmaydi.
   */
  useEffect(() => {
    if (queryParam !== null) setSearch(queryParam);
  }, [queryParam]);

  /*
   * Uch manba bitta jadvalda: registr (TP kodi), oylik hisobot
   * (iste'molchilar) va TP kunlik yo'qotishi (balans hisoblagichi, foydali
   * oqim, yo'qotish). TP kodi bo'yicha birlashtiriladi - ma'lumoti kelmagan
   * TP ham ro'yxatda qoladi, ustunlari «-» bo'ladi.
   */
  const all = useMemo<Row[]>(() => {
    const byCode = new Map((monthly.data ?? []).map((m) => [m.code, m]));
    const lossByCode = new Map((tpLoss.data ?? []).map((l) => [l.code, l]));
    const totalSold = (tpLoss.data ?? []).reduce((a, l) => a + l.kwhConsumersAttached, 0);

    return (monitoring.data ?? []).map((r) => {
      const m = byCode.get(r.code);
      const l = lossByCode.get(r.code);
      return {
        code: r.code,
        consumersTotal: m?.consumersTotal ?? null,
        consumersActive: m?.consumersActive ?? null,
        consumersOff: m?.consumersDisconnected ?? null,
        offShare: m && m.consumersTotal > 0
          ? (m.consumersDisconnected / m.consumersTotal) * 100
          : null,
        balanceKwh: l?.kwhBalanceMeter ?? null,
        soldKwh: l?.kwhConsumersAttached ?? null,
        lossKwh: l?.kwhLoss ?? null,
        lossPct: l?.lossPct ?? null,
        share: l && totalSold > 0 ? (l.kwhConsumersAttached / totalSold) * 100 : null,
      };
    });
  }, [monitoring.data, monthly.data, tpLoss.data]);

  const rows = useMemo(() => {
    let out = all;

    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => r.code.toLowerCase().includes(q));
    }

    /*
     * Bo'sh qiymat DOIM oxirida - saralash yo'nalishidan qat'i nazar.
     * Aks holda "eng kam iste'mol" so'ralganda ro'yxat boshini hisoboti
     * kelmagan TP lar egallab, haqiqiy javob ko'rinmay qolardi.
     */
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...out].sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      if (typeof x === 'string' && typeof y === 'string') {
        return x.localeCompare(y, 'uz') * dir;
      }
      return ((x as number) - (y as number)) * dir;
    });
  }, [all, search, sortKey, sortDir]);

  const sortBy = (key: SortKey): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(TEXT_KEYS.has(key) ? 'asc' : 'desc');
  };

  const dirty = search !== '' || sortKey !== DEFAULT_SORT || sortDir !== DEFAULT_DIR;

  const reset = (): void => {
    setSearch('');
    setSortKey(DEFAULT_SORT);
    setSortDir(DEFAULT_DIR);
  };

  if (monitoring.isLoading || monthly.isLoading || tpLoss.isLoading) {
    return <LoadingState rows={5} />;
  }

  const withData = (monthly.data ?? []).length;
  const consumers = (monthly.data ?? []).reduce((a, m) => a + m.consumersTotal, 0);
  // Jami foydali oqim - jadvaldagi ustun bilan BIR MANBADAN.
  const kwh = (tpLoss.data ?? []).reduce((a, l) => a + l.kwhConsumersAttached, 0);

  return (
    <>
      <PageHeader
        actions={<PeriodPicker />}
        subtitle={
          `${monitoring.data?.length ?? 0} ta transformator · ${num(consumers)} ta iste’molchi`
          + ` · ${num(kwh)} kWh oylik iste’mol`
        }
        title="Transformatorlar"
      />

      {/* ═══ Boshqaruv qatori ═══ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField
          aria-label="Qidirish"
          className="w-64"
          value={search}
          onChange={setSearch}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="TP kodi yoki hisoblagich raqami…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <Chip size="sm" variant="soft">
          <Chip.Label>
            {rows.length === all.length
              ? `${all.length} ta`
              : `${rows.length} / ${all.length} ta`}
          </Chip.Label>
        </Chip>

        {withData < (monitoring.data?.length ?? 0) && (
          <Chip color="warning" size="sm" variant="soft">
            <Chip.Label>
              {(monitoring.data?.length ?? 0) - withData} ta TP bo‘yicha hisobot yo‘q
            </Chip.Label>
          </Chip>
        )}

        {/* Tiklash tugmasi FAQAT biror narsa o'zgargan bo'lsa - bo'sh holatda shovqin qilmaydi. */}
        {dirty && (
          <Button className="rounded-lg" size="sm" variant="ghost" onPress={reset}>
            <RotateCcw className="size-3.5" />
            Tiklash
          </Button>
        )}
      </div>

      <Panel flush>
        {rows.length === 0 ? (
          <EmptyPanel
            message={search ? 'Shunday transformator topilmadi' : 'Ma’lumot yo‘q'}
          />
        ) : (
          <div className="scroll-y max-h-[70vh] overflow-x-auto">
            <table className="dt dt--compact dt--center min-w-4xl table-fixed">
              <thead>
                <tr>
                  <th className="w-[5%]">№</th>
                  {COLUMNS.map((c) => (
                    <SortTh
                      key={c.key}
                      dir={sortDir}
                      label={c.label}
                      sortKey={c.key}
                      width={c.width}
                      activeKey={sortKey}
                      onSort={sortBy}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.code}>
                    <td className="num text-[10.5px] text-muted">{i + 1}</td>
                    <td className="font-semibold text-accent">{r.code}</td>
                    <td className="num font-semibold">{num(r.consumersTotal)}</td>
                    <td className="num" style={{ color: 'var(--viz-good)' }}>
                      {num(r.consumersActive)}
                    </td>
                    <td
                      className="num"
                      style={r.consumersOff ? { color: 'var(--viz-critical)' } : undefined}
                      title={r.offShare === null ? undefined : `${pct(r.offShare, 1)} abonent`}
                    >
                      {num(r.consumersOff)}
                    </td>
                    <td className="num">{num(r.balanceKwh, 1)}</td>
                    <td className="num font-semibold">{num(r.soldKwh, 1)}</td>
                    {/*
                      Yo'qotish MANFIY bo'lishi mumkin - biriktirilgan
                      iste'molchilar balans hisoblagichidan ko'p chiqqanda.
                      Bu o'lchov nosozligining belgisi, shuning uchun raqam
                      yashirilmaydi va boshqa rangda ajratiladi.
                    */}
                    <td
                      className="num"
                      style={
                        r.lossKwh === null ? undefined
                          : { color: r.lossKwh < 0 ? 'var(--viz-warning)' : 'var(--viz-critical)' }
                      }
                    >
                      {num(r.lossKwh, 1)}
                    </td>
                    <td className="num text-muted">
                      {r.lossPct === null ? '-' : pct(r.lossPct, 1)}
                    </td>
                    <td className="num text-muted">
                      {r.share === null ? '-' : pct(r.share, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

/**
 * Vaqt qatori - ko'p seriyali chiziqli diagramma.
 *
 * Mark spetsifikatsiyasi (bir marta, `nivoTheme` bilan birga):
 *   • chiziq 2px, yumaloq uchli
 *   • nuqta faqat NUQTALAR KAM bo'lganda (90 kunlik qatorda har biri
 *     ko'rinsa shovqin bo'ladi) - surface rangli halqa bilan
 *   • maydon to'ldirish faqat "Sotilgan" seriyasida, gradient bilan
 *   • panjara faqat gorizontal, yupqa, TUTASH
 *   • o'q yorliqlari qisqartirilgan: `1.5M`, `900k`, `17-may`
 */
import type { TimeSeriesPoint } from '@beap/shared';
import { compact, dateDayMonthShort, dateLabel, energy, monthLabel, num, pct } from '@beap/shared';
import { ResponsiveLine } from '@nivo/line';
import { useMemo } from 'react';

import { nivoTheme, useVizTokens } from '../../lib/chart-theme.ts';
import { ChartFrame, type TableColumn } from './ChartFrame.tsx';

export type TrendBucket = 'day' | 'week' | 'month';

interface TrendLineProps {
  points: TimeSeriesPoint[];
  height?: number;
  /** Qaysi seriyalar ko'rsatilsin. */
  series?: ('kwhIn' | 'kwhSold' | 'kwhLoss' | 'lossPct')[];
  title?: string;
  subtitle?: string;
  csvName?: string;
  /** Nuqtalar qanday guruhlangan - o'q yorliqlari shunga qarab yoziladi. */
  bucket?: TrendBucket;
  /** Diagramma ustidagi qo'shimcha boshqaruv (masalan davr tanlagich). */
  actions?: React.ReactNode;
  /**
   * `SERIES_META` standart yorliqlarini bekor qiladi - masalan TP balans
   * grafigida "Tarmoqqa kirgan/Sotilgan" o'rniga "Balans hisoblagichi/
   * Bириктирилган iste'molchilar" ko'rsatish uchun. Berilmasa hozirgi
   * standart yorliqlar ishlatiladi - mavjud chaqiruvlarga ta'sir qilmaydi.
   */
  labels?: Partial<Record<keyof typeof SERIES_META, string>>;
}

/*
 * Rang biriktirilishi - MAKETDAGIDEK:
 *   tarmoqqa kirgan → ko'k   (--viz-1)
 *   sotilgan        → yashil (--viz-3)
 *   yo'qotish       → qizil  (--viz-5)
 *
 * Yo'qotish ilgari to'q sariq edi; qizil "yomon" degan ma'noni beradi va
 * status ranglari bilan bir xil tilda gapiradi.
 */
const SERIES_META = {
  kwhIn: { label: 'Tarmoqqa kirgan', unit: 'kWh', slot: 0 },
  kwhSold: { label: 'Sotilgan', unit: 'kWh', slot: 2 },
  kwhLoss: { label: 'Yo‘qotish', unit: 'kWh', slot: 4 },
  lossPct: { label: 'Yo‘qotish darajasi', unit: '%', slot: 4 },
} as const;

export function TrendLine({
  points, height = 260, series = ['kwhIn', 'kwhSold', 'kwhLoss'],
  title, subtitle, csvName = 'dinamika', bucket = 'day', actions, labels,
}: TrendLineProps) {
  const t = useVizTokens();

  const labelFor = (key: keyof typeof SERIES_META): string => labels?.[key] ?? SERIES_META[key].label;

  const { data, colors, legend, soldId } = useMemo(() => {
    const cols: string[] = [];
    const leg: { label: string; color: string }[] = [];
    let sold = '';

    const d = series.map((key) => {
      const meta = SERIES_META[key];
      const color = t.series[meta.slot]!;
      const id = `${labelFor(key)} (${meta.unit})`;
      if (key === 'kwhSold') sold = id;
      cols.push(color);
      leg.push({ label: id, color });
      return { id, color, data: points.map((p) => ({ x: p.date, y: p[key] })) };
    });

    return { data: d, colors: cols, legend: leg, soldId: sold };
  }, [points, series, t, labels]);

  const isPct = series.length === 1 && series[0] === 'lossPct';

  const columns: TableColumn<TimeSeriesPoint>[] = [
    { key: 'date', label: 'Sana', render: (r) => dateLabel(r.date), raw: (r) => dateLabel(r.date) },
    { key: 'in', label: `${labelFor('kwhIn')} (kWh)`, align: 'right', render: (r) => num(r.kwhIn, 0), raw: (r) => r.kwhIn },
    { key: 'sold', label: `${labelFor('kwhSold')} (kWh)`, align: 'right', render: (r) => num(r.kwhSold, 0), raw: (r) => r.kwhSold },
    { key: 'loss', label: `${labelFor('kwhLoss')} (kWh)`, align: 'right', render: (r) => num(r.kwhLoss, 0), raw: (r) => r.kwhLoss },
    { key: 'pct', label: `${labelFor('lossPct')} %`, align: 'right', render: (r) => pct(r.lossPct, 2), raw: (r) => r.lossPct },
  ];

  if (points.length === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted">Ma’lumot yo‘q</div>;
  }

  /*
   * O'q belgilarini siyraklashtirish.
   *
   * Chegara 9 emas, 6: panel maketda `xl:col-span-4` va diagrammaga ~280px
   * qoladi. To'qqizta «2-avg» yorliq bir-birini bosib ketardi (oxirgisi esa
   * kesilib, «8-avgus» bo'lib turardi). Oltitasi bemalol sig'adi va CHIZIQ
   * baribir HAMMA nuqtadan o'tadi - siyraklashuv faqat yozuvlarga tegishli.
   */
  const tickStep = Math.max(1, Math.ceil(points.length / 6));
  const tickValues = points.filter((_, i) => i % tickStep === 0).map((p) => p.date);

  /** Nuqtalar faqat qator qisqa bo'lganda - aks holda chiziq shovqinga aylanadi. */
  const showPoints = points.length <= 14;

  const axisFormat = (v: string): string =>
    bucket === 'month' ? monthLabel(v.slice(0, 7)) : dateDayMonthShort(v);

  return (
    <ChartFrame
      actions={actions}
      csvName={csvName}
      height={height}
      legend={legend}
      subtitle={subtitle}
      tableColumns={columns}
      tableData={points}
      title={title}
    >
      <ResponsiveLine
        /* Jonli kirish: nuqtalar kam (7 ta), shuning uchun arzon. */
        animate
        areaOpacity={1}
        axisBottom={{ tickSize: 0, tickPadding: 10, tickValues, format: axisFormat }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 10,
          tickValues: 5,
          format: (v: number) => (isPct ? `${v}%` : compact(v)),
        }}
        axisRight={null}
        axisTop={null}
        colors={colors}
        /*
         * `linear` - maketdagidek to'g'ri segmentlar.
         *
         * `monotoneX` silliq egri chizadi va nuqtalar orasida MAVJUD
         * BO'LMAGAN oraliq qiymatlarni ko'rsatib qo'yadi. Kunlik o'lchov
         * uchun bu noto'g'ri: 17-may va 18-may orasida o'lchov yo'q.
         */
        curve="linear"
        data={data}
        /*
         * Maydon to'ldirish FAQAT "Sotilgan" ostida.
         *
         * Nivo'da `enableArea` butun diagrammaga tegishli, shuning uchun
         * qolgan seriyalarga SHAFFOF gradient beramiz - aks holda uchala
         * chiziq ostidagi to'ldirishlar bir-birini bosib, loyqa bo'lardi.
         */
        defs={[
          {
            id: 'areaSold',
            type: 'linearGradient',
            // Maketdagidek TEKIS och yashil - pastga qarab so'nmaydi.
            colors: [
              { offset: 0, color: t.series[2]!, opacity: 0.14 },
              { offset: 100, color: t.series[2]!, opacity: 0.14 },
            ],
          },
          {
            id: 'areaNone',
            type: 'linearGradient',
            colors: [
              { offset: 0, color: t.series[0]!, opacity: 0 },
              { offset: 100, color: t.series[0]!, opacity: 0 },
            ],
          },
        ]}
        enableArea={isPct || Boolean(soldId)}
        enableGridX={false}
        enableGridY
        enablePoints={showPoints}
        enableSlices="x"
        fill={
          isPct
            ? [{ match: '*', id: 'areaSold' }]
            : [{ match: { id: soldId }, id: 'areaSold' }, { match: '*', id: 'areaNone' }]
        }
        lineWidth={2.5}
        margin={{ top: 12, right: 18, bottom: 34, left: 52 }}
        pointBorderColor={t.surface}
        pointBorderWidth={2}
        /*
         * `series.color` - NUQTALI yo'l, va u shart.
         *
         * Nivo `pointColor` ni nuqtaning O'ZIGA emas, `{ series, point }`
         * konteksti bo'yicha hisoblaydi (`PointColorContext`). Shuning uchun
         * `'color'` ham, `'seriesColor'` ham topilmaydi va rang `undefined`
         * bo'lib, nuqtalar QORA chiziladi. TypeScript buni ushlamaydi -
         * `from` oddiy `string`.
         *
         * `pointBorderColor` esa boshqacha: u nuqtaning o'ziga nisbatan
         * hisoblanadi, shuning uchun u yerda oddiy rang qiymati beriladi.
         */
        pointColor={{ from: 'series.color' }}
        pointSize={8}
        theme={nivoTheme(t)}
        useMesh
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false }}
        sliceTooltip={({ slice }) => (
          <div className="chart-tooltip">
            <span className="chart-tooltip__title">
              {dateLabel(String(slice.points[0]?.data.x ?? ''))}
            </span>
            <div className="flex flex-col gap-0.5">
              {slice.points.map((p) => (
                <div key={p.id} className="chart-tooltip__row">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ background: p.seriesColor }}
                    />
                    <span className="chart-tooltip__label">{p.seriesId}</span>
                  </span>
                  <span className="chart-tooltip__value">
                    {isPct ? pct(Number(p.data.y), 2) : energy(Number(p.data.y)).text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      />
    </ChartFrame>
  );
}

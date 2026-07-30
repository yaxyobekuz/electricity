/**
 * Qarzdorlik sahifasi.
 *
 * Qarzdorlik toifalar bo'yicha (aholi / yuridik / budjet) KIRITILADI,
 * jami esa `debt_total_mln` generated ustuni orqali hisoblanadi. Go'ravon
 * MFY hujjatidagi kabi tuman raqamlarini mahalla qatoriga ko'chirish
 * `IMPLAUSIBLE_DEBT` triggeri tomonidan bloklanadi.
 */
import { money, num, pct } from '@beap/shared';
import { Chip } from '@heroui/react';
import { Building2, CircleDollarSign, Landmark, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Donut } from '../../components/charts/Donut.tsx';
import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { MiniStat } from '../../components/ui/StatTile.tsx';
import { ReportMenu } from '../../components/ui/ReportMenu.tsx';
import { useDebt, useDistrictOverview } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  POPULATION: <Users className="size-4.5" />,
  LEGAL: <Building2 className="size-4.5" />,
  BUDGET: <Landmark className="size-4.5" />,
};

const CATEGORY_LABEL: Record<string, string> = {
  POPULATION: 'Aholi',
  LEGAL: 'Yuridik shaxs',
  BUDGET: 'Budjet tashkiloti',
};

export default function DebtPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const period = useUi((s) => s.period);

  const overview = useDistrictOverview(period ?? undefined);
  const debt = useDebt(period ?? undefined);

  if (overview.isLoading || debt.isLoading) {
    return (
      <>
        <PageHeader title={t('nav.debt')} />
        <LoadingState rows={5} />
      </>
    );
  }

  const totals = overview.data?.totals;
  const byCategory = debt.data?.byCategory ?? [];
  const topDebtors = debt.data?.topDebtors ?? [];
  const totalMln = debt.data?.totalMln ?? 0;

  const perConsumer =
    totals && totals.consumersTotal > 0 ? (totalMln * 1e6) / totals.consumersTotal : 0;

  return (
    <div className={overview.isFetching ? 'opacity-70 transition-opacity' : ''}>
      <PageHeader
        actions={
          <>
            <PeriodPicker />
            <ReportMenu />
          </>
        }
        subtitle="toifalar va yirik qarzdorlar kesimida"
        title={t('nav.debt')}
      />

      {/* ── Jami + toifalar ──────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          hint={`1 abonentga: ${num(perConsumer, 0)} so‘m`}
          icon={<CircleDollarSign className="size-4.5" />}
          label="Jami qarzdorlik"
          tone="critical"
          value={money(totalMln).text}
        />
        {byCategory.map((c) => (
          <MiniStat
            key={c.category}
            hint={`Ulushi: ${pct(c.pct, 1)}`}
            icon={CATEGORY_ICON[c.category]}
            label={CATEGORY_LABEL[c.category] ?? c.labelUz}
            tone={c.category === 'BUDGET' ? 'warning' : 'accent'}
            value={money(c.amountMln).text}
          />
        ))}
      </div>

      {/* ── Donut + TOP qarzdorlar ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-4" title="Toifalar bo‘yicha taqsimot">
          {byCategory.length > 0 ? (
            <Donut
              centerLabel="jami qarzdorlik"
              centerUnit={money(totalMln).unit}
              centerValue={num(money(totalMln).value, 1)}
              csvName="qarzdorlik-toifalar"
              formatValue={(v) => money(v).text}
              height={262}
              legendSide
              slices={byCategory.map((c) => ({
                id: c.category,
                label: c.labelUz,
                value: c.amountMln,
                display: money(c.amountMln).text,
              }))}
            />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel
          actions={
            <Chip size="sm" variant="soft">
              <Chip.Label>{num(topDebtors.length)} ta</Chip.Label>
            </Chip>
          }
          className="xl:col-span-8"
          flush
          subtitle="eng yirik qarzdor tashkilotlar"
          title="Qarzdorlar ro‘yxati"
        >
          {topDebtors.length > 0 ? (
            <div className="scroll-y max-h-125 overflow-x-auto">
              <table className="dt min-w-125">
                <thead>
                  <tr>
                    <th className="w-9 text-center">№</th>
                    <th>Qarzdor</th>
                    <th className="w-40">Mahalla</th>
                    <th className="w-32">Toifa</th>
                    <th className="w-28 text-right">Summa</th>
                    <th className="w-20 text-right">Ulushi</th>
                  </tr>
                </thead>
                <tbody>
                  {topDebtors.map((d) => (
                    <tr key={`${d.rank}-${d.debtorName}`}>
                      <td className="num text-center text-muted">{d.rank}</td>
                      <td className="truncate font-medium" title={d.debtorName}>
                        {d.debtorName}
                      </td>
                      <td className="truncate text-muted">{d.mfyName}</td>
                      <td>
                        <Chip className="whitespace-nowrap" size="sm" variant="soft">
                          <Chip.Label>{CATEGORY_LABEL[d.category] ?? d.category}</Chip.Label>
                        </Chip>
                      </td>
                      <td className="num whitespace-nowrap font-semibold">
                        {money(d.amountMln).text}
                      </td>
                      <td className="num whitespace-nowrap text-muted">
                        {totalMln > 0 ? pct((d.amountMln / totalMln) * 100, 1) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted">
        Qarzdorlik toifalar kesimida kiritiladi, jami qiymat esa ma’lumotlar bazasida
        hisoblanadi — uni qo‘lda yozishning imkoni yo‘q.{' '}
        <button
          className="font-semibold text-accent hover:underline"
          type="button"
          onClick={() => void navigate('/passport')}
        >
          Pasportda ko‘rish
        </button>
      </p>
    </div>
  );
}

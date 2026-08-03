/**
 * Ilova qobig'i.
 *
 * Dizayn: oq yon panel + brendlangan logotip bloki + ko'k "tabletka"
 * ko'rinishidagi faol menyu bandi. Pastda samaradorlik indeksi kartasi.
 * Kontent maydoni yumshoq ko'k fonda, kartalar soya bilan "suzadi".
 */
import { dateLabel, dateTimeLabel, pct } from '@beap/shared';
import { Button, Calendar, Chip, Dropdown, Popover, Tooltip, cn } from '@heroui/react';
import { parseDate } from '@internationalized/date';
import {
  Activity, ArrowDown, ArrowUp, BarChart3, Bell, Building2, CalendarDays,
  CircleDollarSign, ClipboardCheck, ClipboardList, FileSpreadsheet, Home, Languages,
  LogOut, Menu, Moon, Ruler, ScrollText, Sun, TriangleAlert, Zap,
} from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router';

import robotUrl from '../../assets/robot.png';
import { AiAssistant } from '../ai/AiAssistant.tsx';
import { LANGUAGES, setLanguage, type LanguageCode } from '../../i18n/index.ts';
import { apiUrl } from '../../lib/api.ts';
import { useBootstrap, useEfficiency } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

interface NavItem {
  to: string;
  labelKey: string;
  icon: ReactNode;
  roles?: string[];
}

/**
 * Sahifa sarlavhasi YUQORI CHIZIQNING ichiga chiqadi.
 *
 * Sabab: sarlavha alohida band bo'lganda ekranning ~90px i faqat matnga
 * ketardi va kontent pastga siljib, kam ma'lumot keng maydonga yoyilgan
 * ko'rinish hosil bo'lardi. Endi sarlavha, yo'l va sahifa amallari
 * global boshqaruv elementlari bilan BITTA qatorda turadi.
 */
const HeaderSlot = createContext<HTMLElement | null>(null);

/**
 * Pastki chiziqdagi bo'sh joy — sahifaga oid izoh shu yerga tushadi.
 *
 * Aks holda izoh kontentning oxirida ALOHIDA qator bo'lib, uning ostida
 * yana footer turadi: ekranning pastida ikkita deyarli bo'sh qator.
 */
const FooterSlot = createContext<HTMLElement | null>(null);

/*
 * Menyu — FIDER darajasidagi tizim uchun.
 *
 * Mahallalar ro'yxati, yo'qotish reytingi, qarzdorlik va tuman pasporti
 * olib tashlandi: ular 22 mahallani solishtirish uchun edi, bitta fider
 * doirasida esa solishtiradigan narsa yo'q.
 */
const NAV: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: <Home className="size-4.5" /> },
  { to: '/transformers', labelKey: 'nav.transformers', icon: <Zap className="size-4.5" /> },
  { to: '/energy-balance', labelKey: 'nav.energyBalance', icon: <Activity className="size-4.5" /> },
  { to: '/works', labelKey: 'nav.plannedWorks', icon: <ClipboardList className="size-4.5" /> },
  { to: '/reports', labelKey: 'nav.reports', icon: <FileSpreadsheet className="size-4.5" /> },
  {
    to: '/entry', labelKey: 'nav.entry', icon: <ClipboardCheck className="size-4.5" />,
    roles: ['mfy_operator', 'elektroset_manager', 'admin'],
  },
  {
    to: '/review', labelKey: 'nav.review', icon: <Bell className="size-4.5" />,
    roles: ['elektroset_manager', 'admin'],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme, sidebarOpen, toggleSidebar, user, setUser, period } = useUi();
  const { data: boot } = useBootstrap();
  const efficiency = useEfficiency(period ?? undefined);
  const location = useLocation();
  const navigate = useNavigate();
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);

  const visibleNav = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* ═══════════════ YON PANEL ═══════════════ */}
      <aside
        className={cn(
          'sticky top-0 z-30 flex h-dvh shrink-0 flex-col bg-surface transition-[width] duration-200',
          sidebarOpen ? 'w-60' : 'w-17',
        )}
      >
        {/* Brend bloki */}
        <div className={cn('flex items-center gap-3 px-4 py-5', !sidebarOpen && 'justify-center px-0')}>
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
            style={{
              background: 'linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 70%, #7c3aed))',
              boxShadow: '0 6px 16px color-mix(in oklab, var(--accent) 38%, transparent)',
            }}
          >
            <Zap className="size-6" fill="currentColor" strokeWidth={1.5} />
          </span>
          {sidebarOpen && (
            <div className="min-w-0">
              <p className="text-[19px] font-extrabold leading-none tracking-tight text-accent">
                BALIQCHI
              </p>
              <p className="mt-1 text-[9.5px] font-semibold uppercase leading-[1.35] tracking-wide text-muted">
                Elektr energiya
                <br />
                nazorat tizimi
              </p>
            </div>
          )}
        </div>

        {/* Menyu */}
        <nav aria-label="Asosiy menyu" className="scroll-y px-3 pb-3">
          <ul className="flex flex-col gap-1">
            {visibleNav.map((item) => {
              const active =
                location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
              const link = (
                <NavLink
                  className={cn('nav-item', active && 'nav-item--active', !sidebarOpen && 'justify-center px-0')}
                  to={item.to}
                >
                  {item.icon}
                  {sidebarOpen && <span className="truncate">{t(item.labelKey)}</span>}
                </NavLink>
              );

              return (
                <li key={item.to}>
                  {sidebarOpen ? (
                    link
                  ) : (
                    <Tooltip delay={200}>
                      {link}
                      <Tooltip.Content>{t(item.labelKey)}</Tooltip.Content>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Samaradorlik indeksi va tavsiya kartalari */}
        {sidebarOpen && efficiency.data && (
          <div className="flex flex-col flex-1 gap-3 px-3 pb-10">
            <EfficiencyMiniCard
              prevScore={efficiency.data.prevScore}
              score={efficiency.data.score}
            />
            {efficiency.data.advice && (
              <AdviceCard
                advice={efficiency.data.advice}
                onOpen={() => void navigate('/energy-balance')}
              />
            )}
          </div>
        )}

        {/* Ma'lumot yangilanganlik belgisi — ishonch uchun */}
        {sidebarOpen && boot?.lastRefreshAt && (
          <div className="px-5 pb-4">
            <p className="text-[10px] leading-tight text-muted">
              {t('common.updatedAt')}:{' '}
              <span className="font-semibold text-foreground">
                {dateTimeLabel(boot.lastRefreshAt)}
              </span>
            </p>
          </div>
        )}
      </aside>

      {/* ═══════════════ ASOSIY MAYDON ═══════════════ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 bg-background/85 px-4 py-2 backdrop-blur-md">
          <Button
            isIconOnly
            aria-label="Menyu"
            className="rounded-lg"
            size="sm"
            variant="ghost"
            onPress={toggleSidebar}
          >
            <Menu className="size-4" />
          </Button>

          {/* Sahifa sarlavhasi va amallari shu yerga portal orqali tushadi */}
          <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center" />

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Hisobot sanasi — bosiladi, kalendar ochiladi */}
            {boot?.dataRange.maxDate && boot.dataRange.minDate && (
              <AsOfDatePicker maxDate={boot.dataRange.maxDate} minDate={boot.dataRange.minDate} />
            )}

            {/* Til */}
            <Dropdown>
              <Button aria-label={t('common.language')} className="rounded-lg" size="sm" variant="ghost">
                <Languages className="size-4" />
                <span className="ml-1 hidden text-[11px] font-semibold sm:inline">
                  {LANGUAGES.find((l) => l.code === i18n.language)?.short ?? 'LOT'}
                </span>
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={new Set([i18n.language])}
                  selectionMode="single"
                  onAction={(key) => setLanguage(key as LanguageCode)}
                >
                  {LANGUAGES.map((l) => (
                    <Dropdown.Item key={l.code} id={l.code} textValue={l.label}>
                      {l.label}
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>

            {/* Tema */}
            <Button
              isIconOnly
              aria-label={t('common.theme')}
              className="rounded-lg"
              size="sm"
              variant="ghost"
              onPress={toggleTheme}
            >
              {theme === 'gov-dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>

            {/* Foydalanuvchi */}
            {user ? (
              <Dropdown>
                <Button className="rounded-lg bg-surface px-2 shadow-surface" size="sm" variant="ghost">
                  <span
                    className="mr-1.5 flex size-6.5 items-center justify-center rounded-md text-[11px] font-bold text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    {user.fullName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden text-left xl:block">
                    <span className="block text-[11.5px] font-semibold leading-tight">
                      {user.fullName}
                    </span>
                    <span className="block text-[10px] leading-tight text-muted">
                      {t(`role.${user.role}`)}
                    </span>
                  </span>
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu
                    onAction={(key) => {
                      if (key === 'logout') {
                        void fetch(apiUrl('/auth/logout'), {
                          method: 'POST',
                          credentials: 'include',
                        });
                        setUser(null);
                        window.location.href = '/login';
                      }
                    }}
                  >
                    <Dropdown.Item id="logout" textValue={t('common.logout')} variant="danger">
                      <LogOut className="size-4" />
                      {t('common.logout')}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            ) : (
              <Button
                className="rounded-lg"
                size="sm"
                variant="primary"
                onPress={() => {
                  window.location.href = '/login';
                }}
              >
                {t('common.login')}
              </Button>
            )}
          </div>
        </header>

        <HeaderSlot.Provider value={headerSlot}>
          <FooterSlot.Provider value={footerSlot}>
            <main className="min-w-0 flex-1 px-4 pb-4">{children}</main>
          </FooterSlot.Provider>
        </HeaderSlot.Provider>

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 pb-3 text-[10.5px] text-muted">
          <span>© {new Date().getFullYear()} {t('app.footer')}</span>
          {/* `contents` — o'ram quti hosil qilmaydi, izoh footer qatorining bandi bo'ladi. */}
          <div ref={setFooterSlot} className="contents" />
          <span className="flex items-center gap-3">
            <Chip size="sm" variant="soft">
              <Chip.Label>Offline rejim</Chip.Label>
            </Chip>
            <span>{t('app.version')} 1.0.0</span>
          </span>
        </footer>
      </div>

      {/*
        AI yordamchi — qobiqning ichida, lekin `fixed` joylashuvda: sahifa
        almashganda panel yopilmaydi va suhbat uzilmaydi.
      */}
      <AiAssistant />
    </div>
  );
}

/**
 * Hisobot sanasi tanlagich — yuqori chiziqdagi ixcham "tabletka".
 *
 * Kalendar FAQAT ma'lumot mavjud oraliqni ochadi (`minDate…maxDate`):
 * bo'sh kunni tanlash mumkin bo'lsa, hokim bo'sh dashboard ko'rib
 * "tizim ishlamayapti" degan xulosaga kelardi.
 *
 * Sana tanlanganda `setAsOfDate` davrni ham o'sha oyga ko'chiradi, ya'ni
 * oylik kartalar ham, kunlik grafiklar ham bir vaqtga tegishli bo'ladi.
 */
function AsOfDatePicker({ minDate, maxDate }: { minDate: string; maxDate: string }) {
  const asOfDate = useUi((s) => s.asOfDate);
  const setAsOfDate = useUi((s) => s.setAsOfDate);
  const [open, setOpen] = useState(false);

  const current = asOfDate ?? maxDate;

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      {/*
        Tugma `Popover` ning BEVOSITA farzandi — HeroUI uni tetik deb oladi.
        Shu sababli ko'rinish to'liq shu yerda boshqariladi va yuqori
        chiziqdagi boshqa "tabletka" lar bilan bir xil bo'ladi.
      */}
      <Button
        aria-label="Hisobot sanasi"
        className="hidden rounded-lg bg-surface px-2.5 text-[11px] font-medium shadow-surface lg:inline-flex"
        size="sm"
        variant="ghost"
      >
        <CalendarDays className="size-3.5 text-muted" />
        {dateLabel(current)}
        {asOfDate && <span className="text-[10px] font-semibold text-accent">holatiga</span>}
      </Button>

      <Popover.Content className="w-auto">
        <Popover.Dialog className="p-2">
          <Calendar
            aria-label="Hisobot sanasi"
            maxValue={parseDate(maxDate)}
            minValue={parseDate(minDate)}
            value={parseDate(current)}
            onChange={(d) => {
              if (!d) return;
              setAsOfDate(d.toString());
              setOpen(false);
            }}
          >
            <Calendar.Header>
              <Calendar.Heading />
              <Calendar.NavButton slot="previous" />
              <Calendar.NavButton slot="next" />
            </Calendar.Header>
            <Calendar.Grid>
              <Calendar.GridHeader>
                {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
              </Calendar.GridHeader>
              <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
            </Calendar.Grid>
          </Calendar>

          {/* Oxirgi kunga qaytish — "eng so'nggi holat" odatiy ko'rinish */}
          {asOfDate && (
            <Button
              className="mt-1 w-full"
              size="sm"
              variant="ghost"
              onPress={() => {
                setAsOfDate(null);
                setOpen(false);
              }}
            >
              Eng so‘nggi kun ({dateLabel(maxDate)})
            </Button>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/**
 * Yon paneldagi samaradorlik indeksi — gradient ko'k karta.
 *
 * Baho YARIM DOIRADA: chiziqli "progress" bandidan farqli o'laroq, yarim
 * doira 0–100 shkalani bir qarashda ko'rsatadi va markazda katta raqamga
 * joy qoldiradi — yon panel tor bo'lgani uchun bu muhim.
 */
function EfficiencyMiniCard({ score, prevScore }: { score: number; prevScore: number | null }) {
  const label =
    score >= 85 ? 'Yaxshi' : score >= 70 ? 'Qoniqarli' : score >= 50 ? 'Past' : 'Tanqidiy';
  const face = score >= 85 ? '🙂' : score >= 70 ? '😐' : '☹️';

  // Yoy uzunligi: r = 46, yarim doira ⇒ π·r ≈ 144.5
  const ARC = Math.PI * 46;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * ARC;

  const deltaPct =
    prevScore === null || prevScore === 0 ? null : ((score - prevScore) / prevScore) * 100;

  return (
    <div
      className="rounded-xl px-4 pb-3.5 pt-3 text-white"
      style={{
        background: 'linear-gradient(150deg, var(--accent), color-mix(in oklab, var(--accent) 62%, #7c3aed))',
        boxShadow: '0 8px 22px color-mix(in oklab, var(--accent) 32%, transparent)',
      }}
    >
      <p className="text-[10.5px] font-semibold leading-tight opacity-85">
        Energiya samaradorlik indeksi
      </p>

      <div className="relative mx-auto mt-1 w-29">
        <svg className="block w-full" viewBox="0 0 116 62" aria-hidden="true">
          <path
            d="M 12 56 A 46 46 0 0 1 104 56"
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeLinecap="round"
            strokeWidth="9"
          />
          <path
            d="M 12 56 A 46 46 0 0 1 104 56"
            fill="none"
            stroke="#ffffff"
            strokeDasharray={`${filled} ${ARC}`}
            strokeLinecap="round"
            strokeWidth="9"
            style={{ transition: 'stroke-dasharray 0.7s ease' }}
          />
        </svg>

        <div className="absolute inset-x-0 bottom-1 text-center">
          <span className="tabular text-[26px] font-extrabold leading-none">
            {score.toFixed(0)}
          </span>
          <span className="text-[11px] font-medium opacity-80">/100</span>
        </div>
      </div>

      <p className="mt-1 flex items-center justify-center gap-1 text-[11.5px] font-semibold">
        <span aria-hidden="true">{face}</span> {label}
      </p>

      {/* O'tgan davr bilan solishtirish — baho yolg'iz o'zi trendni aytmaydi */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[10.5px]">
        <span className="opacity-85">
          O‘tgan oy: <span className="tabular font-semibold">{prevScore?.toFixed(0) ?? '—'}</span>
        </span>
        {deltaPct !== null && (
          <span className="tabular flex items-center gap-0.5 font-semibold">
            {deltaPct >= 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[10px] opacity-80">Maqsad: 90+</p>
    </div>
  );
}

/**
 * Tavsiya kartasi.
 *
 * DIQQAT: "AI" — bu yerda faqat KO'RINISH nomi. Tagida hech qanday model
 * yo'q: fiderning normadan oshgani SQL qoidasi bilan aniqlanadi va normativ
 * daraja `TOTAL_LOSS_TARGET_PCT` me'yoridan olinadi. Shu sababli raqamni
 * har doim izohlab berish mumkin.
 */
function AdviceCard({
  advice, onOpen,
}: {
  advice: { count: number; targetLossPct: number; currentLossPct: number };
  onOpen: () => void;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3.5 text-white"
      style={{
        background: 'linear-gradient(150deg, color-mix(in oklab, var(--accent) 88%, #0ea5e9), var(--accent))',
        boxShadow: '0 8px 22px color-mix(in oklab, var(--accent) 28%, transparent)',
      }}
    >
      <p className="text-[11px] font-semibold leading-tight opacity-90">AI tavsiya (bugun)</p>

      <div className="mt-1.5 flex items-end gap-2">
        {/*
          Robot — bezak, ma'no tashimaydi: `alt=""` va `aria-hidden`,
          shuning uchun skrinrider uni o'qimaydi va matn takrorlanmaydi.
        */}
        <img
          alt=""
          aria-hidden="true"
          className="-mb-1 w-15 shrink-0 select-none"
          src={robotUrl}
        />

        <p className="min-w-0 flex-1 text-[11px] font-medium leading-snug">
          {advice.count > 0 ? (
            <>
              Yo‘qotish normadan yuqori:{' '}
              <span className="font-bold">{pct(advice.currentLossPct, 1)}</span>. Normativ daraja —{' '}
              <span className="font-bold">{pct(advice.targetLossPct, 1)}</span>.
            </>
          ) : (
            <>
              Yo‘qotish normativ darajada
              (<span className="font-bold">{pct(advice.targetLossPct, 1)}</span>) — qo‘shimcha
              tavsiya yo‘q.
            </>
          )}
        </p>
      </div>

      <Button
        className="mt-2.5 w-full bg-white text-accent hover:bg-white/90"
        size="sm"
        variant="secondary"
        onPress={onOpen}
      >
        Batafsil
      </Button>
    </div>
  );
}

/**
 * Sahifaga oid izoh — PASTKI CHIZIQ ichida ko'rsatiladi (portal orqali).
 *
 * Qobiq tashqarisida (masalan chop etish sahifasida) hech narsa chizmaydi.
 */
export function FooterNote({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  if (!slot) return null;
  return createPortal(
    <span className="flex min-w-0 items-center gap-1.5">{children}</span>,
    slot,
  );
}

/**
 * Sahifa sarlavhasi — YUQORI CHIZIQ ichida ko'rsatiladi (portal orqali).
 *
 * Sarlavha, yo'l va sahifa amallari bitta ixcham qatorda: shu tufayli
 * kontent maydoni to'liq diagramma va jadvallarga qoladi.
 */
export function PageHeader({
  title, subtitle, breadcrumbs, actions,
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; to?: string }[];
  actions?: ReactNode;
}) {
  const slot = useContext(HeaderSlot);

  const content = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="truncate text-[17px] font-extrabold leading-tight tracking-tight text-accent">
          {title}
        </h2>

        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            aria-label="Yo‘l"
            className="hidden min-w-0 items-center gap-1.5 text-[11.5px] text-muted lg:flex"
          >
            <Building2 className="size-3.5 shrink-0 text-accent" />
            {breadcrumbs.map((b, i) => (
              <span key={b.label} className="flex shrink-0 items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="text-muted/60">›</span>}
                {b.to ? (
                  <NavLink className="font-medium hover:text-accent hover:underline" to={b.to}>
                    {b.label}
                  </NavLink>
                ) : (
                  <span className="font-medium text-foreground">{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        {subtitle && !breadcrumbs && (
          <p className="hidden truncate text-[11.5px] text-muted lg:block">{subtitle}</p>
        )}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );

  // Qobiq tashqarisida (chop etish sahifasi) — oddiy blok sifatida chiqadi.
  return slot ? createPortal(content, slot) : <div className="mb-3 flex">{content}</div>;
}

/** Xato holati. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="panel items-center gap-3 px-6 py-12 text-center">
      <TriangleAlert className="size-9 text-danger" />
      <p className="text-sm font-semibold">{t('common.error')}</p>
      <p className="max-w-md text-xs text-muted">{message}</p>
      {onRetry && (
        <Button className="rounded-xl" size="sm" variant="secondary" onPress={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/** Yuklanish holati — faqat BIRINCHI yuklashda ko'rsatiladi. */
export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}

export { Ruler as RulerIcon };

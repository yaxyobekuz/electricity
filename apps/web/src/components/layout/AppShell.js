/**
 * Ilova qobig'i.
 *
 * Dizayn: oq yon panel + brendlangan logotip bloki + ko'k "tabletka"
 * ko'rinishidagi faol menyu bandi. Pastda samaradorlik indeksi kartasi.
 * Kontent maydoni yumshoq ko'k fonda, kartalar soya bilan "suzadi".
 */
import { dateLabel, dateTimeLabel } from '@beap/shared';
import { Button, Chip, Dropdown, Tooltip, cn } from '@heroui/react';
import { Activity, BarChart3, Bell, Building2, CalendarDays, CircleDollarSign, ClipboardCheck, ClipboardList, FileSpreadsheet, Home, Languages, LogOut, Menu, Moon, Ruler, ScrollText, Sun, TriangleAlert, Zap, } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { LANGUAGES, setLanguage } from '../../i18n/index.ts';
import { apiUrl } from '../../lib/api.ts';
import { useBootstrap, useEfficiency } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';
/**
 * Sahifa sarlavhasi YUQORI CHIZIQNING ichiga chiqadi.
 *
 * Sabab: sarlavha alohida band bo'lganda ekranning ~90px i faqat matnga
 * ketardi va kontent pastga siljib, kam ma'lumot keng maydonga yoyilgan
 * ko'rinish hosil bo'lardi. Endi sarlavha, yo'l va sahifa amallari
 * global boshqaruv elementlari bilan BITTA qatorda turadi.
 */
const HeaderSlot = createContext(null);
const NAV = [
    { to: '/dashboard', labelKey: 'nav.dashboard', icon: <Home className="size-4.5"/> },
    { to: '/mahallalar', labelKey: 'nav.mahallalar', icon: <Building2 className="size-4.5"/> },
    { to: '/transformers', labelKey: 'nav.transformers', icon: <Zap className="size-4.5"/> },
    { to: '/energy-balance', labelKey: 'nav.energyBalance', icon: <Activity className="size-4.5"/> },
    { to: '/losses', labelKey: 'nav.losses', icon: <BarChart3 className="size-4.5"/> },
    { to: '/debt', labelKey: 'nav.debt', icon: <CircleDollarSign className="size-4.5"/> },
    { to: '/works', labelKey: 'nav.plannedWorks', icon: <ClipboardList className="size-4.5"/> },
    { to: '/passport', labelKey: 'nav.passport', icon: <ScrollText className="size-4.5"/> },
    { to: '/reports', labelKey: 'nav.reports', icon: <FileSpreadsheet className="size-4.5"/> },
    {
        to: '/entry', labelKey: 'nav.entry', icon: <ClipboardCheck className="size-4.5"/>,
        roles: ['mfy_operator', 'elektroset_manager', 'admin'],
    },
    {
        to: '/review', labelKey: 'nav.review', icon: <Bell className="size-4.5"/>,
        roles: ['elektroset_manager', 'admin'],
    },
];
export function AppShell({ children }) {
    const { t, i18n } = useTranslation();
    const { theme, toggleTheme, sidebarOpen, toggleSidebar, user, setUser, period } = useUi();
    const { data: boot } = useBootstrap();
    const efficiency = useEfficiency(period ?? undefined);
    const location = useLocation();
    const [headerSlot, setHeaderSlot] = useState(null);
    const visibleNav = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
    return (<div className="flex min-h-dvh bg-background text-foreground">
      {/* ═══════════════ YON PANEL ═══════════════ */}
      <aside className={cn('sticky top-0 z-30 flex h-dvh shrink-0 flex-col bg-surface transition-[width] duration-200', sidebarOpen ? 'w-60' : 'w-17')}>
        {/* Brend bloki */}
        <div className={cn('flex items-center gap-3 px-4 py-5', !sidebarOpen && 'justify-center px-0')}>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white" style={{
            background: 'linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 70%, #7c3aed))',
            boxShadow: '0 6px 16px color-mix(in oklab, var(--accent) 38%, transparent)',
        }}>
            <Zap className="size-6" fill="currentColor" strokeWidth={1.5}/>
          </span>
          {sidebarOpen && (<div className="min-w-0">
              <p className="text-[19px] font-extrabold leading-none tracking-tight text-accent">
                BALIQCHI
              </p>
              <p className="mt-1 text-[9.5px] font-semibold uppercase leading-[1.35] tracking-wide text-muted">
                Elektr energiya
                <br />
                nazorat tizimi
              </p>
            </div>)}
        </div>

        {/* Menyu */}
        <nav aria-label="Asosiy menyu" className="scroll-y flex-1 px-3 pb-3">
          <ul className="flex flex-col gap-1">
            {visibleNav.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            const link = (<NavLink className={cn('nav-item', active && 'nav-item--active', !sidebarOpen && 'justify-center px-0')} to={item.to}>
                  {item.icon}
                  {sidebarOpen && <span className="truncate">{t(item.labelKey)}</span>}
                </NavLink>);
            return (<li key={item.to}>
                  {sidebarOpen ? (link) : (<Tooltip delay={200}>
                      {link}
                      <Tooltip.Content>{t(item.labelKey)}</Tooltip.Content>
                    </Tooltip>)}
                </li>);
        })}
          </ul>
        </nav>

        {/* Samaradorlik indeksi kartasi */}
        {sidebarOpen && efficiency.data && (<div className="px-3 pb-3">
            <EfficiencyMiniCard score={efficiency.data.score}/>
          </div>)}

        {/* Ma'lumot yangilanganlik belgisi — ishonch uchun */}
        {sidebarOpen && boot?.lastRefreshAt && (<div className="px-5 pb-4">
            <p className="text-[10px] leading-tight text-muted">
              {t('common.updatedAt')}:{' '}
              <span className="font-semibold text-foreground">
                {dateTimeLabel(boot.lastRefreshAt)}
              </span>
            </p>
          </div>)}
      </aside>

      {/* ═══════════════ ASOSIY MAYDON ═══════════════ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 bg-background/85 px-4 py-2 backdrop-blur-md">
          <Button isIconOnly aria-label="Menyu" className="rounded-lg" size="sm" variant="ghost" onPress={toggleSidebar}>
            <Menu className="size-4"/>
          </Button>

          {/* Sahifa sarlavhasi va amallari shu yerga portal orqali tushadi */}
          <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center"/>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Sana */}
            {boot?.dataRange.maxDate && (<span className="hidden items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-[11px] font-medium shadow-surface lg:inline-flex">
                <CalendarDays className="size-3.5 text-muted"/>
                {dateLabel(boot.dataRange.maxDate)}
              </span>)}

            {/* Til */}
            <Dropdown>
              <Button aria-label={t('common.language')} className="rounded-lg" size="sm" variant="ghost">
                <Languages className="size-4"/>
                <span className="ml-1 hidden text-[11px] font-semibold sm:inline">
                  {LANGUAGES.find((l) => l.code === i18n.language)?.short ?? 'LOT'}
                </span>
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu selectedKeys={new Set([i18n.language])} selectionMode="single" onAction={(key) => setLanguage(key)}>
                  {LANGUAGES.map((l) => (<Dropdown.Item key={l.code} id={l.code} textValue={l.label}>
                      {l.label}
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>

            {/* Tema */}
            <Button isIconOnly aria-label={t('common.theme')} className="rounded-lg" size="sm" variant="ghost" onPress={toggleTheme}>
              {theme === 'gov-dark' ? <Sun className="size-4"/> : <Moon className="size-4"/>}
            </Button>

            {/* Foydalanuvchi */}
            {user ? (<Dropdown>
                <Button className="rounded-lg bg-surface px-2 shadow-surface" size="sm" variant="ghost">
                  <span className="mr-1.5 flex size-6.5 items-center justify-center rounded-md text-[11px] font-bold text-white" style={{ background: 'var(--accent)' }}>
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
                  <Dropdown.Menu onAction={(key) => {
                if (key === 'logout') {
                    void fetch(apiUrl('/auth/logout'), {
                        method: 'POST',
                        credentials: 'include',
                    });
                    setUser(null);
                    window.location.href = '/login';
                }
            }}>
                    <Dropdown.Item id="logout" textValue={t('common.logout')} variant="danger">
                      <LogOut className="size-4"/>
                      {t('common.logout')}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>) : (<Button className="rounded-lg" size="sm" variant="primary" onPress={() => {
                window.location.href = '/login';
            }}>
                {t('common.login')}
              </Button>)}
          </div>
        </header>

        <HeaderSlot.Provider value={headerSlot}>
          <main className="min-w-0 flex-1 px-4 pb-4">{children}</main>
        </HeaderSlot.Provider>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-[10.5px] text-muted">
          <span>© {new Date().getFullYear()} {t('app.footer')}</span>
          <span className="flex items-center gap-3">
            <Chip size="sm" variant="soft">
              <Chip.Label>Offline rejim</Chip.Label>
            </Chip>
            <span>{t('app.version')} 1.0.0</span>
          </span>
        </footer>
      </div>
    </div>);
}
/** Yon paneldagi samaradorlik indeksi — gradient ko'k karta. */
function EfficiencyMiniCard({ score }) {
    const label = score >= 85 ? 'Yaxshi' : score >= 70 ? 'Qoniqarli' : score >= 50 ? 'Past' : 'Tanqidiy';
    const pctOfArc = Math.max(0, Math.min(100, score));
    return (<div className="rounded-xl px-4 py-3.5 text-white" style={{
            background: 'linear-gradient(150deg, var(--accent), color-mix(in oklab, var(--accent) 62%, #7c3aed))',
            boxShadow: '0 8px 22px color-mix(in oklab, var(--accent) 32%, transparent)',
        }}>
      <p className="text-[10.5px] font-semibold uppercase leading-tight tracking-wide opacity-85">
        Energiya samaradorlik indeksi
      </p>

      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[28px] font-extrabold leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {score.toFixed(0)}
        </span>
        <span className="text-xs font-medium opacity-80">/100</span>
        <span className="ml-auto text-[11px] font-semibold">{label}</span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
        <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${pctOfArc}%` }}/>
      </div>

      <p className="mt-2 text-[10px] opacity-80">Maqsad: 90+</p>
    </div>);
}
/**
 * Sahifa sarlavhasi — YUQORI CHIZIQ ichida ko'rsatiladi (portal orqali).
 *
 * Sarlavha, yo'l va sahifa amallari bitta ixcham qatorda: shu tufayli
 * kontent maydoni to'liq diagramma va jadvallarga qoladi.
 */
export function PageHeader({ title, subtitle, breadcrumbs, actions, }) {
    const slot = useContext(HeaderSlot);
    const content = (<div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="truncate text-[17px] font-extrabold leading-tight tracking-tight text-accent">
          {title}
        </h2>

        {breadcrumbs && breadcrumbs.length > 0 && (<nav aria-label="Yo‘l" className="hidden min-w-0 items-center gap-1.5 text-[11.5px] text-muted lg:flex">
            <Building2 className="size-3.5 shrink-0 text-accent"/>
            {breadcrumbs.map((b, i) => (<span key={b.label} className="flex shrink-0 items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="text-muted/60">›</span>}
                {b.to ? (<NavLink className="font-medium hover:text-accent hover:underline" to={b.to}>
                    {b.label}
                  </NavLink>) : (<span className="font-medium text-foreground">{b.label}</span>)}
              </span>))}
          </nav>)}

        {subtitle && !breadcrumbs && (<p className="hidden truncate text-[11.5px] text-muted lg:block">{subtitle}</p>)}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>);
    // Qobiq tashqarisida (chop etish sahifasi) — oddiy blok sifatida chiqadi.
    return slot ? createPortal(content, slot) : <div className="mb-3 flex">{content}</div>;
}
/** Xato holati. */
export function ErrorState({ message, onRetry }) {
    const { t } = useTranslation();
    return (<div className="panel items-center gap-3 px-6 py-12 text-center">
      <TriangleAlert className="size-9 text-danger"/>
      <p className="text-sm font-semibold">{t('common.error')}</p>
      <p className="max-w-md text-xs text-muted">{message}</p>
      {onRetry && (<Button className="rounded-xl" size="sm" variant="secondary" onPress={onRetry}>
          {t('common.retry')}
        </Button>)}
    </div>);
}
/** Yuklanish holati — faqat BIRINCHI yuklashda ko'rsatiladi. */
export function LoadingState({ rows = 4 }) {
    return (<div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (<div key={i} className="h-20 animate-pulse rounded-xl bg-surface"/>))}
    </div>);
}
export { Ruler as RulerIcon };

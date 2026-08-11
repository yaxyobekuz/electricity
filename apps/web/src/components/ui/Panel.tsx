/** Dashboard paneli - barcha kartalarning yagona ramkasi. */
import { cn } from '@heroui/react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Sarlavha qatoridagi BO'SH JOY - panel ichidagi diagramma o'z boshqaruv
 * tugmalarini (jadval/diagramma almashtirgichi, CSV) shu yerga portal orqali
 * ko'chiradi.
 *
 * Shuning uchun: har bir kartada BITTA qator - chapda sarlavha, o'ngda barcha
 * tugmalar. Ilgari tugmalar diagramma ustida alohida qator egallab turardi.
 */
const PanelHeaderSlotContext = createContext<HTMLElement | null>(null);

/** Panel sarlavhasidagi portal nishoni (panel tashqarisida `null`). */
export function usePanelHeaderSlot(): HTMLElement | null {
  return useContext(PanelHeaderSlotContext);
}

interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Ichki chetlashsiz (jadval va diagrammalar uchun). */
  flush?: boolean;
  /** Panel pastidagi havola - mockupdagi "Batafsil" / "Barchasi". */
  footerAction?: { label: string; to: string } | undefined;
  /**
   * Panel pastidagi ERKIN mazmun - havola o'rniga xulosa qatori uchun.
   * `footerAction` bilan birga berilmaydi; berilsa shu ustun turadi.
   */
  footer?: ReactNode;
}

export function Panel({
  title, subtitle, actions, children, className, bodyClassName, flush, footerAction, footer,
}: PanelProps) {
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  return (
    <section className={cn('panel', className)}>
      {(title || actions) && (
        <header className="panel__header">
          <div className="min-w-0">
            {title && <h2 className="panel__title truncate">{title}</h2>}
            {subtitle && <p className="panel__subtitle truncate">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            {/*
              `display: contents` - bu o'ram QUTI hosil qilmaydi, portal bilan
              kelgan tugmalar to'g'ridan-to'g'ri yuqoridagi flex qatorining
              bandlari bo'ladi va `gap` ular uchun ham ishlaydi.
            */}
            <div ref={setHeaderSlot} className="contents" />
          </div>
        </header>
      )}

      <PanelHeaderSlotContext.Provider value={headerSlot}>
        <div
          className={cn(
            'panel__body',
            flush && 'panel__body--flush',
            (footerAction || footer) && !flush && 'pb-3',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </PanelHeaderSlotContext.Provider>

      {footer ? (
        <div className="border-t border-separator/50 px-3.5 py-2.5">{footer}</div>
      ) : footerAction ? (
        <Link className="panel__action" to={footerAction.to}>
          {footerAction.label}
        </Link>
      ) : null}
    </section>
  );
}

/** Ma'lumot yo'qligini bildiruvchi holat. */
export function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-10 text-center text-sm text-muted">
      {message}
    </div>
  );
}

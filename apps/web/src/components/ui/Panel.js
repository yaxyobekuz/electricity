/** Dashboard paneli — barcha kartalarning yagona ramkasi. */
import { cn } from '@heroui/react';
import { Link } from 'react-router';
export function Panel({ title, subtitle, actions, children, className, bodyClassName, flush, footerAction, }) {
    return (<section className={cn('panel', className)}>
      {(title || actions) && (<header className="panel__header">
          <div className="min-w-0">
            {title && <h2 className="panel__title truncate">{title}</h2>}
            {subtitle && <p className="panel__subtitle truncate">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>)}

      <div className={cn('panel__body', flush && 'panel__body--flush', footerAction && !flush && 'pb-3', bodyClassName)}>
        {children}
      </div>

      {footerAction && (<Link className="panel__action" to={footerAction.to}>
          {footerAction.label}
        </Link>)}
    </section>);
}
/** Ma'lumot yo'qligini bildiruvchi holat. */
export function EmptyPanel({ message }) {
    return (<div className="flex min-h-24 items-center justify-center px-4 py-10 text-center text-sm text-muted">
      {message}
    </div>);
}

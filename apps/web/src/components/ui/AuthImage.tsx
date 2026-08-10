/**
 * API dan keladigan rasm.
 *
 * `fetch` bilan olinadi va `blob:` manzil sifatida beriladi - oddiy
 * `<img src>` xato holatini (404, buzilgan fayl) ajratib ko'rsata olmaydi,
 * bu yerda esa "Rasm ochilmadi" holati aniq. Manzil komponent yopilganda
 * BEKOR QILINADI, aks holda har ochilishda xotira o'sib boradi.
 */
import { useEffect, useState } from 'react';

import { apiFetchRaw } from '../../lib/api.ts';

export function AuthImage({
  path, alt, className, onClick,
}: {
  /** API yo'li, masalan `/files/work-photo/12`. */
  path: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const res = await apiFetchRaw(path);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-surface-secondary text-[10px] text-muted ${className ?? ''}`}>
        Rasm ochilmadi
      </div>
    );
  }

  if (!url) return <div className={`animate-pulse bg-surface-secondary ${className ?? ''}`} />;

  return <img alt={alt} className={className} src={url} onClick={onClick} />;
}

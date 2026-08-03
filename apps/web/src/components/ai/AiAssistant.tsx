/**
 * AI AGENT — o'ng pastki burchakdagi suhbat paneli.
 *
 * Ko'rinishi qo'llab-quvvatlash chatiga o'xshaydi, lekin bu maslahatchi emas,
 * BAJARUVCHI: server modelga asboblar beradi va model ularni chaqiradi.
 * Ma'lumot asboblari serverda ishlaydi, INTERFEYS amallari esa shu yerda —
 * `action` hodisasi kelganda sahifa ochiladi, davr almashadi yoki fayl
 * yuklab olinadi. Shuning uchun "hisobotni yuklab ber" degan iltimos
 * javob bilan emas, FAYL bilan yakunlanadi.
 *
 * Panel AppShell ichida BIR MARTA joylashadi va sahifa almashganda
 * yopilmaydi — suhbat uzilib qolmaydi. Aynan shu sababli navigatsiya
 * `useNavigate` bilan bajariladi, `window.location` bilan emas.
 *
 * Login TALAB QILINMAYDI — panelning raqamlari mehmonga ham ochiq. Ammo
 * bazaga YOZADIGAN asboblar server tomonda login va rolni talab qiladi.
 *
 * Kalit sozlanmagan bo'lsa (`/ai/status` → enabled:false) tugma chiqmaydi:
 * ishlamaydigan tugma foydalanuvchini chalg'itadi.
 */
import { Button, TextArea, cn } from '@heroui/react';
import { Bot, Check, Eraser, Send, Sparkles, Square, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import robotUrl from '../../assets/robot.png';
import { type AiAction, type AiMessage, type AiToolEvent, fetchAiStatus, streamAiChat } from '../../lib/ai.ts';
import { downloadFile } from '../../lib/download.ts';
import { useUi } from '../../lib/ui-store.ts';

/** Suhbat sahifa yangilanganda ham qolsin — bir sessiya doirasida. */
const STORE_KEY = 'beap.ai.chat';

/*
 * Takliflar AMAL so'raydigan qilib yozilgan — foydalanuvchi agentning
 * shunchaki javob bermasligini, ish bajarishini birinchi qarashda ko'rsin.
 */
const SUGGESTIONS = [
  'Oylik hisobotni Excelda yuklab ber',
  'Qaysi transformatorlarda eng ko‘p muammo bor?',
  'TP-067 ni ko‘rsat',
  'O‘tgan oy bilan solishtir',
];

interface ChatItem extends AiMessage {
  /** Xato xabari — boshqa rangda va nusxa olinmaydigan qilib ko'rsatiladi. */
  isError?: boolean;
  /** Shu javob davomida bajarilgan amallar — pufak ustida chiplar bo'lib chiqadi. */
  tools?: AiToolEvent[];
}

function readStore(): ChatItem[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as ChatItem[]) : [];
  } catch {
    return [];
  }
}

export function AiAssistant() {
  const period = useUi((s) => s.period);
  const setPeriod = useUi((s) => s.setPeriod);
  const setAsOfDate = useUi((s) => s.setAsOfDate);
  const navigate = useNavigate();

  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>(readStore);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Yordamchi ulanganmi — bir marta tekshiriladi.
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const status = await fetchAiStatus(ac.signal);
        setEnabled(status.enabled);
      } catch {
        setEnabled(false);
      }
    })();
    return () => ac.abort();
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(items.slice(-40)));
    } catch {
      /* saqlab bo'lmadi — muhim emas */
    }
  }, [items]);

  // Yangi bo'lak kelganda oxiriga surilib turamiz.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Panel yopilganda javob oqimini ham to'xtatamiz.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Agent so'ragan amalni BRAUZERDA bajaradi.
   *
   * Server bularni o'zi qila olmaydi — sahifa ochish, davrni almashtirish
   * va faylni saqlash klientda bo'ladi. Xato bo'lsa suhbat to'xtamaydi:
   * xabar oddiy xato pufagi bo'lib qo'shiladi va model javobini davom
   * ettiradi.
   */
  const runAction = (action: AiAction): void => {
    const p = action.payload;

    switch (action.type) {
      case 'navigate': {
        const path = String(p['path'] ?? '/dashboard');
        const search = typeof p['search'] === 'string' && p['search'] ? p['search'] : null;
        // Qidiruv matni `?q=` bilan uzatiladi — sahifalar uni o'qiy oladi.
        void navigate(search ? `${path}?q=${encodeURIComponent(search)}` : path);
        break;
      }

      case 'set_period':
        setPeriod(String(p['period']));
        break;

      case 'set_as_of_date':
        setAsOfDate(String(p['date']));
        break;

      case 'download': {
        const url = String(p['url'] ?? '');
        if (!url.startsWith('/')) break;
        void downloadFile(url, `hisobot.${String(p['ext'] ?? 'xlsx')}`).catch((err: unknown) => {
          setItems((prev) => [...prev, {
            role: 'assistant',
            content: `Faylni yuklab bo‘lmadi: ${err instanceof Error ? err.message : 'noma’lum xato'}`,
            isError: true,
          }]);
        });
        break;
      }
    }
  };

  const send = (text: string): void => {
    const question = text.trim();
    if (!question || busy) return;

    const history: AiMessage[] = [
      ...items.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ];

    setItems((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setDraft('');
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;

    void (async () => {
      try {
        await streamAiChat(history, {
          period,
          signal: ac.signal,
          onDelta: (chunk) => {
            setItems((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, content: last.content + chunk };
              }
              return next;
            });
          },
          onTool: (event) => {
            setItems((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (!last || last.role !== 'assistant') return prev;

              /*
               * Bir asbob ikki marta keladi: `running`, keyin `done`.
               * Ikkita chip chiqmasin — mavjudi YANGILANADI.
               */
              const tools = [...(last.tools ?? [])];
              const at = tools.findIndex((t) => t.name === event.name && t.status === 'running');
              if (at >= 0) tools[at] = event;
              else tools.push(event);

              next[next.length - 1] = { ...last, tools };
              return next;
            });
          },
          onAction: runAction,
          onError: (message) => {
            setItems((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: message, isError: true };
              return next;
            });
          },
        });
      } catch (err) {
        // Foydalanuvchi o'zi to'xtatgan bo'lsa — xato emas.
        if (ac.signal.aborted) return;
        setItems((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'assistant',
            content: err instanceof Error ? err.message : 'Javob olinmadi',
            isError: true,
          };
          return next;
        });
      } finally {
        /*
         * Model hech narsa qaytarmasa bo'sh pufak qolib ketmasin. AMMO
         * asbob ishlagan bo'lsa pufak bo'sh emas — unda chiplar turadi
         * ("Hisobot tayyorlandi"), shuning uchun u saqlanadi.
         */
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.content === ''
              && (last.tools?.length ?? 0) === 0) {
            return [...prev.slice(0, -1), {
              role: 'assistant',
              content: 'Javob olinmadi. Qaytadan urinib ko‘ring.',
              isError: true,
            }];
          }
          return prev;
        });
        abortRef.current = null;
        setBusy(false);
      }
    })();
  };

  if (!enabled) return null;

  return (
    <>
      {/* ─── Chaqiruv tugmasi ─── */}
      <button
        aria-expanded={open}
        aria-label={open ? 'Yordamchini yopish' : 'AI yordamchi'}
        className={cn(
          'fixed bottom-5 right-5 z-40 flex size-14 items-center justify-center rounded-full',
          'text-white transition-transform duration-200 hover:scale-105 active:scale-95',
          open && 'scale-0 opacity-0',
        )}
        style={{
          background: 'linear-gradient(140deg, var(--accent), color-mix(in oklab, var(--accent) 65%, #7c3aed))',
          boxShadow: '0 10px 28px color-mix(in oklab, var(--accent) 42%, transparent)',
        }}
        type="button"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-6" strokeWidth={2} />
        {/* "Onlayn" nuqtasi — yordamchi tayyorligini bildiradi */}
        <span className="absolute right-1 top-1 size-3 rounded-full border-2 border-white bg-success" />
      </button>

      {/* ─── Panel ─── */}
      {open && (
        <section
          aria-label="AI yordamchi"
          className={cn(
            'fixed bottom-4 right-4 z-40 flex flex-col overflow-hidden rounded-2xl bg-surface',
            'w-[min(24rem,calc(100vw-2rem))] h-[min(38rem,calc(100dvh-3rem))]',
          )}
          style={{ boxShadow: '0 24px 60px rgb(0 0 0 / 0.22), 0 2px 8px rgb(0 0 0 / 0.08)' }}
        >
          {/* Sarlavha */}
          <header
            className="flex shrink-0 items-center gap-2.5 px-3.5 py-3 text-white"
            style={{
              background: 'linear-gradient(140deg, var(--accent), color-mix(in oklab, var(--accent) 68%, #7c3aed))',
            }}
          >
            <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-white/18">
              <img alt="" aria-hidden="true" className="size-8 select-none" src={robotUrl} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold leading-tight">BEAP yordamchi</p>
              <p className="flex items-center gap-1.5 text-[10.5px] leading-tight opacity-85">
                <span className="size-1.5 rounded-full bg-emerald-300" />
                {busy ? 'ishlamoqda…' : 'onlayn · siz uchun ish bajaradi'}
              </p>
            </div>

            <button
              aria-label="Suhbatni tozalash"
              className="rounded-lg p-1.5 opacity-80 transition-opacity hover:opacity-100 disabled:opacity-35"
              disabled={items.length === 0 || busy}
              title="Suhbatni tozalash"
              type="button"
              onClick={() => setItems([])}
            >
              <Eraser className="size-4" />
            </button>
            <button
              aria-label="Yopish"
              className="rounded-lg p-1.5 opacity-80 transition-opacity hover:opacity-100"
              type="button"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </header>

          {/* Suhbat */}
          <div ref={scrollRef} className="scroll-y flex-1 space-y-2.5 bg-background px-3 py-3.5">
            {items.length === 0 ? (
              <Greeting onPick={send} />
            ) : (
              items.map((m, i) => (
                <Bubble
                  key={i}
                  isError={m.isError ?? false}
                  isTyping={busy && i === items.length - 1 && m.content === ''
                    && (m.tools?.length ?? 0) === 0}
                  role={m.role}
                  text={m.content}
                  tools={m.tools ?? []}
                />
              ))
            )}
          </div>

          {/* Yozish maydoni */}
          <div className="shrink-0 bg-surface px-3 pb-3 pt-2.5">
            <div className="flex items-end gap-2">
              <TextArea
                ref={inputRef}
                className="max-h-28 min-h-9 flex-1 resize-none rounded-xl px-3 py-2 text-[12.5px] leading-snug"
                placeholder="Savolingizni yozing…"
                rows={1}
                value={draft}
                variant="secondary"
                onChange={(e) => {
                  setDraft(e.target.value);
                  // Matn o'sganda maydon ham o'sadi — 4 qatorgacha.
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
                }}
                onKeyDown={(e) => {
                  // Enter — yuborish, Shift+Enter — yangi qator.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
              />

              {busy ? (
                <Button
                  isIconOnly
                  aria-label="To‘xtatish"
                  className="size-9 shrink-0 rounded-xl"
                  size="sm"
                  variant="secondary"
                  onPress={() => abortRef.current?.abort()}
                >
                  <Square className="size-3.5" fill="currentColor" />
                </Button>
              ) : (
                <Button
                  isIconOnly
                  aria-label="Yuborish"
                  className="size-9 shrink-0 rounded-xl"
                  isDisabled={draft.trim().length === 0}
                  size="sm"
                  variant="primary"
                  onPress={() => send(draft)}
                >
                  <Send className="size-4" />
                </Button>
              )}
            </div>

            <p className="mt-1.5 text-center text-[9.5px] leading-tight text-muted">
              Javoblar tizimdagi joriy ma’lumot asosida. Muhim qarordan oldin
              raqamni paneldan tekshiring.
            </p>
          </div>
        </section>
      )}
    </>
  );
}

/** Bo'sh suhbat — nima so'rash mumkinligi darhol ko'rinib tursin. */
function Greeting({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 pt-4 text-center">
      <span
        className="flex size-14 items-center justify-center rounded-2xl text-white"
        style={{
          background: 'linear-gradient(140deg, var(--accent), color-mix(in oklab, var(--accent) 65%, #7c3aed))',
        }}
      >
        <Bot className="size-7" strokeWidth={1.6} />
      </span>

      <div>
        <p className="text-[13px] font-bold">Assalomu alaykum!</p>
        <p className="mt-1 text-[11.5px] leading-snug text-muted">
          Fider ma’lumotlari, yo‘qotishlar va panel bo‘yicha savol bering.
        </p>
      </div>

      <div className="mt-1 flex w-full flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className={cn(
              'rounded-xl bg-surface px-3 py-2 text-left text-[11.5px] leading-snug',
              'shadow-surface transition-colors hover:text-accent',
            )}
            type="button"
            onClick={() => onPick(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Bitta xabar.
 *
 * Model matnni `**qalin**` bilan bezaydi — uni HTML ga aylantiramiz, qolgani
 * `pre-wrap` bilan qanday kelgan bo'lsa shunday chiqadi. To'liq markdown
 * kutubxonasi shu qadar kichik matn uchun ortiqcha.
 */
function Bubble({
  role, text, isError, isTyping, tools,
}: {
  role: 'user' | 'assistant';
  text: string;
  isError: boolean;
  isTyping: boolean;
  tools: AiToolEvent[];
}) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      {/*
        Bajarilgan amallar pufakdan YUQORIDA turadi: foydalanuvchi avval
        "nima qilindi" ni, keyin xulosani o'qiydi — sabab-natija tartibi.
      */}
      {tools.length > 0 && (
        <div className="flex max-w-[90%] flex-col gap-1">
          {tools.map((t, i) => <ToolChip key={`${t.name}-${i}`} tool={t} />)}
        </div>
      )}

      {(text.length > 0 || isTyping) && (
        <div
          className={cn(
            'max-w-[85%] whitespace-pre-wrap wrap-break-word rounded-2xl px-3 py-2 text-[12px] leading-relaxed',
            isUser && 'rounded-br-md text-white',
            !isUser && 'rounded-bl-md bg-surface shadow-surface',
            isError && 'bg-danger-soft text-danger',
          )}
          style={isUser ? { background: 'var(--accent)' } : undefined}
        >
          {isTyping ? <Typing /> : formatRich(text)}
        </div>
      )}
    </div>
  );
}

/** Bitta amal — "nima qilinayotgani" va natijasi. */
function ToolChip({ tool }: { tool: AiToolEvent }) {
  const running = tool.status === 'running';
  const failed = !running && !tool.ok;

  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10.5px] font-medium',
        failed ? 'bg-danger-soft text-danger' : 'text-accent',
      )}
      // Yumshoq fon `components.css` dagi bilan bir xil usulda — HeroUI ning
      // `accent-soft` yordamchisi bu yerda kafolatlanmagan.
      style={failed ? undefined : { background: 'color-mix(in oklab, var(--accent) 11%, transparent)' }}
    >
      {running ? (
        <span className="size-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent" />
      ) : failed ? (
        <TriangleAlert className="size-3 shrink-0" />
      ) : (
        <Check className="size-3 shrink-0" strokeWidth={3} />
      )}
      {tool.label}
    </span>
  );
}

/** `**qalin**` bo'laklarini ajratadi. */
function formatRich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ));
}

/** Uchta sakrab turuvchi nuqta — javob kelayotgani bilinib tursin. */
function Typing() {
  return (
    <span aria-label="Javob yozilmoqda" className="flex items-center gap-1 py-0.5" role="status">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }}
        />
      ))}
    </span>
  );
}

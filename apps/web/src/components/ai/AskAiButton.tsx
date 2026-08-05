/**
 * Panel sarlavhasidagi "AI tavsiya" tugmasi.
 *
 * Bosilganda AI yordamchi ochiladi va berilgan savol avtomatik yuboriladi —
 * foydalanuvchi savolni o'zi yozib o'tirmaydi, javobni darhol oladi. Ko'rinishi
 * panellardagi "Barchasi" havolasi bilan bir xil uslubda — yon-yonma turadi.
 */
import { Sparkles } from 'lucide-react';

import { useUi } from '../../lib/ui-store.ts';

export function AskAiButton({ label = 'AI tavsiya', prompt }: { label?: string; prompt: string }) {
  const askAi = useUi((s) => s.askAi);

  return (
    <button
      className="flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-accent hover:underline"
      type="button"
      onClick={() => askAi(prompt)}
    >
      <Sparkles className="size-3" />
      {label}
    </button>
  );
}

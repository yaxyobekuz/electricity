-- ═══════════════════════════════════════════════════════════════════════════
-- 0006_plausibility_fix.sql — qarzdorlik ishonchliligi tekshiruvini qayta yozish
--
-- MUAMMO (0002 dagi dastlabki variant):
--   Tekshiruv "shu oydagi boshqa MFY lar yig'indisi" ga tayangan edi. Lekin
--   konvertlar birin-ketin tasdiqlanadi — oyning BIRINCHI tasdiqlangan MFY si
--   har doim "jamining 100%" bo'lib ko'rinadi va noto'g'ri bloklanadi.
--   Bu seed paytida ham, haqiqiy ishlatishda ham yuzaga chiqadi.
--
-- YECHIM: tartibga bog'liq bo'lmagan mezon — BIR ISTE'MOLCHIGA to'g'ri
--   keladigan qarzdorlikni tuman o'rtachasi bilan solishtirish.
--
--   Go'ravon hodisasi: tuman qarzdorligi (4,265.6 mln) 829 iste'molchili MFY
--   qatoriga ko'chirilgan → 5.15 mln/iste'molchi, tuman o'rtachasi esa
--   ~0.095 mln/iste'molchi. Ya'ni 54 barobar. 8 barobar chegarasi buni
--   ishonchli tutadi va haqiqiy "qarzdor" MFY larni (3–4 barobar) o'tkazadi.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fact.trg_return_plausible() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mine_debt      numeric;
  v_mine_consumers int;
  v_mine_per_cons  numeric;
  v_avg_per_cons   numeric;
  v_sample_mfys    int;
  v_ratio          numeric;
BEGIN
  -- Generated ustunlar BEFORE triggerda hali hisoblanmagan — qo'lda yig'amiz.
  v_mine_debt      := NEW.debt_population_mln + NEW.debt_legal_mln + NEW.debt_budget_mln;
  v_mine_consumers := NEW.consumers_population + NEW.consumers_legal;

  IF v_mine_debt <= 0 OR v_mine_consumers <= 0 THEN
    RETURN NEW;
  END IF;

  v_mine_per_cons := v_mine_debt / v_mine_consumers;

  -- Tuman bazasi: oxirgi 12 oydagi tasdiqlangan ma'lumot, shu MFY dan tashqari.
  SELECT
    sum(r.debt_total_mln) / nullif(sum(r.consumers_total), 0),
    count(DISTINCT r.mfy_id)
  INTO v_avg_per_cons, v_sample_mfys
  FROM fact.mfy_monthly_return r
  JOIN fact.submission s ON s.id = r.submission_id AND s.status = 'approved'
  WHERE r.mfy_id <> NEW.mfy_id
    AND r.period_month >  NEW.period_month - INTERVAL '12 months'
    AND r.period_month <= NEW.period_month;

  -- Taqqoslash uchun yetarli baza yo'q (tizimning birinchi oylari) — o'tkazamiz.
  IF v_avg_per_cons IS NULL OR v_avg_per_cons <= 0 OR coalesce(v_sample_mfys, 0) < 3 THEN
    RETURN NEW;
  END IF;

  v_ratio := v_mine_per_cons / v_avg_per_cons;

  IF v_ratio > 8.0 THEN
    RAISE EXCEPTION
      'IMPLAUSIBLE_DEBT: bir iste''molchiga % mln so''m qarzdorlik — tuman o''rtachasidan % barobar ko''p',
      round(v_mine_per_cons, 3), round(v_ratio, 1)
      USING ERRCODE = 'check_violation',
            HINT = 'district_paste_suspected',
            DETAIL = 'Bu qiymat tuman formasidan ko''chirilganga o''xshaydi. Faqat shu MFY ning qarzdorligini kiriting.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION fact.trg_return_plausible IS
  'Tartibga bog''liq emas: bir iste''molchiga qarzdorlikni tuman o''rtachasi bilan solishtiradi';

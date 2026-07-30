import { loginSchema } from '@beap/shared';
import { Button, Description, FieldError, Form, Input, InputGroup, Label, TextField, } from '@heroui/react';
import { KeyRound, User, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ApiRequestError, api, setAccessToken } from '../../lib/api.ts';
import { useUi } from '../../lib/ui-store.ts';
const DEMO_ACCOUNTS = [
    { login: 'hokim', role: 'Hokimiyat kuzatuvchisi' },
    { login: 'manager.baliqchi', role: 'Elektroset menejeri' },
    { login: 'operator1', role: 'MFY operatori' },
    { login: 'admin', role: 'Administrator' },
];
export default function LoginPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const setUser = useUi((s) => s.setUser);
    const [errors, setErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [pending, setPending] = useState(false);
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrors({});
        setFormError(null);
        setPending(true);
        const formData = new FormData(e.currentTarget);
        const parsed = loginSchema.safeParse(Object.fromEntries(formData));
        if (!parsed.success) {
            const fieldErrors = {};
            for (const issue of parsed.error.issues) {
                fieldErrors[issue.path.join('.')] ??= issue.message;
            }
            setErrors(fieldErrors);
            setPending(false);
            return;
        }
        try {
            const res = await api.post('/auth/login', parsed.data);
            setAccessToken(res.accessToken);
            setUser(res.user);
            void navigate('/dashboard', { replace: true });
        }
        catch (err) {
            if (err instanceof ApiRequestError) {
                setErrors(err.fieldErrors);
                setFormError(err.message);
            }
            else {
                setFormError('Serverga ulanib bo‘lmadi');
            }
        }
        finally {
            setPending(false);
        }
    };
    return (<div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-xl text-accent-foreground" style={{ background: 'var(--accent)' }}>
            <Zap className="size-7"/>
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t('app.name')}</h1>
            <p className="mt-1 text-xs text-muted">{t('app.districtName')}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface p-6">
          <h2 className="mb-4 text-sm font-semibold">{t('auth.title')}</h2>

          <Form className="flex flex-col gap-4" validationBehavior="aria" validationErrors={errors} onSubmit={(e) => void handleSubmit(e)}>
            <TextField isRequired name="login" autoComplete="username">
              <Label>{t('auth.login')}</Label>
              <InputGroup>
                <InputGroup.Prefix>
                  <User className="size-4 text-muted"/>
                </InputGroup.Prefix>
                <InputGroup.Input placeholder="operator1"/>
              </InputGroup>
              <FieldError />
            </TextField>

            <TextField isRequired name="password" type="password" autoComplete="current-password">
              <Label>{t('auth.password')}</Label>
              <InputGroup>
                <InputGroup.Prefix>
                  <KeyRound className="size-4 text-muted"/>
                </InputGroup.Prefix>
                <InputGroup.Input placeholder="••••••••"/>
              </InputGroup>
              <FieldError />
            </TextField>

            {formError && (<p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {formError}
              </p>)}

            <Button fullWidth isPending={pending} type="submit">
              {t('auth.signIn')}
            </Button>
          </Form>
        </div>

        {/* Demo hisoblar — ishlab chiqarishda olib tashlanadi */}
        <div className="mt-4 rounded-xl border border-border/70 bg-surface-secondary p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t('auth.demoNote')}
          </p>
          <ul className="flex flex-col gap-1 text-[11px]">
            {DEMO_ACCOUNTS.map((a) => (<li key={a.login} className="flex items-center justify-between gap-2">
                <code className="rounded bg-surface px-1.5 py-0.5 font-mono">{a.login}</code>
                <span className="text-muted">{a.role}</span>
              </li>))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">
            Parol: <code className="rounded bg-surface px-1.5 py-0.5 font-mono">Beap2026!</code>
          </p>
        </div>

        <p className="mt-4 text-center text-[10px] text-muted">
          Tizim to‘liq offline ishlaydi. Ma’lumot tashqi tarmoqqa chiqmaydi.
        </p>
      </div>
    </div>);
}

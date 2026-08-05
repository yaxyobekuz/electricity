/**
 * Ma'sul shaxs sozlamalari — fider dashboardidagi "Ma'sul shaxs" panelini
 * boshqaruvchi alohida sahifa.
 *
 * Tizim qamrovi bitta fider, shuning uchun "qaysi fider?" degan tanlov yo'q —
 * xuddi `MfyDashboard` dagi kabi registrdagi yagona fider olinadi.
 */
import {
  Briefcase, IdCard, Phone, Save, User,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  Button, FieldError, Form, InputGroup, Label, TextField, toast,
} from '@heroui/react';

import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { ApiRequestError } from '../../lib/api.ts';
import { useBootstrap, useMfyResponsible, useUpdateMfyResponsible } from '../../lib/queries.ts';

export default function ResponsibleSettingsPage() {
  const params = useParams();
  const boot = useBootstrap();

  const paramId = Number(params['mfyId']);
  const mfyId = Number.isFinite(paramId) && paramId > 0 ? paramId : (boot.data?.mfys[0]?.id ?? 0);

  const responsible = useMfyResponsible(mfyId);
  const update = useUpdateMfyResponsible(mfyId);

  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Server ma'lumoti kelganda forma bir marta to'ldiriladi.
  useEffect(() => {
    if (!responsible.data) return;
    setFullName(responsible.data.fullName);
    setPosition(responsible.data.position ?? '');
    setPhone(responsible.data.phone ?? '');
  }, [responsible.data]);

  if (boot.isLoading || (mfyId === 0 && !boot.isError)) return <LoadingState rows={4} />;
  if (mfyId === 0) return <ErrorState message="Fider registrda topilmadi" />;

  const mfy = boot.data?.mfys.find((m) => m.id === mfyId);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setFieldErrors({});

    update.mutate(
      { fullName: fullName.trim(), position: position.trim() || null, phone: phone.trim() || null },
      {
        onSuccess: () => toast.success('Ma’sul shaxs saqlandi'),
        onError: (err) => {
          if (err instanceof ApiRequestError) {
            setFieldErrors(err.fieldErrors);
            toast.danger(err.message);
          } else {
            toast.danger('Serverga ulanib bo‘lmadi');
          }
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Sozlamalar' },
          { label: 'Ma’sul shaxs' },
        ]}
        subtitle={mfy?.nameUz}
        title="Ma’sul shaxs sozlamalari"
      />

      <Panel
        className="max-w-md"
        subtitle="Fider dashboardidagi «Ma’sul shaxs» panelida ko‘rsatiladi"
        title="Ma’lumotlarni tahrirlash"
      >
        {responsible.isLoading ? (
          <LoadingState rows={3} />
        ) : (
          <Form
            className="flex flex-col gap-4"
            validationBehavior="aria"
            validationErrors={fieldErrors}
            onSubmit={handleSubmit}
          >
            <TextField
              isRequired
              name="fullName"
              value={fullName}
              onChange={setFullName}
            >
              <Label>F.I.Sh.</Label>
              <InputGroup>
                <InputGroup.Prefix>
                  <User className="size-4 text-muted" />
                </InputGroup.Prefix>
                <InputGroup.Input placeholder="Karimov Vali Aliyevich" />
              </InputGroup>
              <FieldError />
            </TextField>

            <TextField name="position" value={position} onChange={setPosition}>
              <Label>Lavozimi</Label>
              <InputGroup>
                <InputGroup.Prefix>
                  <Briefcase className="size-4 text-muted" />
                </InputGroup.Prefix>
                <InputGroup.Input placeholder="Fider bo‘yicha mas’ul muhandis" />
              </InputGroup>
              <FieldError />
            </TextField>

            <TextField name="phone" type="tel" value={phone} onChange={setPhone}>
              <Label>Telefon</Label>
              <InputGroup>
                <InputGroup.Prefix>
                  <Phone className="size-4 text-muted" />
                </InputGroup.Prefix>
                <InputGroup.Input placeholder="+998 90 123 45 67" />
              </InputGroup>
              <FieldError />
            </TextField>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <IdCard className="size-3.5" />
                Fider: {mfy?.nameUz ?? `#${mfyId}`}
              </span>
              <Button isDisabled={!fullName.trim()} isPending={update.isPending} type="submit">
                <Save className="size-4" />
                Saqlash
              </Button>
            </div>
          </Form>
        )}
      </Panel>
    </>
  );
}

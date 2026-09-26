'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Rocket } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authCodeSchema, emailSchema } from '@osd/shared';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sessionKey } from '@/hooks/use-session';
import { useApi } from '@/lib/api-context';

export default function LoginPage() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  const requestCode = useMutation({
    mutationFn: (value: string) => api.requestCode(value),
    onSuccess: () => {
      setStep('code');
      setCode('');
    },
  });
  const verify = useMutation({
    mutationFn: () => api.verifyCode(email, code),
    onSuccess: (user) => {
      queryClient.setQueryData(sessionKey, user);
      router.replace('/dashboard');
    },
  });

  function submitEmail(e: FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? 'Invalid email');
    setFieldError(undefined);
    setEmail(parsed.data);
    requestCode.mutate(parsed.data);
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    const parsed = authCodeSchema.safeParse(code.trim());
    if (!parsed.success) return setFieldError('Enter the 6-digit code from the email');
    setFieldError(undefined);
    verify.mutate();
  }

  const error = step === 'email' ? requestCode.error : verify.error;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Rocket className="size-6" aria-hidden />
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            {step === 'email'
              ? 'We will email you a one-time code.'
              : `Enter the code we sent to ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'email' ? (
            <form onSubmit={submitEmail} className="space-y-4" noValidate>
              <Field
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={fieldError}
              />
              {error && <Alert variant="destructive">{error.message}</Alert>}
              <Button type="submit" className="w-full" disabled={requestCode.isPending}>
                {requestCode.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4" noValidate>
              <Field
                id="code"
                label="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                error={fieldError}
              />
              {error && <Alert variant="destructive">{error.message}</Alert>}
              <Button type="submit" className="w-full" disabled={verify.isPending}>
                {verify.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Verify
              </Button>
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() => {
                  setStep('email');
                  setFieldError(undefined);
                  verify.reset();
                }}
              >
                Use a different email
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

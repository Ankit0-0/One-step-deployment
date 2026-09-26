'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createProjectBodySchema } from '@osd/shared';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { projectsKey } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/api-context';
import { env } from '@/lib/env';
import { slugify } from '@/lib/format';
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from '@/lib/form';

export default function NewProjectPage() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [gitUrl, setGitUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: projectsKey });
      router.push(`/projects/${project.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CONFLICT') setErrors({ slug: err.message });
      else setErrors(apiFieldErrors(err));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createProjectBodySchema.safeParse({ name, slug, gitUrl });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data);
  }

  const showBanner =
    create.error &&
    !(
      create.error instanceof ApiError &&
      ['CONFLICT', 'VALIDATION_ERROR'].includes(create.error.code)
    );

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New project" description="Deploy a public GitHub repository." />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-5" noValidate>
            <Field
              id="name"
              label="Name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
              error={errors.name}
            />
            <Field
              id="slug"
              label="Subdomain"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase());
                setSlugEdited(true);
              }}
              error={errors.slug}
              hint={slug ? `${slug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}` : undefined}
            />
            <Field
              id="gitUrl"
              label="GitHub repository"
              placeholder="https://github.com/owner/repo"
              inputMode="url"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              error={errors.gitUrl}
            />
            {showBanner && <Alert variant="destructive">{create.error.message}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" asChild>
                <Link href="/dashboard">Cancel</Link>
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Create project
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

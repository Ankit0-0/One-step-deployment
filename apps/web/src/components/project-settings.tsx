'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { updateProjectBodySchema, type ProjectDto } from '@osd/shared';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { projectKey, projectsKey } from '@/hooks/queries';
import { useApi } from '@/lib/api-context';
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from '@/lib/form';

export function ProjectSettings({ project }: { project: ProjectDto }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [gitUrl, setGitUrl] = useState(project.gitUrl);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);

  const update = useMutation({
    mutationFn: (body: { name?: string; gitUrl?: string }) => api.updateProject(project.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(projectKey(project.id), updated);
      void queryClient.invalidateQueries({ queryKey: projectsKey });
      setSaved(true);
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const changes = {
    ...(name !== project.name ? { name } : {}),
    ...(gitUrl !== project.gitUrl ? { gitUrl } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const parsed = updateProjectBodySchema.safeParse(changes);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    update.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field
        id="project-name"
        label="Name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSaved(false);
        }}
        error={errors.name}
      />
      <Field
        id="project-git-url"
        label="GitHub repository"
        value={gitUrl}
        onChange={(e) => {
          setGitUrl(e.target.value);
          setSaved(false);
        }}
        error={errors.gitUrl}
        hint="Changes apply to the next deployment."
      />
      {update.isError && Object.keys(apiFieldErrors(update.error)).length === 0 && (
        <Alert variant="destructive">{update.error.message}</Alert>
      )}
      <div className="flex items-center justify-end gap-3">
        {saved && !dirty && <span className="text-sm text-muted-foreground">Saved</span>}
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Save
        </Button>
      </div>
    </form>
  );
}

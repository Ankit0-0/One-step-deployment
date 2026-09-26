import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';
import {
  SOCKET_EVENTS,
  type DeploymentDto,
  type DeploymentLogDto,
  type DeploymentStatus,
} from '@osd/shared';
import { deploymentKey, useDeploymentLogs } from '@/hooks/use-deployment-logs';
import type { ApiClient } from '@/lib/api';
import { ApiContext } from '@/lib/api-context';
import { DEPLOYMENT_ID, deployment, log } from './fixtures';

type Handler = (payload?: unknown) => void;

/** Just enough of a socket.io client for the hook: listeners plus a record of emits. */
class FakeSocket {
  connected = true;
  handlers = new Map<string, Set<Handler>>();
  emitted: Array<[string, unknown]> = [];
  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, payload: unknown) {
    this.emitted.push([event, payload]);
    return this;
  }
  /** Simulate the server pushing an event. */
  receive(event: string, payload?: unknown) {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }
  listenerCount() {
    return [...this.handlers.values()].reduce((n, s) => n + s.size, 0);
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(status: DeploymentStatus | undefined, history: Promise<DeploymentLogDto[]>) {
  const socket = new FakeSocket();
  const socketFactory = vi.fn(() => socket as unknown as Socket);
  const api = { getAllLogs: vi.fn(() => history) } as unknown as ApiClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<DeploymentDto>(
    deploymentKey(DEPLOYMENT_ID),
    deployment({ status: status ?? 'QUEUED' }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
  const hook = renderHook(
    ({ s }: { s: DeploymentStatus | undefined }) =>
      useDeploymentLogs(DEPLOYMENT_ID, s, socketFactory),
    { wrapper, initialProps: { s: status } },
  );
  return { hook, socket, socketFactory, api, queryClient };
}

describe('useDeploymentLogs', () => {
  it('joins the room before loading history and merges lines that arrive meanwhile', async () => {
    const history = deferred<DeploymentLogDto[]>();
    const { hook, socket } = setup('BUILDING', history.promise);

    expect(socket.emitted).toContainEqual([
      SOCKET_EVENTS.JOIN_DEPLOYMENT,
      { deploymentId: DEPLOYMENT_ID },
    ]);
    expect(hook.result.current.state).toBe('loading');

    // Live lines during the history fetch: one overlaps history (id 3), one is new (id 4).
    act(() => {
      socket.receive(SOCKET_EVENTS.DEPLOYMENT_LOG, log(3));
      socket.receive(SOCKET_EVENTS.DEPLOYMENT_LOG, log(4));
    });
    await act(async () => history.resolve([log(1), log(2), log(3)]));

    expect(hook.result.current.state).toBe('live');
    expect(hook.result.current.logs.map((l) => l.id)).toEqual(['1', '2', '3', '4']);

    act(() => socket.receive(SOCKET_EVENTS.DEPLOYMENT_LOG, log(5)));
    expect(hook.result.current.logs.map((l) => l.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('ignores malformed payloads and lines for other deployments', async () => {
    const { hook, socket } = setup('BUILDING', Promise.resolve([log(1)]));
    await waitFor(() => expect(hook.result.current.state).toBe('live'));
    act(() => {
      socket.receive(SOCKET_EVENTS.DEPLOYMENT_LOG, { nope: true });
      socket.receive(SOCKET_EVENTS.DEPLOYMENT_LOG, { ...log(2), deploymentId: 'otherdeployment1' });
    });
    expect(hook.result.current.logs.map((l) => l.id)).toEqual(['1']);
  });

  it('applies status events to the cached deployment', async () => {
    const { hook, socket, queryClient } = setup('BUILDING', Promise.resolve([]));
    await waitFor(() => expect(hook.result.current.state).toBe('live'));
    act(() =>
      socket.receive(SOCKET_EVENTS.DEPLOYMENT_STATUS, {
        deploymentId: DEPLOYMENT_ID,
        status: 'FAILED',
        ts: '2026-09-26T10:01:00.000Z',
        errorMessage: 'npm exited with code 1',
      }),
    );
    expect(queryClient.getQueryData<DeploymentDto>(deploymentKey(DEPLOYMENT_ID))).toMatchObject({
      status: 'FAILED',
      errorMessage: 'npm exited with code 1',
    });
  });

  it('keeps its lines and marks the stream complete when the deployment finishes', async () => {
    const { hook, api } = setup('BUILDING', Promise.resolve([log(1), log(2)]));
    await waitFor(() => expect(hook.result.current.state).toBe('live'));
    hook.rerender({ s: 'READY' });
    expect(hook.result.current.state).toBe('complete');
    expect(hook.result.current.logs).toHaveLength(2);
    expect(api.getAllLogs).toHaveBeenCalledOnce();
  });

  it('loads history without a socket for a finished deployment', async () => {
    const { hook, socketFactory } = setup('READY', Promise.resolve([log(1)]));
    await waitFor(() => expect(hook.result.current.state).toBe('complete'));
    expect(hook.result.current.logs).toHaveLength(1);
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it('waits for the deployment status before starting', () => {
    const { socketFactory, api } = setup(undefined, Promise.resolve([]));
    expect(socketFactory).not.toHaveBeenCalled();
    expect(api.getAllLogs).not.toHaveBeenCalled();
  });

  it('reports a history failure', async () => {
    const { hook } = setup('BUILDING', Promise.reject(new Error('Request failed (500)')));
    await waitFor(() => expect(hook.result.current.state).toBe('error'));
    expect(hook.result.current.error?.message).toBe('Request failed (500)');
  });

  it('shows reconnecting while the socket is down and re-joins on reconnect', async () => {
    const { hook, socket } = setup('BUILDING', Promise.resolve([]));
    await waitFor(() => expect(hook.result.current.state).toBe('live'));
    act(() => socket.receive('disconnect'));
    expect(hook.result.current.reconnecting).toBe(true);
    socket.emitted = [];
    act(() => socket.receive('connect'));
    expect(hook.result.current.reconnecting).toBe(false);
    expect(socket.emitted).toContainEqual([
      SOCKET_EVENTS.JOIN_DEPLOYMENT,
      { deploymentId: DEPLOYMENT_ID },
    ]);
  });

  it('leaves the room and removes listeners on unmount', async () => {
    const { hook, socket } = setup('BUILDING', Promise.resolve([]));
    await waitFor(() => expect(hook.result.current.state).toBe('live'));
    hook.unmount();
    expect(socket.emitted).toContainEqual([
      SOCKET_EVENTS.LEAVE_DEPLOYMENT,
      { deploymentId: DEPLOYMENT_ID },
    ]);
    expect(socket.listenerCount()).toBe(0);
  });
});

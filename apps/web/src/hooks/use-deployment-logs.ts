'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  deploymentLogDtoSchema,
  deploymentStatusEventDtoSchema,
  isTerminalStatus,
  type DeploymentDto,
  type DeploymentLogDto,
  type DeploymentStatus,
} from '@osd/shared';
import { useApi } from '@/lib/api-context';
import { mergeLogs } from '@/lib/logs';
import { getSocket } from '@/lib/socket';

export type LogStreamState = 'loading' | 'live' | 'complete' | 'error';

export interface DeploymentLogs {
  logs: DeploymentLogDto[];
  state: LogStreamState;
  error: Error | null;
  /** True while the realtime connection is down for an active deployment. */
  reconnecting: boolean;
}

export const deploymentKey = (id: string) => ['deployment', id] as const;

/**
 * Persisted history plus a live tail. The socket joins the room first and buffers events, then
 * history loads, then both are merged by id, so no line emitted during the fetch is lost.
 * Finished deployments load history only. Give the caller a `key` per deployment (and per retry)
 * so switching deployments starts from a clean state.
 */
export function useDeploymentLogs(
  deploymentId: string,
  status: DeploymentStatus | undefined,
  socketFactory: () => Socket = getSocket,
): DeploymentLogs {
  const api = useApi();
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<DeploymentLogDto[]>([]);
  const [state, setState] = useState<LogStreamState>('loading');
  const [error, setError] = useState<Error | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const known = status !== undefined;
  const finished = status !== undefined && isTerminalStatus(status);
  // Read when the stream starts; a deployment finishing mid-view keeps its lines and listeners.
  const finishedRef = useRef(finished);
  useEffect(() => {
    finishedRef.current = finished;
  }, [finished]);

  useEffect(() => {
    if (!known) return;
    const finishedAtStart = finishedRef.current;
    let cancelled = false;
    let historyLoaded = false;
    let buffer: DeploymentLogDto[] = [];

    const socket = finishedAtStart ? null : socketFactory();

    const onLog = (payload: unknown) => {
      const parsed = deploymentLogDtoSchema.safeParse(payload);
      if (!parsed.success || parsed.data.deploymentId !== deploymentId) return;
      if (historyLoaded) setLogs((prev) => mergeLogs(prev, [parsed.data]));
      else buffer.push(parsed.data);
    };
    const onStatus = (payload: unknown) => {
      const parsed = deploymentStatusEventDtoSchema.safeParse(payload);
      if (!parsed.success || parsed.data.deploymentId !== deploymentId) return;
      const event = parsed.data;
      queryClient.setQueryData<DeploymentDto>(deploymentKey(deploymentId), (prev) =>
        prev ? { ...prev, status: event.status, errorMessage: event.errorMessage } : prev,
      );
      // Durations, commit sha and the project's current deployment change with status.
      void queryClient.invalidateQueries({ queryKey: deploymentKey(deploymentId) });
      void queryClient.invalidateQueries({ queryKey: ['deployments'] });
      void queryClient.invalidateQueries({ queryKey: ['project'] });
    };
    const join = () => {
      setReconnecting(false);
      socket?.emit(SOCKET_EVENTS.JOIN_DEPLOYMENT, { deploymentId });
    };
    const onDisconnect = () => setReconnecting(true);

    if (socket) {
      socket.on(SOCKET_EVENTS.DEPLOYMENT_LOG, onLog);
      socket.on(SOCKET_EVENTS.DEPLOYMENT_STATUS, onStatus);
      socket.on('connect', join);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onDisconnect);
      if (socket.connected) join();
    }

    api
      .getAllLogs(deploymentId)
      .then((history) => {
        if (cancelled) return;
        historyLoaded = true;
        setLogs(mergeLogs(history, buffer));
        buffer = [];
        setState(finishedRef.current ? 'complete' : 'live');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error('Could not load logs'));
        setState('error');
      });

    return () => {
      cancelled = true;
      if (socket) {
        socket.emit(SOCKET_EVENTS.LEAVE_DEPLOYMENT, { deploymentId });
        socket.off(SOCKET_EVENTS.DEPLOYMENT_LOG, onLog);
        socket.off(SOCKET_EVENTS.DEPLOYMENT_STATUS, onStatus);
        socket.off('connect', join);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onDisconnect);
      }
    };
  }, [api, queryClient, deploymentId, known, socketFactory]);

  const effectiveState: LogStreamState = state === 'live' && finished ? 'complete' : state;
  return { logs, state: effectiveState, error, reconnecting: reconnecting && !finished };
}

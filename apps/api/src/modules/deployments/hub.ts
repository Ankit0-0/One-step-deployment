import { EventEmitter } from 'node:events';
import type { DeploymentLogDto, DeploymentStatusEventDto } from '@osd/shared';

interface HubEvents {
  logs: [DeploymentLogDto[]];
  status: [DeploymentStatusEventDto];
}

/** In-process fan-out of persisted deployment events to realtime subscribers (socket.io). */
export class DeploymentHub extends EventEmitter<HubEvents> {}

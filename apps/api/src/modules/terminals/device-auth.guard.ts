import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { sha256Hex } from '../../common/sha256.js';
import { PrismaService } from '../../database/prisma.service.js';

export interface AuthenticatedTerminal {
  id: string;
  code: string;
  storeId: string;
  storeCode: string;
}

export interface TerminalRequest {
  headers: { authorization?: string };
  terminal?: AuthenticatedTerminal;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]{32,128})$/i;

/** Authenticates the device token issued at enrolment (ARCH §11). */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TerminalRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    const terminal = token
      ? await this.prisma.terminal.findFirst({
          where: { deviceTokenHash: sha256Hex(token), isActive: true },
          select: { id: true, code: true, storeId: true, store: { select: { code: true } } },
        })
      : null;
    if (!terminal) {
      throw new ApiException(401, 'UNAUTHORIZED', 'A valid device token is required');
    }

    const { id, code, storeId, store } = terminal;
    request.terminal = { id, code, storeId, storeCode: store.code };
    return true;
  }
}

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { TerminalRequest } from './device-auth.guard.js';

/** The terminal that `DeviceAuthGuard` authenticated. */
export const CurrentTerminal = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<TerminalRequest>().terminal,
);

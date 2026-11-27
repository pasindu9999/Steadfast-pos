import { Body, Controller, Get, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { type PullQuery, pullQuerySchema, type PushRequest, pushRequestSchema } from '@pos/core';

import { ApiException } from '../../common/api-exception.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentTerminal } from '../terminals/current-terminal.decorator.js';
import { type AuthenticatedTerminal, DeviceAuthGuard } from '../terminals/device-auth.guard.js';
import { PullService } from './pull.service.js';
import { PushService } from './push.service.js';

@Controller('sync')
@UseGuards(DeviceAuthGuard)
export class SyncController {
  constructor(
    private readonly pushService: PushService,
    private readonly pullService: PullService,
  ) {}

  @Get('pull')
  @Header('Cache-Control', 'no-store')
  pull(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Query(new ZodValidationPipe(pullQuerySchema)) query: PullQuery,
  ) {
    return this.pullService.pull(terminal, query.cursor);
  }

  @Post('push')
  @HttpCode(200)
  push(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body(new ZodValidationPipe(pushRequestSchema)) body: PushRequest,
  ) {
    if (body.terminalId !== terminal.id) {
      throw new ApiException(403, 'TERMINAL_MISMATCH', 'The token belongs to another terminal');
    }
    return this.pushService.push(terminal, body);
  }
}

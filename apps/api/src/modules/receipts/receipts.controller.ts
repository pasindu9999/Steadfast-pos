import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { receiptNoInputSchema } from '@pos/core';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentTerminal } from '../terminals/current-terminal.decorator.js';
import { type AuthenticatedTerminal, DeviceAuthGuard } from '../terminals/device-auth.guard.js';
import { ReceiptsService } from './receipts.service.js';

@Controller('receipts')
@UseGuards(DeviceAuthGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(':receiptNo')
  @Header('Cache-Control', 'no-store')
  lookUp(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param('receiptNo', new ZodValidationPipe(receiptNoInputSchema)) receiptNo: string,
  ) {
    return this.receipts.lookUp(terminal.storeId, receiptNo);
  }
}

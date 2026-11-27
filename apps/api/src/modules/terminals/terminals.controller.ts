import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { type EnrolRequest, enrolRequestSchema } from '@pos/core';

import { StrictRateLimit } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { EnrolmentService } from './enrolment.service.js';

@Controller('terminals')
export class TerminalsController {
  constructor(private readonly enrolment: EnrolmentService) {}

  @Post('enrol')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @StrictRateLimit()
  enrol(@Body(new ZodValidationPipe(enrolRequestSchema)) body: EnrolRequest) {
    return this.enrolment.enrol(body.enrolmentCode);
  }
}

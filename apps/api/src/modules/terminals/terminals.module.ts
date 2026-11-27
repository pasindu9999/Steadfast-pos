import { Module } from '@nestjs/common';

import { EnrolmentService } from './enrolment.service.js';
import { TerminalsController } from './terminals.controller.js';

@Module({
  controllers: [TerminalsController],
  providers: [EnrolmentService],
})
export class TerminalsModule {}

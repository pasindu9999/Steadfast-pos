import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { EnrolResponse } from '@pos/core';

import { ApiException } from '../../common/api-exception.js';
import { sha256Hex } from '../../common/sha256.js';
import { PrismaService } from '../../database/prisma.service.js';
import { hashEnrolmentCode } from './enrolment-code.js';

const TOKEN_BYTES = 32;

@Injectable()
export class EnrolmentService {
  private readonly logger = new Logger(EnrolmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enrol(enrolmentCode: string): Promise<EnrolResponse> {
    const deviceToken = randomBytes(TOKEN_BYTES).toString('base64url');
    // One conditional UPDATE, so a single-use code can't be redeemed twice at once (ARCH §11).
    const [terminal] = await this.prisma.terminal.updateManyAndReturn({
      where: {
        enrolmentCodeHash: hashEnrolmentCode(enrolmentCode),
        isActive: true,
        OR: [{ enrolmentCodeReusable: true }, { enrolmentCodeUsedAt: null }],
      },
      data: { deviceTokenHash: sha256Hex(deviceToken), enrolmentCodeUsedAt: new Date() },
    });
    if (!terminal) {
      throw new ApiException(401, 'INVALID_ENROLMENT_CODE', 'The enrolment code is not valid');
    }

    this.logger.log({ msg: 'terminal enrolled', terminalId: terminal.id });
    return {
      terminalId: terminal.id,
      terminalCode: terminal.code,
      deviceToken,
      lastAppliedSeq: Number(terminal.lastAppliedSeq),
      receiptSeq: Number(terminal.receiptSeq),
      returnSeq: Number(terminal.returnSeq),
    };
  }
}

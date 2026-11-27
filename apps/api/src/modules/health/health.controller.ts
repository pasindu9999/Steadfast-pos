import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Terminals poll this to judge connectivity (ARCH §4.7). It deliberately skips the database, so
 * polling never keeps a scale-to-zero database awake.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' as const };
  }
}

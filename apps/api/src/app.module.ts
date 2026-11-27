import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { loggerOptions } from './common/logger.js';
import { rateLimitOptions } from './common/rate-limit.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ReceiptsModule } from './modules/receipts/receipts.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { TerminalsModule } from './modules/terminals/terminals.module.js';

@Module({})
export class AppModule {
  static register(env: Env, logDestination?: DestinationStream): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.register(env),
        LoggerModule.forRoot(loggerOptions(env, logDestination)),
        ThrottlerModule.forRoot(rateLimitOptions(env)),
        DatabaseModule,
        HealthModule,
        TerminalsModule,
        SyncModule,
        ReceiptsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}

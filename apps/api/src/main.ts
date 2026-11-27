import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './app.setup.js';
import { parseEnv } from './config/env.js';

if (existsSync('.env')) {
  process.loadEnvFile();
}
const env = parseEnv(process.env);

const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), APP_OPTIONS);
configureApp(app, env);
await app.listen(env.PORT);

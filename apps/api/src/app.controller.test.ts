import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppController } from './app.controller.js';
import { AppModule } from './app.module.js';

describe('AppController', () => {
  it('receives its service through Nest dependency injection', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef.get(AppController).getHello()).toBe('Offline-First Apparel POS API');

    await moduleRef.close();
  });
});

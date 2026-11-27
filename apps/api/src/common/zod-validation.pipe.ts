import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { ApiException } from './api-exception.js';

/** Parses a request part with a contract from `@pos/core`. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(400, 'VALIDATION_FAILED', describeIssue(result.error));
    }
    return result.data;
  }
}

/** Where the first problem is and which rule it broke, without repeating the input. */
export function describeIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (!issue) return 'The request is not valid';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

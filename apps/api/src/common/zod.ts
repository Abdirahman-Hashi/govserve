import { applyDecorators, type PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

type SchemaObject = Record<string, unknown> & { required?: string[] };

/**
 * Validates a request body with a shared Zod schema (the same one the web form uses).
 * Failures return 422 VALIDATION_FAILED with per-field details (FR-033).
 */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new UnprocessableEntityException({
      message: 'Validation failed',
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}

/** OpenAPI schema generated from a Zod schema (input or output shape). */
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): SchemaObject {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'openapi-3.0' });
  const { $schema: _ignored, ...rest } = json as Record<string, unknown>;
  return rest;
}

/** Documents a Zod-validated request body with an example. */
export function ApiZodBody(schema: z.ZodType, example?: unknown): MethodDecorator {
  return applyDecorators(
    ApiBody({
      schema: { ...openApiSchema(schema, 'input'), ...(example ? { example } : {}) } as object,
    }),
    ApiResponse({
      status: 422,
      description: 'Validation failed (error envelope with field details)',
    }),
  );
}

/** Documents a Zod-described response. */
export function ApiZodResponse(
  status: number,
  schema: z.ZodType,
  description?: string,
): MethodDecorator {
  return ApiResponse({
    status,
    schema: openApiSchema(schema),
    ...(description ? { description } : {}),
  });
}

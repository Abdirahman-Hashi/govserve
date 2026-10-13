import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('GovServe API')
    .setDescription(
      'Revenue & Service Portal API. Errors use the envelope { error: { code, message, details, requestId } }.',
    )
    .setVersion('v1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Swagger UI at /api/docs, JSON at /api/docs-json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
  });
}

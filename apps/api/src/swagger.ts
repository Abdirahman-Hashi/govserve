import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { API_VERSION, finalizeOpenApi } from './openapi-finalize';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('GovServe API')
    .setDescription(
      'Revenue & Service Portal API (URI version /api/v1; contract version in info.version, changes in docs/API_CHANGELOG.md). Errors use the envelope { error: { code, message, details, requestId } }. Money is integer cents as decimal strings.',
    )
    .setVersion(API_VERSION)
    .addBearerAuth()
    .build();
  return finalizeOpenApi(SwaggerModule.createDocument(app, config));
}

/** Swagger UI at /api/docs, JSON at /api/docs-json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
  });
}

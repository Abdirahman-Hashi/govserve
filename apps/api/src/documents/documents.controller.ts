import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type DocumentDto,
  DocumentSchema,
  type DownloadTicket,
  DownloadTicketSchema,
  type RequestUploadRequest,
  RequestUploadRequestSchema,
  type UploadTicket,
  UploadTicketSchema,
} from '@govserve/shared';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { DocumentsService } from './documents.service';

const uuid = new ParseUUIDPipe();
const notYours = { status: 404, description: 'NOT_FOUND (unknown, or another citizen’s)' };
const conflict = { status: 409, description: 'NOT_EDITABLE or TOO_MANY_PENDING_UPLOADS' };

@ApiTags('documents')
@ApiBearerAuth()
@Roles('CITIZEN')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN (not a citizen)' })
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('applications/:id/documents')
  @ApiOperation({
    summary: 'Request an upload URL',
    description:
      'Roles: CITIZEN (own only). Returns a 5-minute pre-signed PUT for exactly the declared type and size; call complete afterwards.',
  })
  @ApiZodBody(RequestUploadRequestSchema, {
    docType: 'NATIONAL_ID_OR_PASSPORT',
    fileName: 'id-card.jpg',
    mime: 'image/jpeg',
    sizeBytes: 482113,
    sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  @ApiZodResponse(201, UploadTicketSchema)
  @ApiResponse({
    status: 422,
    description: 'VALIDATION_FAILED (type not requested, MIME not allowed, too large)',
  })
  @ApiResponse(conflict)
  @ApiResponse(notYours)
  requestUpload(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RequestUploadRequestSchema)) body: RequestUploadRequest,
  ): Promise<UploadTicket> {
    return this.documents.requestUpload(user, id, body);
  }

  @Post('documents/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an upload',
    description:
      'Roles: CITIZEN (own only). Verifies size, file type (by content) and SHA-256, then quarantines the file for the virus scan.',
  })
  @ApiZodResponse(200, DocumentSchema)
  @ApiResponse({ status: 409, description: 'UPLOAD_MISSING' })
  @ApiResponse({ status: 422, description: 'UPLOAD_REJECTED (wrong type, size or checksum)' })
  @ApiResponse(notYours)
  complete(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<DocumentDto> {
    return this.documents.complete(user, id);
  }

  @Get('documents/:id/download')
  @ApiOperation({
    summary: 'Get a download URL',
    description: 'Roles: CITIZEN (own only). A 60-second signed URL.',
  })
  @ApiZodResponse(200, DownloadTicketSchema)
  @ApiResponse({ status: 409, description: 'NOT_AVAILABLE' })
  @ApiResponse(notYours)
  download(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<DownloadTicket> {
    return this.documents.download(user, id);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove an uploaded document',
    description: 'Roles: CITIZEN (own only). Only while the document may be changed.',
  })
  @ApiResponse({ status: 204, description: 'Document removed' })
  @ApiResponse(conflict)
  @ApiResponse(notYours)
  async removeDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.documents.remove(user, id);
  }
}

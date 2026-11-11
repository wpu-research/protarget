import { tmpdir } from 'node:os';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { CREATIVE_MAX_BYTES } from '@protarget/shared';
import type { AuthRequest } from '../../common/identity';
import { LowerUuidPipe } from '../../common/inventory-validation';
import { Roles } from '../auth/auth.policy';
import { CreativePageDto, CreativeQueryDto, CreativeResponseDto, RejectCreativeDto, RevokeCreativeDto, UploadCreativeDto } from './creatives.dto';
import { CreativesService, UploadedFile as UploadedTemp } from './creatives.service';

/** RFC 6266/5987: ASCII fallback plus an RFC 5987 `filename*` where `'()*` are percent-encoded too. */
export function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Guards run before this interceptor, so unauthenticated/non-admin requests never write a temp file.
 * Nest's FileInterceptor removes the temp file when a later pipe/handler fails; the service removes it on success. */
const upload = FileInterceptor('file', {
  storage: diskStorage({ destination: tmpdir() }),
  limits: { fileSize: CREATIVE_MAX_BYTES, files: 1, fields: 5, fieldSize: 1024 },
  defParamCharset: 'utf8',
});

@ApiTags('creatives') @ApiCookieAuth('protarget_access') @Controller('creatives')
export class CreativesController {
  constructor(private readonly creatives: CreativesService) {}

  @Get() @Roles(Role.ADMIN) @ApiOkResponse({ type: CreativePageDto })
  list(@Req() req: AuthRequest, @Query() query: CreativeQueryDto): Promise<CreativePageDto> {
    return this.creatives.list(req.principal, query);
  }
  @Post() @Roles(Role.ADMIN) @UseInterceptors(upload) @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'advertiserId'], properties: {
    file: { type: 'string', format: 'binary', description: 'MP4 (H.264), PNG or JPEG; at most 200 MB.' },
    advertiserId: { type: 'string', format: 'uuid' },
    displayDurationSeconds: { type: 'string', description: 'Images only, 1–300 seconds.' },
    replacesId: { type: 'string', format: 'uuid' } } } })
  @ApiCreatedResponse({ type: CreativeResponseDto, description: 'VALIDATING when technically valid, REJECTED with reason otherwise.' })
  upload(@Req() req: AuthRequest, @UploadedFile() file: UploadedTemp | undefined, @Body() dto: UploadCreativeDto): Promise<CreativeResponseDto> {
    return this.creatives.upload(req.principal, file, dto);
  }
  @Get(':id') @Roles(Role.ADMIN) @ApiOkResponse({ type: CreativeResponseDto })
  get(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string): Promise<CreativeResponseDto> {
    return this.creatives.get(req.principal, id);
  }
  @Get(':id/file') @Roles(Role.ADMIN) @ApiProduces('video/mp4', 'image/png', 'image/jpeg') @ApiOkResponse({ description: 'Admin-only binary stream.' })
  async file(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const out = await this.creatives.file(req.principal, id);
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', contentDisposition(out.filename));
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (out.size != null) res.setHeader('Content-Length', String(out.size));
    return new StreamableFile(out.stream);
  }
  @Post(':id/approve') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CreativeResponseDto })
  approve(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string): Promise<CreativeResponseDto> {
    return this.creatives.approve(req.principal, id);
  }
  @Post(':id/reject') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CreativeResponseDto })
  reject(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: RejectCreativeDto): Promise<CreativeResponseDto> {
    return this.creatives.reject(req.principal, id, dto);
  }
  @Post(':id/revoke') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CreativeResponseDto, description: 'APPROVED → REVOKED with a reason; terminal.' })
  revoke(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: RevokeCreativeDto): Promise<CreativeResponseDto> {
    return this.creatives.revoke(req.principal, id, dto);
  }
}

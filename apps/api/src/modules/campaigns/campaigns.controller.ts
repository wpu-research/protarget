import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { LowerUuidPipe } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';
import { Roles } from '../auth/auth.policy';
import { CampaignsService } from './campaigns.service';
import {
  ActivityPageDto, CampaignDetailDto, CampaignPageDto, CampaignQueryDto, CampaignValidationDto, CmsOperationDto, CmsOperationPageDto,
  CmsOperationQueryDto, CreateCampaignDto, CreateCmsOperationDto, CreativeLinkDto, ReplaceScheduleDto, ScreenIdsDto,
  ScreenOptionPageDto, ScreenOptionQueryDto, TransitionDto, UpdateCampaignDto,
} from './campaigns.dto';

/** Admin-only booking routes. Agency/advertiser visibility is a later story; every route here is ADMIN. */
@ApiTags('campaigns') @ApiCookieAuth('protarget_access') @Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}
  @Get() @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignPageDto })
  list(@Req() req: AuthRequest, @Query() query: CampaignQueryDto) { return this.campaigns.list(req.principal, query); }
  @Post() @Roles(Role.ADMIN) @ApiCreatedResponse({ type: CampaignDetailDto })
  create(@Req() req: AuthRequest, @Body() dto: CreateCampaignDto) { return this.campaigns.create(req.principal, dto); }
  @Get(':id') @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto })
  get(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string) { return this.campaigns.get(req.principal, id); }
  @Patch(':id') @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto })
  update(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaigns.update(req.principal, id, dto);
  }
  @Post(':id/archive') @HttpCode(204) @Roles(Role.ADMIN) @ApiNoContentResponse({ description: 'Soft-deletes a DRAFT booking.' })
  archive(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string) { return this.campaigns.archive(req.principal, id); }
  @Get(':id/screen-options') @Roles(Role.ADMIN) @ApiOkResponse({ type: ScreenOptionPageDto })
  screenOptions(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Query() query: ScreenOptionQueryDto) {
    return this.campaigns.screenOptions(req.principal, id, query);
  }
  @Post(':id/screens') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto })
  addScreens(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: ScreenIdsDto) {
    return this.campaigns.addScreens(req.principal, id, dto);
  }
  @Post(':id/screens/remove') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto })
  removeScreens(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: ScreenIdsDto) {
    return this.campaigns.removeScreens(req.principal, id, dto);
  }
  @Post(':id/creatives') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto })
  linkCreative(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: CreativeLinkDto) {
    return this.campaigns.linkCreative(req.principal, id, dto);
  }
  @Post(':id/creatives/remove') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto })
  unlinkCreative(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: CreativeLinkDto) {
    return this.campaigns.unlinkCreative(req.principal, id, dto);
  }
  @Post(':id/schedule') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto, description: 'Replaces all campaign-wide dayparts.' })
  replaceSchedule(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: ReplaceScheduleDto) {
    return this.campaigns.replaceSchedule(req.principal, id, dto);
  }
  @Get(':id/validation') @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignValidationDto })
  validation(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string) { return this.campaigns.validation(req.principal, id); }
  @Post(':id/transitions') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: CampaignDetailDto })
  transition(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: TransitionDto) {
    return this.campaigns.transition(req.principal, id, dto);
  }
  @Get(':id/cms-operations') @Roles(Role.ADMIN) @ApiOkResponse({ type: CmsOperationPageDto })
  cmsOperations(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Query() query: CmsOperationQueryDto) {
    return this.campaigns.cmsOperations(req.principal, id, query);
  }
  @Post(':id/cms-operations') @Roles(Role.ADMIN) @ApiCreatedResponse({ type: CmsOperationDto, description: 'Append-only operator declaration; not proof of playback.' })
  recordCmsOperation(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: CreateCmsOperationDto) {
    return this.campaigns.recordCmsOperation(req.principal, id, dto);
  }
  @Get(':id/activity') @Roles(Role.ADMIN) @ApiOkResponse({ type: ActivityPageDto })
  activity(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Query() query: PaginationDto) {
    return this.campaigns.activity(req.principal, id, query);
  }
}

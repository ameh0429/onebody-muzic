import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { NotificationsService } from './notifications.service';
import { NotificationPreferences, NotificationQuery, PushSubscriptionDto, RemovePushDto } from './notifications.dto';
@ApiTags('Notifications') @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() @ApiOperation({ summary: 'Your notification inbox, newest first' })
  list(@CurrentUser() actor: UserResponseDto, @Query() query: NotificationQuery) { return this.notifications.list(actor, query.page); }
  @Patch('read-all') @ApiOperation({ summary: 'Mark your visible notifications as read' })
  readAll(@CurrentUser() actor: UserResponseDto) { return this.notifications.read(actor); }
  @Patch(':id/read') @ApiOperation({ summary: 'Mark one of your notifications as read' })
  read(@CurrentUser() actor: UserResponseDto, @Param('id', new ParseUUIDPipe()) id: string) { return this.notifications.read(actor, id); }
  @Get('preferences') preferences(@CurrentUser() actor: UserResponseDto) { return this.notifications.preferences(actor.id); }
  @Patch('preferences') save(@CurrentUser() actor: UserResponseDto, @Body() dto: NotificationPreferences) { return this.notifications.savePreferences(actor.id, dto); }
  @Get('push/options') options() { return this.notifications.options(); }
  @Post('push/subscriptions') subscribe(@CurrentUser() actor: UserResponseDto, @Body() dto: PushSubscriptionDto) { return this.notifications.subscribe(actor.id, dto); }
  @Delete('push/subscriptions') unsubscribe(@CurrentUser() actor: UserResponseDto, @Body() dto: RemovePushDto) { return this.notifications.unsubscribe(actor.id, dto.endpoint); }
}

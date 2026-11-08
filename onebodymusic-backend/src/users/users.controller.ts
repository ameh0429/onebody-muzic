import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { Role } from '../database/models';
import { UsersService } from './users.service';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateNameDto } from './dto/update-name.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UsersPageDto } from './dto/users-page.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 400, description: 'Invalid UUID, query, body, or unknown fields.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Missing/invalid/expired JWT or non-active account.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Administrator required or attempted self role/status change.', type: ApiErrorDto })
@ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List users (ADMIN)', description: 'Filter by role/status. Deterministic pagination; page defaults to 1 and limit to 20 (maximum 100).' })
  @ApiResponse({ status: 200, type: UsersPageDto })
  list(@Query() query: ListUsersDto): Promise<UsersPageDto> { return this.users.list(query); }

  @Patch('me')
  @Roles(Role.ADMIN, Role.MEMBER)
  @ApiOperation({ summary: 'Update your own name', description: 'Both active roles may update only their name. Email, password, role, and status fields are rejected.' })
  @ApiBody({ type: UpdateNameDto })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User no longer exists.', type: ApiErrorDto })
  updateMe(@CurrentUser() actor: UserResponseDto, @Body() dto: UpdateNameDto): Promise<UserResponseDto> {
    return this.users.updateName(actor.id, dto.name);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get a user (ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found.', type: ApiErrorDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<UserResponseDto> { return this.users.findOne(id); }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve, suspend, or mark a user pending (ADMIN)', description: 'Cannot change your own status or remove the last active administrator.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateStatusDto })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Would remove the last active administrator.', type: ApiErrorDto })
  updateStatus(@CurrentUser() actor: UserResponseDto, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateStatusDto): Promise<UserResponseDto> {
    return this.users.updateStatus(actor.id, id, dto.status);
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Change a user role (ADMIN)', description: 'Cannot change your own role or demote the last active administrator.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Would remove the last active administrator.', type: ApiErrorDto })
  updateRole(@CurrentUser() actor: UserResponseDto, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRoleDto): Promise<UserResponseDto> {
    return this.users.updateRole(actor.id, id, dto.role);
  }
}

import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

const userExample = {
  id: '6838918a-2b67-49ed-a90d-14b86ca955c7', name: 'Grace James', email: 'grace@example.org',
  role: 'MEMBER', status: 'PENDING', createdAt: '2026-11-08T12:00:00.000Z', updatedAt: '2026-11-08T12:00:00.000Z',
};
const errorExample = (statusCode: number, error: string, message: string | string[], path: string) => ({
  statusCode, error, message, path, timestamp: '2026-11-08T12:00:00.000Z',
});

@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Register a pending member', description: 'Always creates a MEMBER with PENDING status. Does not issue a token. Role and status fields are rejected.' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'Pending member created.', type: UserResponseDto, example: userExample })
  @ApiResponse({ status: 400, description: 'Invalid input, password mismatch, or unrecognized fields.', type: ApiErrorDto, example: errorExample(400, 'Bad Request', ['confirmPassword must match password'], '/api/v1/auth/register') })
  @ApiResponse({ status: 409, description: 'Email already registered.', type: ApiErrorDto, example: errorExample(409, 'Conflict', 'Email is already registered', '/api/v1/auth/register') })
  @ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Authenticate an active account', description: 'Unknown email, wrong password, pending, and suspended accounts receive the same generic failure. Copy accessToken into Authorize.' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Authenticated.', type: LoginResponseDto, example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', tokenType: 'Bearer', expiresIn: 900, user: { ...userExample, status: 'ACTIVE' } } })
  @ApiResponse({ status: 400, description: 'Invalid request fields.', type: ApiErrorDto, example: errorExample(400, 'Bad Request', ['email must be an email'], '/api/v1/auth/login') })
  @ApiResponse({ status: 401, description: 'Invalid credentials or inactive account.', type: ApiErrorDto, example: errorExample(401, 'Unauthorized', 'Invalid email or password', '/api/v1/auth/login') })
  @ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user', description: 'Checks the current database account status on every request; only ACTIVE accounts are allowed.' })
  @ApiResponse({ status: 200, description: 'Current safe user profile.', type: UserResponseDto, example: { ...userExample, status: 'ACTIVE' } })
  @ApiResponse({ status: 401, description: 'Missing, invalid, expired token or inactive/deleted user.', type: ApiErrorDto, example: errorExample(401, 'Unauthorized', 'Unauthorized', '/api/v1/auth/me') })
  @ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
  me(@CurrentUser() user: UserResponseDto): UserResponseDto {
    return user;
  }
}

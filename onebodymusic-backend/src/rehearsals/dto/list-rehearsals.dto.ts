import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
export enum RehearsalPeriod { UPCOMING = 'upcoming', PAST = 'past' }
export class ListRehearsalsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;
  @ApiPropertyOptional({ enum: RehearsalPeriod, description: 'upcoming: scheduledAt >= server time, soonest first; past: scheduledAt < server time, newest first. Omit for all, soonest first.' })
  @IsOptional() @IsEnum(RehearsalPeriod)
  period?: RehearsalPeriod;
}

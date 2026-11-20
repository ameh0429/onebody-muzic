import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class NotificationQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}
export class NotificationPreferences {
  @ApiProperty() @IsBoolean() rehearsals!: boolean;
  @ApiProperty() @IsBoolean() reminders!: boolean;
  @ApiProperty() @IsBoolean() push!: boolean;
}
export class EmailPreferences {
  @ApiProperty() @IsBoolean() rehearsals!: boolean;
  @ApiProperty() @IsBoolean() reminders!: boolean;
}
export class PushSubscriptionDto {
  @ApiProperty() @IsString() @MaxLength(2048)
  @Matches(/^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[a-zA-Z0-9_/?=%.~-]+$/)
  endpoint!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{87}=?$/) p256dh!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{22}={0,2}$/) auth!: string;
}
export class RemovePushDto {
  @ApiProperty() @IsString() @MaxLength(2048) endpoint!: string;
}

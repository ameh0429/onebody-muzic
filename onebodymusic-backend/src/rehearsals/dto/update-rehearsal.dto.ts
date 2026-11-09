import { PartialType } from '@nestjs/swagger';
import { CreateRehearsalDto } from './create-rehearsal.dto';
export class UpdateRehearsalDto extends PartialType(CreateRehearsalDto, { skipNullProperties: false }) {}

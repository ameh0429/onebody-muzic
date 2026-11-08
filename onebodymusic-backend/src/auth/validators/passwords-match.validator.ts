import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'passwordsMatch', async: false })
export class PasswordsMatch implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const object = args.object as { password?: unknown };
    return typeof value === 'string' && value === object.password;
  }

  defaultMessage(): string {
    return 'confirmPassword must match password';
  }
}

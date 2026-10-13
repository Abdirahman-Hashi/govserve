import { UnprocessableEntityException } from '@nestjs/common';
import { LoginRequestSchema } from '@govserve/shared';
import { openApiSchema, ZodPipe } from './zod';

describe('ZodPipe', () => {
  const pipe = new ZodPipe(LoginRequestSchema);

  it('should return parsed data when the body is valid', () => {
    expect(pipe.transform({ email: ' A@B.so ', password: 'x' })).toEqual({
      email: 'a@b.so',
      password: 'x',
    });
  });

  it('should throw 422 with field details when the body is invalid', () => {
    try {
      pipe.transform({ email: 'nope', extra: 1 });
      fail('expected an exception');
    } catch (e) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      const body = (e as UnprocessableEntityException).getResponse() as {
        details: { path: string }[];
      };
      expect(body.details.map((d) => d.path)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
    }
  });
});

describe('openApiSchema', () => {
  it('should describe required properties when generated from a Zod schema', () => {
    const schema = openApiSchema(LoginRequestSchema, 'input');
    expect(schema.required).toEqual(['email', 'password']);
  });
});

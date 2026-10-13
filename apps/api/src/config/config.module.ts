import { Global, Module } from '@nestjs/common';
import { type Env, loadEnv } from './env';

export const APP_CONFIG = Symbol('APP_CONFIG');
export type AppConfig = Env;

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadEnv() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

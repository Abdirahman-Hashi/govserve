import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CodeAttemptsService } from './code-attempts.service';
import { LoginAttemptsService } from './login-attempts.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { SessionRevocationService } from './session-revocation.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'govserve', audience: 'govserve-api' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'govserve', audience: 'govserve-api' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CodeAttemptsService,
    LoginAttemptsService,
    PasswordService,
    OtpService,
    TokenService,
    SessionRevocationService,
  ],
  exports: [AuthService, PasswordService, OtpService, TokenService, SessionRevocationService],
})
export class AuthModule {}
